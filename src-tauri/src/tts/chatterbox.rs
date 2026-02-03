//! Chatterbox-Turbo TTS engine using bundled Python sidecar
//!
//! High-quality voice synthesis with emotion control using Chatterbox Turbo on Apple Silicon.

use crate::tts::TTSEngine; // Import TTSEngine
use base64::Engine;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ChatterboxError {
    #[error("Failed to spawn TTS process: {0}")]
    SpawnError(String),
    #[error("TTS process not running")]
    ProcessNotRunning,
    #[error("Failed to communicate with TTS: {0}")]
    CommunicationError(String),
    #[error("TTS generation failed: {0}")]
    GenerationError(String),
    #[error("Invalid response from TTS: {0}")]
    InvalidResponse(String),
    #[error("Sidecar not found: {0}")]
    SidecarNotFound(String),
}

/// Response from the TTS server
#[derive(Debug, serde::Deserialize)]
struct TTSResponse {
    status: String,
    action: String,
    #[serde(default)]
    audio: Option<String>, // Base64 encoded WAV
    #[serde(default)]
    sample_rate: Option<u32>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    device: Option<String>,
    #[serde(default)]
    model_loaded: Option<bool>,
}

/// TTS generation result
#[derive(Debug)]
pub struct ChatterboxResult {
    pub audio: Vec<f32>,
    pub sample_rate: u32,
}

impl ChatterboxResult {
    /// Convert to WAV bytes
    pub fn to_wav(&self) -> Vec<u8> {
        let num_samples = self.audio.len();
        let byte_rate = self.sample_rate * 2;
        let data_size = num_samples * 2;
        let file_size = 36 + data_size;

        let mut buffer = Vec::with_capacity(44 + data_size);

        buffer.extend_from_slice(b"RIFF");
        buffer.extend_from_slice(&(file_size as u32).to_le_bytes());
        buffer.extend_from_slice(b"WAVE");
        buffer.extend_from_slice(b"fmt ");
        buffer.extend_from_slice(&16u32.to_le_bytes());
        buffer.extend_from_slice(&1u16.to_le_bytes()); // PCM format
        buffer.extend_from_slice(&1u16.to_le_bytes()); // Mono
        buffer.extend_from_slice(&self.sample_rate.to_le_bytes());
        buffer.extend_from_slice(&byte_rate.to_le_bytes());
        buffer.extend_from_slice(&2u16.to_le_bytes()); // Block align
        buffer.extend_from_slice(&16u16.to_le_bytes()); // Bits per sample
        buffer.extend_from_slice(b"data");
        buffer.extend_from_slice(&(data_size as u32).to_le_bytes());

        for sample in &self.audio {
            let clamped = sample.clamp(-1.0, 1.0);
            let int_sample = (clamped * 32767.0) as i16;
            buffer.extend_from_slice(&int_sample.to_le_bytes());
        }

        buffer
    }
}

/// TTS process manager (Handles Chatterbox and Qwen3-TTS engines)
pub struct ChatterboxTTS {
    process: Option<Child>,
    initialized: bool,
    engine: TTSEngine,
}

impl ChatterboxTTS {
    pub fn new(engine: TTSEngine) -> Self {
        Self {
            process: None,
            initialized: false,
            engine,
        }
    }

