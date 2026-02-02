//! Piper TTS engine
//!
//! High-quality offline text-to-speech using Piper ONNX models.

use piper_rs::synth::PiperSpeechSynthesizer;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PiperError {
    #[error("Model not found: {0}")]
    ModelNotFound(String),
    #[error("Failed to initialize Piper: {0}")]
    InitError(String),
    #[error("Failed to synthesize speech: {0}")]
    SynthesisError(String),
    #[error("Invalid voice: {0}")]
    InvalidVoice(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

/// Voice configuration for Piper
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PiperVoice {
    pub id: String,
    pub name: String,
    pub language: String,
    pub quality: String,
    pub model_file: String,
}

impl PiperVoice {
    /// Get list of available voices (built-in)
    pub fn available_voices() -> Vec<PiperVoice> {
        vec![
            PiperVoice {
                id: "en_US-amy-medium".to_string(),
                name: "Amy".to_string(),
                language: "en-US".to_string(),
                quality: "medium".to_string(),
                model_file: "en_US-amy-medium.onnx".to_string(),
            },
            PiperVoice {
                id: "en_US-lessac-medium".to_string(),
                name: "Lessac".to_string(),
                language: "en-US".to_string(),
                quality: "medium".to_string(),
                model_file: "en_US-lessac-medium.onnx".to_string(),
            },
            PiperVoice {
                id: "en_GB-alba-medium".to_string(),
                name: "Alba (British)".to_string(),
                language: "en-GB".to_string(),
                quality: "medium".to_string(),
                model_file: "en_GB-alba-medium.onnx".to_string(),
            },
            PiperVoice {
                id: "en_US-ryan-medium".to_string(),
                name: "Ryan".to_string(),
                language: "en-US".to_string(),
                quality: "medium".to_string(),
                model_file: "en_US-ryan-medium.onnx".to_string(),
            },
        ]
    }
}

/// Piper TTS engine
pub struct PiperTTS {
    model_dir: PathBuf,
    synthesizer: Option<Arc<PiperSpeechSynthesizer>>,
    current_voice: Option<String>,
    sample_rate: u32,
}

impl PiperTTS {
    pub fn new() -> Self {
        Self {
            model_dir: PathBuf::new(),
            synthesizer: None,
            current_voice: None,
            sample_rate: 22050, // Piper default
        }
    }

    /// Set the model directory
    pub fn set_model_dir(&mut self, dir: &Path) {
        self.model_dir = dir.to_path_buf();
    }

    /// Load a voice model
    pub fn load_voice(&mut self, voice_id: &str) -> Result<(), PiperError> {
        // Find the voice configuration
        let voices = PiperVoice::available_voices();
        let voice = voices
            .iter()
            .find(|v| v.id == voice_id)
            .ok_or_else(|| PiperError::InvalidVoice(voice_id.to_string()))?;

        let model_path = self.model_dir.join(&voice.model_file);
        let config_path = self.model_dir.join(format!("{}.json", voice.model_file.trim_end_matches(".onnx")));

        if !model_path.exists() {
            return Err(PiperError::ModelNotFound(
                model_path.to_string_lossy().to_string(),
            ));
        }

        // Load the model
        let model = piper_rs::from_config_path(config_path)
            .map_err(|e| PiperError::InitError(format!("Failed to load config: {}", e)))?;

        let synth = PiperSpeechSynthesizer::new(model)
            .map_err(|e| PiperError::InitError(format!("Failed to create synthesizer: {}", e)))?;

        self.synthesizer = Some(Arc::new(synth));
        self.current_voice = Some(voice_id.to_string());

        Ok(())
    }

    /// Check if a model is loaded
    pub fn is_loaded(&self) -> bool {
        self.synthesizer.is_some()
    }

    /// Get the current voice ID
    pub fn current_voice(&self) -> Option<&str> {
        self.current_voice.as_deref()
    }

    /// Synthesize speech from text
    pub fn synthesize(&self, text: &str, _speed: f32) -> Result<PiperAudio, PiperError> {
        let synth = self.synthesizer.as_ref()
            .ok_or_else(|| PiperError::InitError("No model loaded".to_string()))?;

        // Generate audio samples
        let audio_result = synth.synthesize_parallel(text.to_string(), None)
            .map_err(|e| PiperError::SynthesisError(e.to_string()))?;

        // Collect all audio data
        let mut samples: Vec<f32> = Vec::new();
        for result in audio_result {
            let chunk = result.map_err(|e| PiperError::SynthesisError(e.to_string()))?;
            samples.extend(chunk.audio.iter().map(|&s| s as f32 / 32768.0));
        }

        Ok(PiperAudio {
            samples,
            sample_rate: self.sample_rate,
        })
    }
}

impl Default for PiperTTS {
    fn default() -> Self {
        Self::new()
    }
}

/// Audio output from Piper
pub struct PiperAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

impl PiperAudio {
    /// Convert to WAV bytes
    pub fn to_wav(&self) -> Vec<u8> {
        let num_samples = self.samples.len();
        let byte_rate = self.sample_rate * 2; // 16-bit mono
        let data_size = num_samples * 2;
        let file_size = 36 + data_size;

        let mut buffer = Vec::with_capacity(44 + data_size);

        // RIFF header
        buffer.extend_from_slice(b"RIFF");
        buffer.extend_from_slice(&(file_size as u32).to_le_bytes());
        buffer.extend_from_slice(b"WAVE");

        // fmt chunk
        buffer.extend_from_slice(b"fmt ");
        buffer.extend_from_slice(&16u32.to_le_bytes()); // Chunk size
        buffer.extend_from_slice(&1u16.to_le_bytes());  // PCM format
        buffer.extend_from_slice(&1u16.to_le_bytes());  // Mono
        buffer.extend_from_slice(&self.sample_rate.to_le_bytes());
        buffer.extend_from_slice(&byte_rate.to_le_bytes());
        buffer.extend_from_slice(&2u16.to_le_bytes());  // Block align
        buffer.extend_from_slice(&16u16.to_le_bytes()); // Bits per sample

        // data chunk
        buffer.extend_from_slice(b"data");
        buffer.extend_from_slice(&(data_size as u32).to_le_bytes());

        // Audio samples
        for sample in &self.samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let int_sample = (clamped * 32767.0) as i16;
            buffer.extend_from_slice(&int_sample.to_le_bytes());
        }

        buffer
    }
}

/// Get the default Piper model directory
pub fn get_piper_model_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.kokororeader.app");

    #[cfg(target_os = "windows")]
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("KokoroReader");

    #[cfg(target_os = "linux")]
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("kokoro-reader");

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let base = PathBuf::from(".").join("kokoro-reader-data");

    base.join("piper-models")
}

/// Download URLs for Piper voices (HuggingFace)
pub fn get_voice_download_url(voice_id: &str) -> Option<(String, String)> {
    let base_url = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

    match voice_id {
        "en_US-amy-medium" => Some((
            format!("{}/en/en_US/amy/medium/en_US-amy-medium.onnx", base_url),
            format!("{}/en/en_US/amy/medium/en_US-amy-medium.onnx.json", base_url),
        )),
        "en_US-lessac-medium" => Some((
            format!("{}/en/en_US/lessac/medium/en_US-lessac-medium.onnx", base_url),
            format!("{}/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json", base_url),
        )),
        "en_GB-alba-medium" => Some((
            format!("{}/en/en_GB/alba/medium/en_GB-alba-medium.onnx", base_url),
            format!("{}/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json", base_url),
        )),
        "en_US-ryan-medium" => Some((
            format!("{}/en/en_US/ryan/medium/en_US-ryan-medium.onnx", base_url),
            format!("{}/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json", base_url),
        )),
        _ => None,
    }
}
