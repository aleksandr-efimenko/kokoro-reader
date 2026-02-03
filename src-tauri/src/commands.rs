//! Tauri commands for the frontend to interact with the Rust backend

use crate::epub::{Book, Chapter, EpubParser};
use crate::tts::{
    AudioPlayer, ChatterboxManager, PlaybackManager, TTSEngine, TtsPlaybackEvent, Voice,
};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

/// Application state
pub struct AppState {
    pub tts: Arc<Mutex<ChatterboxManager>>,
    pub audio_speed: Arc<Mutex<f32>>,
    pub current_book: Arc<Mutex<Option<Book>>>,
    pub playback: Arc<Mutex<Option<PlaybackManager>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            tts: Arc::new(Mutex::new(ChatterboxManager::new())),
            audio_speed: Arc::new(Mutex::new(1.0)),
            current_book: Arc::new(Mutex::new(None)),
            playback: Arc::new(Mutex::new(None)),
        }
    }

    fn get_or_init_playback(&self, app: &tauri::AppHandle) -> Result<PlaybackManager, String> {
        let mut playback = self.playback.lock().map_err(|e| e.to_string())?;
        if playback.is_none() {
            *playback = Some(PlaybackManager::new(app.clone()));
        }
        Ok(playback.as_ref().unwrap().clone())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Read an EPUB file as bytes
#[tauri::command]
pub async fn read_epub_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Open and parse a book file
#[tauri::command]
pub async fn open_book(path: String, state: State<'_, AppState>) -> Result<Book, String> {
    let path = PathBuf::from(&path);

    let book = tokio::task::spawn_blocking(move || EpubParser::parse(&path))
        .await
        .map_err(|e| format!("Task error: {}", e))?
        .map_err(|e| e.to_string())?;

    let mut current = state.current_book.lock().map_err(|e| e.to_string())?;
    *current = Some(book.clone());

    Ok(book)
}

/// Get the currently loaded book
#[tauri::command]
pub fn get_current_book(state: State<'_, AppState>) -> Result<Option<Book>, String> {
    let current = state.current_book.lock().map_err(|e| e.to_string())?;
    Ok(current.clone())
}

/// Get a specific chapter
#[tauri::command]
pub fn get_chapter(index: usize, state: State<'_, AppState>) -> Result<Option<Chapter>, String> {
    let current = state.current_book.lock().map_err(|e| e.to_string())?;

    if let Some(book) = current.as_ref() {
        Ok(book.chapters.get(index).cloned())
    } else {
        Ok(None)
    }
}

/// Speak text using Chatterbox TTS
#[tauri::command]
pub async fn speak(
    text: String,
    _voice: String, // Chatterbox uses its own voice
    speed: f32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!(
        "[TTS] speak called with text length: {}, speed: {}",
        text.len(),
        speed
    );

    // Generate audio using Chatterbox
    let wav_data = {
        let tts = state.tts.lock().map_err(|e| {
            let err = format!("Lock error: {}", e);
            eprintln!("[TTS] {}", err);
            err
        })?;

        // Start the TTS process if not running
        if !tts.is_initialized() {
            println!("[TTS] Starting Chatterbox TTS...");
            tts.start().map_err(|e| {
                let err = format!("Failed to start TTS: {}", e);
                eprintln!("[TTS] {}", err);
                err
            })?;

            tts.init_model().map_err(|e| {
                let err = format!("Failed to init model: {}", e);
                eprintln!("[TTS] {}", err);
                err
            })?;
        }

        println!("[TTS] Generating audio with Chatterbox...");

        let audio = tts.generate(&text, speed).map_err(|e| {
            let err = format!("Generation error: {}", e);
            eprintln!("[TTS] {}", err);
            err
        })?;

        println!("[TTS] Audio generated, {} samples", audio.audio.len());
        audio.to_wav()
    };

    println!(
        "[TTS] WAV data size: {} bytes, starting playback...",
        wav_data.len()
    );

    // Play audio
    let play_result = tokio::task::spawn_blocking(move || {
        let player = AudioPlayer::new();
        player.play_wav_blocking(wav_data)
    })
    .await
    .map_err(|e| {
        let err = format!("Task error: {}", e);
        eprintln!("[TTS] {}", err);
        err
    })?;

    match &play_result {
        Ok(_) => println!("[TTS] Playback completed successfully"),
        Err(e) => eprintln!("[TTS] Playback error: {}", e),
    }

    play_result.map_err(|e| e.to_string())
}

// ============================================================================
// Chunked / queued TTS commands (non-blocking)
// ============================================================================

/// Start a new TTS session (clears queue and resets ordering).
#[tauri::command]
pub fn tts_start_session(
    session_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let playback = state.get_or_init_playback(&app)?;
    playback.start_session(session_id);
    Ok(())
}

/// Enqueue a chunk for generation + playback. Returns immediately.
#[tauri::command]
pub async fn tts_enqueue_chunk(
    session_id: String,
    chunk_index: usize,
    text: String,
    _voice: String, // Chatterbox uses its own voice
    speed: f32,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }

    let playback = state.get_or_init_playback(&app)?;
    let tts = Arc::clone(&state.tts);
    let app_handle = app.clone();

    // Clone playback to check session ID inside the thread
    let playback_clone = playback.clone();
    let session_id_check = session_id.clone();

    tauri::async_runtime::spawn(async move {
        // Check 1: Fast fail if session already changed
        if let Ok(current) = playback.current_session_id.lock() {
            if current.as_ref() != Some(&session_id) {
                println!(
                    "[TTS] Skipping chunk {} for cancelled session {}",
                    chunk_index, session_id
                );
                return;
            }
        }

        let generation = tauri::async_runtime::spawn_blocking(move || {
            // Check 2: Check again just before potentially expensive lock
            if let Ok(current) = playback_clone.current_session_id.lock() {
                if current.as_ref() != Some(&session_id_check) {
                    return Err(format!("Session cancelled (pre-lock)"));
                }
            }

            let manager = tts.lock().map_err(|e| format!("Lock error: {}", e))?;

            // Check 3: MUST check after acquiring lock, because we might have waited
            // a long time for the previous chunk to finish generating.
            if let Ok(current) = playback_clone.current_session_id.lock() {
                if current.as_ref() != Some(&session_id_check) {
                    return Err(format!("Session cancelled (post-lock)"));
                }
            }

            // Start if not initialized
            if !manager.is_initialized() {
                manager
                    .start()
                    .map_err(|e| format!("Failed to start TTS: {}", e))?;
                manager
                    .init_model()
                    .map_err(|e| format!("Failed to init model: {}", e))?;
            }

            // Check 4: One final check before the expensive generate call
            if let Ok(current) = playback_clone.current_session_id.lock() {
                if current.as_ref() != Some(&session_id_check) {
                    return Err(format!("Session cancelled (pre-generate)"));
                }
            }

            let audio = manager
                .generate(&text, speed)
                .map_err(|e| format!("Generation error: {}", e))?;

            Ok::<Vec<u8>, String>(audio.to_wav())
        })
        .await;

        match generation {
            Ok(Ok(wav_data)) => {
                // Speed is handled during generation.
                // Keep playback at 1.0 to avoid double time-stretching.
                playback.enqueue_wav(session_id.clone(), chunk_index, wav_data, 1.0);
            }
            Ok(Err(err)) => {
                // Ignore cancellation errors - this is expected behavior when stopping
                if err.contains("Session cancelled") {
                    println!("[TTS] Validation: {}", err);
                    return;
                }

                let _ = app_handle.emit(
                    "tts-playback-event",
                    TtsPlaybackEvent {
                        session_id: session_id.clone(),
                        chunk_index,
                        event: "generation_error".to_string(),
                        message: Some(err),
                    },
                );
            }
            Err(err) => {
                let _ = app_handle.emit(
                    "tts-playback-event",
                    TtsPlaybackEvent {
                        session_id: session_id.clone(),
                        chunk_index,
                        event: "generation_error".to_string(),
                        message: Some(format!("Task join error: {}", err)),
                    },
                );
            }
        }
    });

    Ok(())
}

