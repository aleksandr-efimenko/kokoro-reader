//! Python TTS bridge for Qwen3-TTS
//!
//! Communicates with a Python subprocess running the TTS model.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PythonTTSError {
    #[error("Failed to spawn Python process: {0}")]
    SpawnError(String),
    #[error("Python process not running")]
    ProcessNotRunning,
    #[error("Failed to communicate with Python: {0}")]
    CommunicationError(String),
    #[error("TTS generation failed: {0}")]
    GenerationError(String),
    #[error("Invalid response from Python: {0}")]
    InvalidResponse(String),
}

/// Response from the Python TTS server
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

/// Python TTS process manager
pub struct PythonTTS {
    process: Option<Child>,
    initialized: bool,
}

impl PythonTTS {
    pub fn new() -> Self {
        Self {
            process: None,
            initialized: false,
        }
    }

    /// Start the Python TTS server
    pub fn start(&mut self, python_script_path: &str) -> Result<(), PythonTTSError> {
        if self.process.is_some() {
            return Ok(()); // Already running
        }

        // Try python3 first, then python
        let python_cmd = if Command::new("python3").arg("--version").output().is_ok() {
            "python3"
        } else {
            "python"
        };

        let child = Command::new(python_cmd)
            .arg(python_script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit()) // Show Python logs in console
            .spawn()
            .map_err(|e| PythonTTSError::SpawnError(e.to_string()))?;

        self.process = Some(child);

        // Wait for ready signal
        let response = self.read_response()?;
        if response.status != "ok" || response.action != "ready" {
            return Err(PythonTTSError::SpawnError(
                "Python server did not signal ready".to_string(),
            ));
        }

        Ok(())
    }

    /// Initialize the TTS model
    pub fn init_model(&mut self, model_size: &str) -> Result<String, PythonTTSError> {
        let cmd = serde_json::json!({
            "action": "init",
            "model_size": model_size,
        });

        self.send_command(&cmd)?;
        let response = self.read_response()?;

        if response.status != "ok" {
            return Err(PythonTTSError::GenerationError(
                response.error.unwrap_or_else(|| "Unknown error".to_string()),
            ));
        }

        self.initialized = true;
        Ok(response.device.unwrap_or_else(|| "unknown".to_string()))
    }

    /// Generate speech from text
    pub fn generate(&mut self, text: &str, speed: f32) -> Result<Vec<u8>, PythonTTSError> {
        if !self.initialized {
            return Err(PythonTTSError::ProcessNotRunning);
        }

        let cmd = serde_json::json!({
            "action": "generate",
            "text": text,
            "speed": speed,
        });

        self.send_command(&cmd)?;
        let response = self.read_response()?;

        if response.status != "ok" {
            return Err(PythonTTSError::GenerationError(
                response.error.unwrap_or_else(|| "Unknown error".to_string()),
            ));
        }

        // Decode base64 audio
        let audio_b64 = response
            .audio
            .ok_or_else(|| PythonTTSError::InvalidResponse("No audio in response".to_string()))?;

        use base64::Engine;
        let wav_bytes = base64::engine::general_purpose::STANDARD
            .decode(&audio_b64)
            .map_err(|e| PythonTTSError::InvalidResponse(format!("Base64 decode error: {}", e)))?;

        Ok(wav_bytes)
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

    /// Shutdown the Python process
    pub fn shutdown(&mut self) {
        // Send shutdown command first (while process is still Some)
        let cmd = serde_json::json!({
            "action": "shutdown",
        });
        let _ = self.send_command(&cmd);

        // Then kill the process
        if let Some(ref mut process) = self.process {
            let _ = process.kill();
        }
        self.process = None;
        self.initialized = false;
    }

    fn send_command(&mut self, cmd: &serde_json::Value) -> Result<(), PythonTTSError> {
        let process = self
            .process
            .as_mut()
            .ok_or(PythonTTSError::ProcessNotRunning)?;

        let stdin = process
            .stdin
            .as_mut()
            .ok_or(PythonTTSError::ProcessNotRunning)?;

        let json_str = serde_json::to_string(cmd)
            .map_err(|e| PythonTTSError::CommunicationError(e.to_string()))?;

        writeln!(stdin, "{}", json_str)
            .map_err(|e| PythonTTSError::CommunicationError(e.to_string()))?;

        stdin
            .flush()
            .map_err(|e| PythonTTSError::CommunicationError(e.to_string()))?;

        Ok(())
    }

    fn read_response(&mut self) -> Result<TTSResponse, PythonTTSError> {
        let process = self
            .process
            .as_mut()
            .ok_or(PythonTTSError::ProcessNotRunning)?;

        let stdout = process
            .stdout
            .as_mut()
            .ok_or(PythonTTSError::ProcessNotRunning)?;

        let mut reader = BufReader::new(stdout);
        let mut line = String::new();

        reader
            .read_line(&mut line)
            .map_err(|e| PythonTTSError::CommunicationError(e.to_string()))?;

        serde_json::from_str(&line)
            .map_err(|e| PythonTTSError::InvalidResponse(format!("JSON parse error: {}", e)))
    }
}

impl Default for PythonTTS {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for PythonTTS {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Thread-safe wrapper for PythonTTS
pub struct PythonTTSManager {
    inner: Mutex<PythonTTS>,
}

impl PythonTTSManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(PythonTTS::new()),
        }
    }

    pub fn start(&self, script_path: &str) -> Result<(), PythonTTSError> {
        let mut tts = self.inner.lock().map_err(|_| {
            PythonTTSError::CommunicationError("Failed to acquire lock".to_string())
        })?;
        tts.start(script_path)
    }

    pub fn init_model(&self, model_size: &str) -> Result<String, PythonTTSError> {
        let mut tts = self.inner.lock().map_err(|_| {
            PythonTTSError::CommunicationError("Failed to acquire lock".to_string())
        })?;
        tts.init_model(model_size)
    }

    pub fn generate(&self, text: &str, speed: f32) -> Result<Vec<u8>, PythonTTSError> {
        let mut tts = self.inner.lock().map_err(|_| {
            PythonTTSError::CommunicationError("Failed to acquire lock".to_string())
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

    pub fn shutdown(&self) {
        if let Ok(mut tts) = self.inner.lock() {
            tts.shutdown();
        }
    }
}

impl Default for PythonTTSManager {
    fn default() -> Self {
        Self::new()
    }
}
