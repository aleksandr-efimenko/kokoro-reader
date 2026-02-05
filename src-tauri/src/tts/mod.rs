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
        TTSEngine::Qwen3TTS
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
    /// Get default Qwen3 TTS voice
    pub fn default_voice() -> Self {
        Self {
            id: "ryan".to_string(),
            name: "Ryan (Deep Male)".to_string(),
            language: "en".to_string(),
        }
    }

    /// Get available voices for Qwen3 TTS CustomVoice model
    /// Available: serena, vivian, uncle_fu, ryan, aiden, ono_anna, sohee, eric, dylan
    pub fn get_voices() -> Vec<Voice> {
        vec![
            Self::default_voice(),
            Self {
                id: "eric".to_string(),
                name: "Eric (Male)".to_string(),
                language: "en".to_string(),
            },
            Self {
                id: "dylan".to_string(),
                name: "Dylan (Male)".to_string(),
                language: "en".to_string(),
            },
            Self {
                id: "aiden".to_string(),
                name: "Aiden (Young Male)".to_string(),
                language: "en".to_string(),
            },
            Self {
                id: "serena".to_string(),
                name: "Serena (Female)".to_string(),
                language: "en".to_string(),
            },
            Self {
                id: "vivian".to_string(),
                name: "Vivian (Female)".to_string(),
                language: "en".to_string(),
            },
        ]
    }
}
