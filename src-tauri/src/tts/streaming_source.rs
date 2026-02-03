//! Channel-backed streaming audio source for rodio.
//!
//! Receives f32 audio samples progressively via a crossbeam channel
//! and implements `rodio::Source` for direct sink playback.

use crossbeam_channel::Receiver;
use rodio::Source;
use std::collections::VecDeque;
use std::time::Duration;

/// A rodio Source that receives f32 audio samples progressively via a channel.
///
/// Yields samples as they arrive from the generator. When the channel is empty
/// but still open (generator slower than playback), yields silence. When the
/// channel is closed and all buffered samples are consumed, returns None.
pub struct StreamingSource {
    rx: Receiver<Vec<f32>>,
    buffer: VecDeque<f32>,
    sample_rate: u32,
    finished: bool,
}

impl StreamingSource {
    pub fn new(rx: Receiver<Vec<f32>>, sample_rate: u32) -> Self {
        Self {
            rx,
            buffer: VecDeque::with_capacity(48000), // ~2 seconds at 24kHz
            sample_rate,
            finished: false,
        }
    }

    /// Non-blocking drain of all available chunks from the channel.
    fn try_fill_buffer(&mut self) {
        while let Ok(samples) = self.rx.try_recv() {
            self.buffer.extend(samples);
        }
    }
}

impl Iterator for StreamingSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.finished {
            return None;
        }

        // Try buffer first
        if let Some(sample) = self.buffer.pop_front() {
            return Some(sample);
        }

        // Buffer empty -- try to receive more with a short timeout
        match self.rx.recv_timeout(Duration::from_millis(50)) {
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