/// Stop current playback and clear the queue.
#[tauri::command]
pub fn tts_stop(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    println!("[TTS] Stop command received - clearing session");
    let playback = state.get_or_init_playback(&app)?;
    playback.stop();
    Ok(())
}

/// Pause current playback.
#[tauri::command]
pub fn tts_pause(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let playback = state.get_or_init_playback(&app)?;
    playback.pause();
    Ok(())
}

/// Resume current playback.
#[tauri::command]
pub fn tts_resume(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let playback = state.get_or_init_playback(&app)?;
    playback.resume();
    Ok(())
}

/// Stop TTS playback
#[tauri::command]
pub fn stop_speaking(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let playback = state.get_or_init_playback(&app)?;
    playback.stop();
    Ok(())
}

/// Pause TTS playback
#[tauri::command]
pub fn pause_speaking(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let playback = state.get_or_init_playback(&app)?;
    playback.pause();
    Ok(())
}

/// Resume TTS playback
#[tauri::command]
pub fn resume_speaking(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let playback = state.get_or_init_playback(&app)?;
    playback.resume();
    Ok(())
}

/// Set playback speed
#[tauri::command]
pub fn set_speed(speed: f32, state: State<'_, AppState>) -> Result<(), String> {
    let mut audio_speed = state.audio_speed.lock().map_err(|e| e.to_string())?;
    *audio_speed = speed.clamp(0.5, 2.0);
    Ok(())
}

