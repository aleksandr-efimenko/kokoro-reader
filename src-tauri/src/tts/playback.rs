//! Playback queue and controls for TTS audio
//!
//! Runs a dedicated audio thread that owns rodio OutputStream/Sink and can
//! play queued WAV chunks sequentially with gapless transitions.

use rodio::{Decoder, OutputStream, Sink, Source};
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct TtsPlaybackEvent {
    pub session_id: String,
    pub chunk_index: usize,
    pub event: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
struct QueuedChunk {
    session_id: String,
    chunk_index: usize,
    wav_data: Vec<u8>,
    speed: f32,
}

#[derive(Debug)]
enum PlaybackCmd {
    StartSession { session_id: String },
    EnqueueWav(QueuedChunk),
    Stop,
    Pause,
    Resume,
}

#[derive(Debug, Default)]
pub struct PlaybackStatus {
    pub is_playing: AtomicBool,
    pub is_paused: AtomicBool,
    /// Number of chunks currently queued in the audio sink
    pub queued_count: AtomicUsize,
    /// Index of the chunk currently playing
    pub current_chunk: AtomicUsize,
}

/// Manages a background audio thread and a queue of chunks.
///
/// Uses a persistent Sink for gapless playback - chunks are appended
/// sequentially and play without gaps.
pub struct PlaybackManager {
    tx: mpsc::Sender<PlaybackCmd>,
    status: Arc<PlaybackStatus>,
    pub current_session_id: Arc<std::sync::Mutex<Option<String>>>,
}

impl Clone for PlaybackManager {
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
            status: Arc::clone(&self.status),
            current_session_id: Arc::clone(&self.current_session_id),
        }
    }
}

impl PlaybackManager {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<PlaybackCmd>();
        let status = Arc::new(PlaybackStatus::default());
        let current_session_id = Arc::new(std::sync::Mutex::new(None));

        let status_for_thread = Arc::clone(&status);
        thread::spawn(move || audio_thread_main(app, rx, status_for_thread));

        Self {
            tx,
            status,
            current_session_id,
        }
    }

    pub fn start_session(&self, session_id: String) {
        // Update current session ID immediately so enqueuers can see it
        if let Ok(mut id) = self.current_session_id.lock() {
            *id = Some(session_id.clone());
        }
        let _ = self.tx.send(PlaybackCmd::StartSession { session_id });
    }

    pub fn enqueue_wav(
        &self,
        session_id: String,
        chunk_index: usize,
        wav_data: Vec<u8>,
        speed: f32,
    ) {
        let _ = self.tx.send(PlaybackCmd::EnqueueWav(QueuedChunk {
            session_id,
            chunk_index,
            wav_data,
            speed,
        }));
    }

    pub fn stop(&self) {
        // clear session id
        if let Ok(mut id) = self.current_session_id.lock() {
            *id = None;
        }
        let _ = self.tx.send(PlaybackCmd::Stop);
    }

    pub fn pause(&self) {
        let _ = self.tx.send(PlaybackCmd::Pause);
    }

    pub fn resume(&self) {
        let _ = self.tx.send(PlaybackCmd::Resume);
    }

    pub fn is_playing(&self) -> bool {
        self.status.is_playing.load(Ordering::SeqCst)
    }

    pub fn is_paused(&self) -> bool {
        self.status.is_paused.load(Ordering::SeqCst)
    }
}

fn emit_event(app: &AppHandle, payload: TtsPlaybackEvent) {
    let _ = app.emit("tts-playback-event", payload);
}