    /// Get the path to the bundled sidecar executable
    fn get_sidecar_path(&self) -> Result<PathBuf, ChatterboxError> {
        let current_dir = std::env::current_dir().unwrap_or_default();
        let current_exe = std::env::current_exe().unwrap_or_default();

        eprintln!("[ChatterboxTTS] Looking for sidecar...");
        eprintln!("[ChatterboxTTS] CWD: {:?}", current_dir);
        eprintln!("[ChatterboxTTS] EXE: {:?}", current_exe);

        // In development, use Python directly
        #[cfg(debug_assertions)]
        {
            // Select script based on engine & OS
            let script_name = match self.engine {
                TTSEngine::Chatterbox => "chatterbox_tts.py",
                TTSEngine::Qwen3TTS => {
                    #[cfg(target_os = "macos")]
                    {
                        "qwen3_tts.py"
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        "qwen3_tts_cuda.py"
                    }
                }
            };

            let mut possible_paths = vec![
                // Check relative to Cargo.toml (most reliable in dev)
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("python-tts")
                    .join(script_name),
                // When cwd is project root
                current_dir.join("python-tts").join(script_name),
                // When cwd is src-tauri
                current_dir.join("..").join("python-tts").join(script_name),
            ];

            // Try finding relative to executable location
            if let Some(exe_dir) = current_exe.parent() {
                possible_paths.push(
                    exe_dir
                        .join("..")
                        .join("..")
                        .join("..")
                        .join("python-tts")
                        .join(script_name),
                );
            }

            for path in &possible_paths {
                let canonical_path = if let Ok(p) = path.canonicalize() {
                    p
                } else {
                    path.clone()
                };
                eprintln!("[ChatterboxTTS] Checking dev path: {:?}", canonical_path);
                if path.exists() {
                    eprintln!("[ChatterboxTTS] Found dev script at: {:?}", path);
                    return Ok(path.clone());
                }
            }
        }

        // Define sidecar name based on architecture and engine
        let base_name = match self.engine {
            TTSEngine::Chatterbox => "chatterbox-tts",
            TTSEngine::Qwen3TTS => {
                #[cfg(target_os = "macos")]
                {
                    "qwen3-tts"
                }
                #[cfg(not(target_os = "macos"))]
                {
                    "qwen3-tts-cuda"
                }
            }
        };

        // Define sidecar suffix based on target platform
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let suffix = "-aarch64-apple-darwin";

        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        let suffix = "-x86_64-apple-darwin";

        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        let suffix = "-x86_64-pc-windows-msvc.exe";

        #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
        let suffix = "-aarch64-pc-windows-msvc.exe";

        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        let suffix = "-x86_64-unknown-linux-gnu";

        #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
        let suffix = "-aarch64-unknown-linux-gnu";

        #[cfg(not(any(
            all(target_os = "macos", target_arch = "aarch64"),
            all(target_os = "macos", target_arch = "x86_64"),
            all(target_os = "windows", target_arch = "x86_64"),
            all(target_os = "windows", target_arch = "aarch64"),
            all(target_os = "linux", target_arch = "x86_64"),
            all(target_os = "linux", target_arch = "aarch64")
        )))]
        let suffix = "";

        let sidecar_name = format!("{}{}", base_name, suffix);
        let sidecar_name = sidecar_name.as_str();

        eprintln!("[SidecarTTS] Looking for binary: {}", sidecar_name);

        // In production, look for the bundled sidecar
        // Tauri places sidecars in the app bundle's Resources folder on macOS
        if let Some(macos_dir) = current_exe.parent() {
            if let Some(contents_dir) = macos_dir.parent() {
                let resources_dir = contents_dir.join("Resources");
                let sidecar_path = resources_dir.join(sidecar_name);

                eprintln!("[ChatterboxTTS] Checking bundle path: {:?}", sidecar_path);
                if sidecar_path.exists() {
                    eprintln!(
                        "[ChatterboxTTS] Found bundled sidecar at: {:?}",
                        sidecar_path
                    );
                    return Ok(sidecar_path);
                }
            }
        }

        // Fallback: check binaries directory (for dev with built sidecar)
        let mut binaries_paths = vec![
            // Check relative to Cargo.toml
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"),
            current_dir.join("src-tauri").join("binaries"),
            current_dir.join("binaries"),
        ];

        // Also check relative to executable (useful for release builds not in bundle)
        if let Some(exe_dir) = current_exe.parent() {
            binaries_paths.push(exe_dir.join("binaries"));
            // Handle target/release/ structure
            if let Some(target_dir) = exe_dir.parent() {
                if let Some(root_dir) = target_dir.parent() {
                    binaries_paths.push(root_dir.join("src-tauri").join("binaries"));
                }
            }
        }

        for binaries_path in &binaries_paths {
            let sidecar_path = binaries_path.join(sidecar_name);
            eprintln!("[ChatterboxTTS] Checking binary path: {:?}", sidecar_path);
            if sidecar_path.exists() {
                eprintln!("[ChatterboxTTS] Found sidecar at: {:?}", sidecar_path);
                return Ok(sidecar_path);
            }
        }

        Err(ChatterboxError::SidecarNotFound(format!(
            "Could not find Chatterbox TTS sidecar. Checked paths: python-tts and binaries/{}",
            sidecar_name
        )))
    }

    /// Start the TTS server
    pub fn start(&mut self) -> Result<(), ChatterboxError> {
        if self.process.is_some() {
            return Ok(()); // Already running
        }

        let sidecar_path = self.get_sidecar_path()?;

        eprintln!("[ChatterboxTTS] Final sidecar path: {:?}", sidecar_path);
        eprintln!("[ChatterboxTTS] Is Python script: {}", sidecar_path.extension().map(|e| e == "py").unwrap_or(false));

        // Determine how to run the sidecar
        let child = if sidecar_path.extension().map(|e| e == "py").unwrap_or(false) {
            // Development mode: run with Python
            let python_cmd = if Command::new("python3").arg("--version").output().is_ok() {
                "python3"
            } else {
                "python"
            };

            eprintln!("[ChatterboxTTS] Running Python script with: {}", python_cmd);
            Command::new(python_cmd)
                .arg(&sidecar_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| ChatterboxError::SpawnError(e.to_string()))?
        } else {
            // Production mode: run bundled executable
            eprintln!("[ChatterboxTTS] Running bundled executable directly");
            Command::new(&sidecar_path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| ChatterboxError::SpawnError(e.to_string()))?
        };

        self.process = Some(child);

        // Wait for ready signal
        let response = self.read_response()?;
        if response.status != "ok" || response.action != "ready" {
            return Err(ChatterboxError::SpawnError(
                "TTS server did not signal ready".to_string(),
            ));
        }

        Ok(())
    }

    /// Initialize the TTS model
    pub fn init_model(&mut self) -> Result<String, ChatterboxError> {
        let cmd = serde_json::json!({
            "action": "init",
        });

        self.send_command(&cmd)?;
        let response = self.read_response()?;

        if response.status != "ok" {
            return Err(ChatterboxError::GenerationError(
                response
                    .error
                    .unwrap_or_else(|| "Unknown error".to_string()),
            ));
        }

        self.initialized = true;
        Ok(response.device.unwrap_or_else(|| "mps".to_string()))
    }

    /// Warmup the TTS model (optional - primes caches for faster first generation)
    pub fn warmup(&mut self) -> Result<(), ChatterboxError> {
        // Only warmup if Qwen3-TTS engine - Chatterbox doesn't need it
        if self.engine != TTSEngine::Qwen3TTS {
            println!("[ChatterboxTTS] Warmup skipped - only needed for Qwen3-TTS");
            return Ok(());
        }

        if !self.initialized {
            println!("[ChatterboxTTS] Initializing model before warmup...");
            self.init_model()?;
        }

        let cmd = serde_json::json!({
            "action": "warmup",
        });

        self.send_command(&cmd)?;
        let response = self.read_response()?;

        if response.status != "ok" {
            return Err(ChatterboxError::GenerationError(
                response
                    .error
                    .unwrap_or_else(|| "Warmup failed".to_string()),
            ));
        }

        println!("[ChatterboxTTS] Warmup completed successfully");
        Ok(())
    }

    /// Generate speech from text
    pub fn generate(
        &mut self,
        text: &str,
        speed: f32,
    ) -> Result<ChatterboxResult, ChatterboxError> {
        if !self.initialized {
            return Err(ChatterboxError::ProcessNotRunning);
        }

        let cmd = serde_json::json!({
            "action": "generate",
            "text": text,
            "speed": speed,
            "temperature": 0.1,
        });

        self.send_command(&cmd)?;
        let response = self.read_response()?;

        if response.status != "ok" {
            return Err(ChatterboxError::GenerationError(
                response
                    .error
                    .unwrap_or_else(|| "Unknown error".to_string()),
            ));
        }

        // Decode base64 audio
        let audio_b64 = response
            .audio
            .ok_or_else(|| ChatterboxError::InvalidResponse("No audio in response".to_string()))?;

        let wav_bytes = base64::engine::general_purpose::STANDARD
            .decode(&audio_b64)
            .map_err(|e| ChatterboxError::InvalidResponse(format!("Base64 decode error: {}", e)))?;

        // Parse WAV and extract samples
        let audio = Self::wav_to_samples(&wav_bytes)?;
        let sample_rate = response.sample_rate.unwrap_or(24000);

        Ok(ChatterboxResult { audio, sample_rate })
    }

    /// Parse WAV bytes and extract f32 samples
    fn wav_to_samples(wav_bytes: &[u8]) -> Result<Vec<f32>, ChatterboxError> {
        // Simple WAV parser - assumes 16-bit PCM mono
        if wav_bytes.len() < 44 {
            return Err(ChatterboxError::InvalidResponse(
                "WAV data too short".to_string(),
            ));
        }

        // Verify RIFF header
        if &wav_bytes[0..4] != b"RIFF" || &wav_bytes[8..12] != b"WAVE" {
            return Err(ChatterboxError::InvalidResponse(
                "Invalid WAV header".to_string(),
            ));
        }

        // Find data chunk
        let mut pos = 12;
        while pos + 8 < wav_bytes.len() {
            let chunk_id = &wav_bytes[pos..pos + 4];
            let chunk_size = u32::from_le_bytes([
                wav_bytes[pos + 4],
                wav_bytes[pos + 5],
                wav_bytes[pos + 6],
                wav_bytes[pos + 7],
            ]) as usize;

            if chunk_id == b"data" {
                let data_start = pos + 8;
                let data_end = (data_start + chunk_size).min(wav_bytes.len());

                // Convert 16-bit samples to f32
                let mut samples = Vec::with_capacity((data_end - data_start) / 2);
                for chunk in wav_bytes[data_start..data_end].chunks_exact(2) {
                    let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                    samples.push(sample as f32 / 32768.0);
                }

                return Ok(samples);
            }

            pos += 8 + chunk_size;
            // Align to word boundary
            if chunk_size % 2 != 0 {
                pos += 1;
            }
        }

        Err(ChatterboxError::InvalidResponse(
            "No data chunk in WAV".to_string(),
        ))
    }

    /// Check if the model is loaded
    pub fn is_ready(&mut self) -> bool {
        if self.process.is_none() {
            return false;
        }

        let cmd = serde_json::json!({
            "action": "ping",
        });

        if self.send_command(&cmd).is_err() {
            return false;
        }

        match self.read_response() {
            Ok(response) => response.model_loaded.unwrap_or(false),
            Err(_) => false,
        }
    }

    /// Check if initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Shutdown the TTS process
    pub fn shutdown(&mut self) {
        let cmd = serde_json::json!({
            "action": "shutdown",
        });
        let _ = self.send_command(&cmd);

        if let Some(ref mut process) = self.process {
            let _ = process.kill();
        }
        self.process = None;
        self.initialized = false;
    }

    fn send_command(&mut self, cmd: &serde_json::Value) -> Result<(), ChatterboxError> {
        let process = self
            .process
            .as_mut()
            .ok_or(ChatterboxError::ProcessNotRunning)?;

        let stdin = process
            .stdin
            .as_mut()
            .ok_or(ChatterboxError::ProcessNotRunning)?;

        let json_str = serde_json::to_string(cmd)
            .map_err(|e| ChatterboxError::CommunicationError(e.to_string()))?;

        writeln!(stdin, "{}", json_str)
            .map_err(|e| ChatterboxError::CommunicationError(e.to_string()))?;

        stdin
            .flush()
            .map_err(|e| ChatterboxError::CommunicationError(e.to_string()))?;

        Ok(())
    }

    fn read_response(&mut self) -> Result<TTSResponse, ChatterboxError> {
        let process = self
            .process
            .as_mut()
            .ok_or(ChatterboxError::ProcessNotRunning)?;

        let stdout = process
            .stdout
            .as_mut()
            .ok_or(ChatterboxError::ProcessNotRunning)?;

        let mut reader = BufReader::new(stdout);
        let mut line = String::new();

        reader
            .read_line(&mut line)
            .map_err(|e| ChatterboxError::CommunicationError(e.to_string()))?;

        serde_json::from_str(&line)
            .map_err(|e| ChatterboxError::InvalidResponse(format!("JSON parse error: {}", e)))
    }
}

