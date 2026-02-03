//! Channel-backed streaming audio source for rodio.
//!
//! Receives f32 audio samples progressively via a crossbeam channel
//! and implements `rodio::Source` for direct sink playback.

use crossbeam_channel::Receiver;
use rodio::Source;
use std::collections::VecDeque;
use std::time::Duration;

/// Minimum samples to buffer before starting playback (~5 seconds at 24kHz).
/// This prevents stuttering when the generator is slower than playback.
const MIN_BUFFER_SAMPLES: usize = 120000;

/// Timeout for blocking receive when buffer is low (ms).
const BUFFER_FILL_TIMEOUT_MS: u64 = 200;

/// A rodio Source that receives f32 audio samples progressively via a channel.
///
/// Buffers audio samples before starting playback to prevent stuttering.
/// When the channel is empty but still open (generator slower than playback),
/// yields silence. When the channel is closed and all buffered samples are
/// consumed, returns None.
pub struct StreamingSource {
    rx: Receiver<Vec<f32>>,
    buffer: VecDeque<f32>,
    sample_rate: u32,
    finished: bool,
    initial_buffer_filled: bool,
}

impl StreamingSource {
    pub fn new(rx: Receiver<Vec<f32>>, sample_rate: u32) -> Self {
        Self {
            rx,
            buffer: VecDeque::with_capacity(MIN_BUFFER_SAMPLES * 2), // Room for ~4 seconds
            sample_rate,
            finished: false,
            initial_buffer_filled: false,
        }
    }

    /// Non-blocking drain of all available chunks from the channel.
    fn try_fill_buffer(&mut self) {
        while let Ok(samples) = self.rx.try_recv() {
            self.buffer.extend(samples);
        }
    }

    /// Block until we have enough samples buffered for smooth playback.
    fn fill_initial_buffer(&mut self) {
        eprintln!(
            "[StreamingSource] Filling initial buffer (target: {} samples)...",
            MIN_BUFFER_SAMPLES
        );

        while self.buffer.len() < MIN_BUFFER_SAMPLES {
            match self
                .rx
                .recv_timeout(Duration::from_millis(BUFFER_FILL_TIMEOUT_MS))
            {
                Ok(samples) => {
                    self.buffer.extend(samples);
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    // Keep waiting - generator is slow
                    continue;
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                    // Generator finished before buffer is full - use what we have
                    eprintln!(
                        "[StreamingSource] Generator finished early, buffer has {} samples",
                        self.buffer.len()
                    );
                    break;
                }
            }
        }

        self.initial_buffer_filled = true;
        eprintln!(
            "[StreamingSource] Buffer filled: {} samples ({:.1}s), starting playback",
            self.buffer.len(),
            self.buffer.len() as f64 / self.sample_rate as f64
        );
    }
}

impl Iterator for StreamingSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.finished {
            return None;
        }

        // Fill initial buffer before yielding any audio
        if !self.initial_buffer_filled {
            self.fill_initial_buffer();
        }

        // Try buffer first
        if let Some(sample) = self.buffer.pop_front() {
            // Opportunistically fill buffer while playing
            self.try_fill_buffer();
            return Some(sample);
        }

        // Buffer empty -- try to receive more with a longer timeout
        match self.rx.recv_timeout(Duration::from_millis(100)) {
            Ok(samples) => {
                self.buffer.extend(samples);
                self.buffer.pop_front()
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                // Generator is slower than playback -- yield silence
                Some(0.0)
            }
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                // Stream ended -- drain any remaining buffered data
                self.try_fill_buffer();
                if let Some(sample) = self.buffer.pop_front() {
                    Some(sample)
                } else {
                    self.finished = true;
                    None
                }
            }
        }
    }
}

impl Source for StreamingSource {
    fn current_frame_len(&self) -> Option<usize> {
        None // Unknown length (streaming)
    }

    fn channels(&self) -> u16 {
        1 // Mono (Mimi codec outputs mono 24kHz)
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None // Unknown (streaming)
    }
}
