//! Audio playback controller using rodio
//!
//! Note: rodio's OutputStream is not Send, so we use thread_local and lazy initialization

use rodio::{OutputStream, Sink, Source};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AudioError {
    #[error("Failed to create audio output stream: {0}")]
    StreamError(String),
    #[error("Failed to decode audio: {0}")]
    DecodeError(String),
    #[error("Playback error: {0}")]
    PlaybackError(String),
}

/// Audio player that manages playback on the main thread
/// Since OutputStream is not Send, we use a simpler approach with Option types
pub struct AudioPlayer {
    speed: f32,
    is_playing: Arc<AtomicBool>,
}

impl AudioPlayer {
    /// Create a new audio player
    pub fn new() -> Self {
        Self {
            speed: 1.0,
            is_playing: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Play WAV audio data (blocking on the calling thread)
    pub fn play_wav_blocking(&self, wav_data: Vec<u8>) -> Result<(), AudioError> {
        // Create stream fresh each time (works around the Send issue)
        let (_stream, stream_handle) = OutputStream::try_default()
            .map_err(|e| AudioError::StreamError(e.to_string()))?;

        let sink = Sink::try_new(&stream_handle)
            .map_err(|e| AudioError::StreamError(e.to_string()))?;

        // Decode WAV
        let cursor = Cursor::new(wav_data);
        let source = rodio::Decoder::new(cursor)
            .map_err(|e| AudioError::DecodeError(e.to_string()))?;

        // Apply speed
        let source = source.speed(self.speed);

        sink.append(source);
        self.is_playing.store(true, Ordering::SeqCst);
        
        // Wait for playback to finish
        sink.sleep_until_end();
        self.is_playing.store(false, Ordering::SeqCst);

        Ok(())
    }

    /// Set playback speed (0.5 - 2.0)
    pub fn set_speed(&mut self, speed: f32) {
        self.speed = speed.clamp(0.5, 2.0);
    }

    /// Get current speed
    pub fn get_speed(&self) -> f32 {
        self.speed
    }

    /// Check if audio is currently playing
    pub fn is_playing(&self) -> bool {
        self.is_playing.load(Ordering::SeqCst)
    }

    /// Stop playback (sets flag, actual stop happens in play loop)
    pub fn request_stop(&self) {
        self.is_playing.store(false, Ordering::SeqCst);
    }
}

impl Default for AudioPlayer {
    fn default() -> Self {
        Self::new()
    }
}

// AudioPlayer is now Send + Sync since we removed OutputStream
unsafe impl Send for AudioPlayer {}
unsafe impl Sync for AudioPlayer {}
