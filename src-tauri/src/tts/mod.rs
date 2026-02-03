//! TTS module for text-to-speech engines

mod audio;
// Python-based TTS engines temporarily disabled
// mod chatterbox;
pub mod echo_tts;
mod playback;
pub mod streaming_source;

pub use audio::AudioPlayer;
// pub use chatterbox::{ChatterboxManager, ChatterboxError};
pub use echo_tts::{EchoError, EchoManager};
pub use playback::{PlaybackManager, TtsPlaybackEvent};
pub use streaming_source::StreamingSource;

/// Available TTS engines
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TTSEngine {
    /// Echo-1B: Native Rust, streaming, GPU accelerated (default)
    Echo,
    // Python-based engines temporarily disabled
    // /// Chatterbox: Python sidecar, macOS MLX (legacy)
    // Chatterbox,
    // /// Qwen3-TTS: Python sidecar, CUDA (legacy)
    // Qwen3TTS,
}

impl Default for TTSEngine {
    fn default() -> Self {
        TTSEngine::Echo
    }
}

/// Voice information for TTS
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Voice {
    pub id: String,
    pub name: String,
    pub language: String,
}

impl Voice {
    /// Get default voice
    pub fn default_voice() -> Self {
        Self {
            id: "0".to_string(),
            name: "Echo Default".to_string(),
            language: "en".to_string(),
        }
    }

    /// Get available voices for the current engine
    pub fn get_voices(_engine: TTSEngine) -> Vec<Voice> {
        // Only Echo engine is currently active
        vec![Self {
            id: "0".to_string(),
            name: "Echo Default".to_string(),
            language: "en".to_string(),
        }]
        // Python-based engines temporarily disabled
        // match engine {
        //     TTSEngine::Echo => vec![...],
        //     TTSEngine::Chatterbox => vec![...],
        //     TTSEngine::Qwen3TTS => vec![...],
        // }
    }
}
