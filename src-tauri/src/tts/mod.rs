//! TTS module for text-to-speech engines

mod audio;
mod chatterbox;
pub mod echo_tts;
mod playback;
pub mod streaming_source;

pub use audio::AudioPlayer;
pub use chatterbox::{ChatterboxManager, ChatterboxError};
pub use echo_tts::{EchoManager, EchoError};
pub use playback::{PlaybackManager, TtsPlaybackEvent};
pub use streaming_source::StreamingSource;

/// Available TTS engines
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TTSEngine {
    /// Echo-1B: Native Rust, streaming, GPU accelerated (default)
    Echo,
    /// Chatterbox: Python sidecar, macOS MLX (legacy)
    Chatterbox,
    /// Qwen3-TTS: Python sidecar, CUDA (legacy)
    Qwen3TTS,
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
    pub fn get_voices(engine: TTSEngine) -> Vec<Voice> {
        match engine {
            TTSEngine::Echo => vec![
                Self {
                    id: "0".to_string(),
                    name: "Echo Default".to_string(),
                    language: "en".to_string(),
                },
            ],
            TTSEngine::Chatterbox => vec![Self {
                id: "default".to_string(),
                name: "Chatterbox".to_string(),
                language: "en".to_string(),
            }],
            TTSEngine::Qwen3TTS => vec![Self {
                id: "default".to_string(),
                name: "Qwen3 Default".to_string(),
                language: "en".to_string(),
            }],
        }
    }
}
