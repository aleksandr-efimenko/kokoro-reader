//! TTS module for Kokoro text-to-speech engine

mod audio;
mod download;
mod kokoro;

pub use audio::AudioPlayer;
pub use download::{DownloadProgress, DownloadStatus, ModelDownloader, ModelFiles, get_default_model_dir};
pub use kokoro::{KokoroTTS, Voice};