/// Check if audio is playing
#[tauri::command]
pub fn is_playing(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let playback = state.get_or_init_playback(&app)?;
    Ok(playback.is_playing())
}

/// Check if audio is paused
#[tauri::command]
pub fn is_paused(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<bool, String> {
    let playback = state.get_or_init_playback(&app)?;
    Ok(playback.is_paused())
}

/// Get available TTS voices
#[tauri::command]
pub fn get_voices() -> Vec<Voice> {
    // Chatterbox uses a single voice
    Voice::get_voices()
}

/// Set the TTS engine (Chatterbox or Qwen3-TTS)
#[tauri::command]
pub fn set_tts_engine(engine: String, state: State<'_, AppState>) -> Result<(), String> {
    let tts_engine = match engine.to_lowercase().as_str() {
        "qwen3" | "qwen3tts" | "qwen3-tts" | "qwen" => TTSEngine::Qwen3TTS,
        "chatterbox" | _ => TTSEngine::Chatterbox,
    };

    let tts = state.tts.lock().map_err(|e| e.to_string())?;

    // Shutdown current engine and switch
    tts.set_engine(tts_engine)
        .map_err(|e| format!("Failed to set TTS engine: {}", e))?;

    println!("[TTS] Switched to engine: {:?}", tts_engine);
    Ok(())
}

/// Get the current TTS engine
#[tauri::command]
pub fn get_tts_engine() -> String {
    // For now, return default. In future, track actual engine state.
    "chatterbox".to_string()
}

/// Trigger TTS warmup (optional - called when user has enabled warmup in settings)
#[tauri::command]
pub async fn tts_warmup(state: State<'_, AppState>) -> Result<bool, String> {
    println!("[TTS] Warmup requested by frontend...");

    let tts = state.tts.lock().map_err(|e| e.to_string())?;

    // Send warmup command to the TTS process
    match tts.warmup() {
        Ok(_) => {
            println!("[TTS] Warmup completed successfully");
            Ok(true)
        }
        Err(e) => {
            println!("[TTS] Warmup failed: {}", e);
            Ok(false) // Return false rather than error - warmup is optional
        }
    }
}

// ============================================================================
// Model Download Commands
// ============================================================================

/// Model status information
#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelStatus {
    pub is_ready: bool,
    pub is_downloading: bool,
    pub missing_files: Vec<String>,
    pub download_size_bytes: u64,
    pub model_dir: String,
}

/// Download progress information
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub file_name: String,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub current_file: usize,
    pub total_files: usize,
    pub status: String,
}

/// Check if models are downloaded and ready
/// For Chatterbox, model is downloaded on first use by mlx-audio
#[tauri::command]
pub fn check_model_status() -> ModelStatus {
    // Chatterbox downloads models to HuggingFace cache on first use
    // For now, always report ready since mlx-audio handles this
    ModelStatus {
        is_ready: true, // Chatterbox auto-downloads on first use
        is_downloading: false,
        missing_files: vec![],
        download_size_bytes: 0,
        model_dir: "~/.cache/huggingface".to_string(),
    }
}

/// Download all model files
/// For Chatterbox, this is a no-op as model downloads on first TTS call
#[tauri::command]
pub async fn download_model(app: tauri::AppHandle) -> Result<(), String> {
    // For Chatterbox, model is auto-downloaded on first use
    let _ = app.emit(
        "model-download-progress",
        DownloadProgress {
            file_name: "Chatterbox model".to_string(),
            bytes_downloaded: 0,
            total_bytes: None,
            current_file: 0,
            total_files: 0,
            status: "ready".to_string(),
        },
    );
    Ok(())
}

/// Download a specific voice (not applicable for Chatterbox)
#[tauri::command]
pub async fn download_voice(_voice_id: String, app: tauri::AppHandle) -> Result<(), String> {
    download_model(app).await
}

/// Get the model directory path
#[tauri::command]
pub fn get_model_dir() -> String {
    // Chatterbox uses HuggingFace cache directory
    dirs::home_dir()
        .map(|p| p.join(".cache/huggingface"))
        .unwrap_or_else(|| PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}