fn audio_thread_main(app: AppHandle, rx: mpsc::Receiver<PlaybackCmd>, status: Arc<PlaybackStatus>) {
    let mut active_session: Option<String> = None;

    // Track which chunk index we expect next for ordering
    let mut next_expected_index: usize = 0;

    // Track how many chunks have been appended to the sink
    let mut chunks_queued_to_sink: usize = 0;

    // Track which chunk is currently playing (for events)
    let mut current_playing_chunk: usize = 0;

    // WAVs that arrived out of order, waiting for their turn
    let mut pending_by_index: BTreeMap<usize, (Vec<u8>, f32)> = BTreeMap::new();

    // Create the output stream once for the lifetime of the thread
    let (_stream, stream_handle) = match OutputStream::try_default() {
        Ok(v) => v,
        Err(e) => {
            emit_event(
                &app,
                TtsPlaybackEvent {
                    session_id: "".to_string(),
                    chunk_index: 0,
                    event: "error".to_string(),
                    message: Some(format!("Failed to create audio output stream: {}", e)),
                },
            );
            return;
        }
    };

    // Persistent sink for the current session - enables gapless playback
    let mut session_sink: Option<Sink> = None;

    // Track the last known "len" of the sink to detect when chunks finish
    let mut last_sink_len: usize = 0;

    loop {
        // Receive commands with timeout for polling sink state
        let cmd = match rx.recv_timeout(Duration::from_millis(25)) {
            Ok(cmd) => Some(cmd),
            Err(mpsc::RecvTimeoutError::Timeout) => None,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        // Handle command if we got one
        if let Some(cmd) = cmd {
            match cmd {
                PlaybackCmd::StartSession { session_id } => {
                    // Stop any existing playback
                    if let Some(sink) = session_sink.take() {
                        sink.stop();
                    }

                    // Clear pending chunks
                    pending_by_index.clear();

                    // Create new persistent sink for this session
                    match Sink::try_new(&stream_handle) {
                        Ok(sink) => {
                            session_sink = Some(sink);
                        }
                        Err(e) => {
                            emit_event(
                                &app,
                                TtsPlaybackEvent {
                                    session_id: session_id.clone(),
                                    chunk_index: 0,
                                    event: "error".to_string(),
                                    message: Some(format!("Failed to create audio sink: {}", e)),
                                },
                            );
                        }
                    }

                    // Reset state
                    active_session = Some(session_id);
                    next_expected_index = 0;
                    chunks_queued_to_sink = 0;
                    current_playing_chunk = 0;
                    last_sink_len = 0;

                    status.is_playing.store(false, Ordering::SeqCst);
                    status.is_paused.store(false, Ordering::SeqCst);
                    status.queued_count.store(0, Ordering::SeqCst);
                    status.current_chunk.store(0, Ordering::SeqCst);
                }

                PlaybackCmd::EnqueueWav(chunk) => {
                    // Ignore chunks from old sessions
                    if active_session.as_deref() != Some(chunk.session_id.as_str()) {
                        continue;
                    }

                    // Store chunk (may be out of order)
                    pending_by_index.insert(chunk.chunk_index, (chunk.wav_data, chunk.speed));

                    emit_event(
                        &app,
                        TtsPlaybackEvent {
                            session_id: chunk.session_id,
                            chunk_index: chunk.chunk_index,
                            event: "chunk_ready".to_string(),
                            message: None,
                        },
                    );
                }

                PlaybackCmd::Stop => {
                    if let Some(sink) = session_sink.take() {
                        sink.stop();
                    }
                    pending_by_index.clear();
                    active_session = None;
                    next_expected_index = 0;
                    chunks_queued_to_sink = 0;
                    current_playing_chunk = 0;
                    last_sink_len = 0;

                    status.is_playing.store(false, Ordering::SeqCst);
                    status.is_paused.store(false, Ordering::SeqCst);
                    status.queued_count.store(0, Ordering::SeqCst);
                }

                PlaybackCmd::Pause => {
                    if let Some(sink) = session_sink.as_ref() {
                        sink.pause();
                        status.is_paused.store(true, Ordering::SeqCst);
                    }
                }

                PlaybackCmd::Resume => {
                    if let Some(sink) = session_sink.as_ref() {
                        sink.play();
                        status.is_paused.store(false, Ordering::SeqCst);
                    }
                }
            }
        }

        // Skip processing if no active session
        let Some(session_id) = active_session.clone() else {
            continue;
        };

        let Some(sink) = session_sink.as_ref() else {
            continue;
        };

        // Append any pending chunks that are ready (in order)
        while let Some((wav_data, speed)) = pending_by_index.remove(&next_expected_index) {
            let cursor = Cursor::new(wav_data);
            match Decoder::new(cursor) {
                Ok(source) => {
                    // Apply speed adjustment and append to sink
                    let source = source.speed(speed.clamp(0.5, 2.0));
                    sink.append(source);

                    chunks_queued_to_sink += 1;
                    next_expected_index += 1;

                    // Update status
                    let queued = sink.len();
                    status.queued_count.store(queued, Ordering::SeqCst);

                    // If this is the first chunk OR we ran dry (last_sink_len == 0), emit started event
                    if last_sink_len == 0 {
                        status.is_playing.store(true, Ordering::SeqCst);
                        emit_event(
                            &app,
                            TtsPlaybackEvent {
                                session_id: session_id.clone(),
                                chunk_index: current_playing_chunk,
                                event: "chunk_started".to_string(),
                                message: None,
                            },
                        );
                        // Do NOT reset current_playing_chunk here, we are continuing
                        last_sink_len = queued;
                    }

                    emit_event(
                        &app,
                        TtsPlaybackEvent {
                            session_id: session_id.clone(),
                            chunk_index: next_expected_index - 1,
                            event: "chunk_queued".to_string(),
                            message: None,
                        },
                    );
                }
                Err(e) => {
                    emit_event(
                        &app,
                        TtsPlaybackEvent {
                            session_id: session_id.clone(),
                            chunk_index: next_expected_index,
                            event: "error".to_string(),
                            message: Some(format!("Failed to decode WAV: {}", e)),
                        },
                    );
                    next_expected_index += 1;
                }
            }
        }

        // Monitor sink state for chunk transitions
        let current_len = sink.len();

        // Update pause state
        if sink.is_paused() {
            status.is_paused.store(true, Ordering::SeqCst);
        } else {
            status.is_paused.store(false, Ordering::SeqCst);
        }

        // Detect when a chunk finishes (sink length decreases)
        if current_len < last_sink_len && current_len > 0 {
            // A chunk finished playing, emit event
            emit_event(
                &app,
                TtsPlaybackEvent {
                    session_id: session_id.clone(),
                    chunk_index: current_playing_chunk,
                    event: "chunk_finished".to_string(),
                    message: None,
                },
            );

            current_playing_chunk += 1;
            status
                .current_chunk
                .store(current_playing_chunk, Ordering::SeqCst);

            // Emit started event for the next chunk
            emit_event(
                &app,
                TtsPlaybackEvent {
                    session_id: session_id.clone(),
                    chunk_index: current_playing_chunk,
                    event: "chunk_started".to_string(),
                    message: None,
                },
            );
        }

        // Detect when all playback is done (sink became empty)
        if sink.empty() && chunks_queued_to_sink > 0 {
            // Last chunk in the sink finished
            emit_event(
                &app,
                TtsPlaybackEvent {
                    session_id: session_id.clone(),
                    chunk_index: current_playing_chunk,
                    event: "chunk_finished".to_string(),
                    message: None,
                },
            );

            // Increment current chunk index because we just finished one
            current_playing_chunk += 1;
            status
                .current_chunk
                .store(current_playing_chunk, Ordering::SeqCst);

            // Do NOT reset chunks_queued_to_sink or current_playing_chunk here.
            // We might just be waiting for the next chunk to be generated (buffer underrun).
            // Resetting would cause the next chunk to be treated as chunk 0 again.

            status.is_playing.store(false, Ordering::SeqCst);
            // status.is_paused stays as is

            // Note: If we really are done, Stop() or StartSession() will reset everything.
        } else if current_len > 0 {
            status.is_playing.store(true, Ordering::SeqCst);
        }

        last_sink_len = current_len;
        status.queued_count.store(current_len, Ordering::SeqCst);
    }
}