impl Default for ChatterboxTTS {
    fn default() -> Self {
        Self::new(TTSEngine::default())
    }
}

impl Drop for ChatterboxTTS {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Thread-safe wrapper for ChatterboxTTS
pub struct ChatterboxManager {
    inner: Mutex<ChatterboxTTS>,
}

impl ChatterboxManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(ChatterboxTTS::new(TTSEngine::default())),
        }
    }

    pub fn set_engine(&self, engine: TTSEngine) -> Result<(), ChatterboxError> {
        let mut tts = self.inner.lock().map_err(|_| {
            ChatterboxError::CommunicationError("Failed to acquire lock".to_string())
        })?;

        // Shutdown current engine
        tts.shutdown();

        // Create new engine instance inside the mutex (or just update state)
        // Since we refactored valid struct to hold state, we can just update the engine field and it will use new binary on next start
        tts.engine = engine;

        Ok(())
    }

    pub fn start(&self) -> Result<(), ChatterboxError> {
        let mut tts = self.inner.lock().map_err(|_| {
            ChatterboxError::CommunicationError("Failed to acquire lock".to_string())
        })?;
        tts.start()
    }

    pub fn init_model(&self) -> Result<String, ChatterboxError> {
        let mut tts = self.inner.lock().map_err(|_| {
            ChatterboxError::CommunicationError("Failed to acquire lock".to_string())
        })?;
        tts.init_model()
    }

    pub fn generate(&self, text: &str, speed: f32) -> Result<ChatterboxResult, ChatterboxError> {
        let mut tts = self.inner.lock().map_err(|_| {
            ChatterboxError::CommunicationError("Failed to acquire lock".to_string())
        })?;
        tts.generate(text, speed)
    }

    pub fn is_ready(&self) -> bool {
        if let Ok(mut tts) = self.inner.lock() {
            tts.is_ready()
        } else {
            false
        }
    }

    pub fn is_initialized(&self) -> bool {
        if let Ok(tts) = self.inner.lock() {
            tts.is_initialized()
        } else {
            false
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut tts) = self.inner.lock() {
            tts.shutdown();
        }
    }

    pub fn warmup(&self) -> Result<(), ChatterboxError> {
        let mut tts = self.inner.lock().map_err(|_| {
            ChatterboxError::CommunicationError("Failed to acquire lock".to_string())
        })?;
        tts.warmup()
    }
}

impl Default for ChatterboxManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Split text into chunks for TTS processing
pub fn split_into_chunks(text: &str, max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let sentences: Vec<&str> = text.split_inclusive(&['.', '!', '?'][..]).collect();
    let mut current_chunk = String::new();

    for sentence in sentences {
        if current_chunk.len() + sentence.len() > max_chars && !current_chunk.is_empty() {
            chunks.push(current_chunk.trim().to_string());
            current_chunk = sentence.to_string();
        } else {
            current_chunk.push_str(sentence);
        }
    }

    if !current_chunk.trim().is_empty() {
        chunks.push(current_chunk.trim().to_string());
    }

    chunks
}
