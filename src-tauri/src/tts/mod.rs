//! TTS module for text-to-speech engines

mod audio;
mod chatterbox;
mod playback;

pub use audio::AudioPlayer;
pub use chatterbox::{ChatterboxManager, ChatterboxError};
pub use playback::{PlaybackManager, TtsPlaybackEvent};

/// Available TTS engines
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TTSEngine {
    Chatterbox,
    Qwen3TTS,
}

impl Default for TTSEngine {
    fn default() -> Self {
        TTSEngine::Chatterbox
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
    /// Get default Chatterbox voice
    pub fn default_voice() -> Self {
        Self {
            id: "default".to_string(),
            name: "Chatterbox".to_string(),
            language: "en".to_string(),
        }
    }

    /// Get available voices (Chatterbox currently has one voice)
    pub fn get_voices() -> Vec<Voice> {
        vec![Self::default_voice()]
    }
}
