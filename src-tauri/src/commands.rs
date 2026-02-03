//! Tauri commands for the frontend to interact with the Rust backend

use crate::epub::{Book, Chapter, EpubParser};
use crate::tts::{AudioPlayer, EchoManager, PlaybackManager, TTSEngine, TtsPlaybackEvent, Voice};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

/// Application state
pub struct AppState {
    /// Echo-1B native Rust TTS engine (primary)
    pub echo: Arc<EchoManager>,
    // Python-based TTS engines temporarily disabled
    // /// Legacy Python sidecar TTS engine (fallback)
    // pub tts: Arc<Mutex<ChatterboxManager>>,
    /// Currently active TTS engine
    pub current_engine: Arc<Mutex<TTSEngine>>,
    pub audio_speed: Arc<Mutex<f32>>,
    pub current_book: Arc<Mutex<Option<Book>>>,
    pub playback: Arc<Mutex<Option<PlaybackManager>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            echo: Arc::new(EchoManager::new()),
            // tts: Arc::new(Mutex::new(ChatterboxManager::new())),
            current_engine: Arc::new(Mutex::new(TTSEngine::default())),
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

    fn get_engine(&self) -> Result<TTSEngine, String> {
        self.current_engine
            .lock()
            .map(|e| *e)
            .map_err(|e| e.to_string())
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

// ============================================================================
// Python-based TTS functions temporarily disabled
// ============================================================================

// /// Speak text using Chatterbox TTS
// #[tauri::command]
// pub async fn speak(
//     text: String,
//     _voice: String, // Chatterbox uses its own voice
//     speed: f32,
//     state: State<'_, AppState>,
// ) -> Result<(), String> {
//     println!(
//         "[TTS] speak called with text length: {}, speed: {}",
//         text.len(),
//         speed
//     );
//
//     // Generate audio using Chatterbox
//     let wav_data = {
//         let tts = state.tts.lock().map_err(|e| {
//             let err = format!("Lock error: {}", e);
//             eprintln!("[TTS] {}", err);
//             err
//         })?;
//
//         // Start the TTS process if not running
//         if !tts.is_initialized() {
//             println!("[TTS] Starting Chatterbox TTS...");
//             tts.start().map_err(|e| {
//                 let err = format!("Failed to start TTS: {}", e);
//                 eprintln!("[TTS] {}", err);
//                 err
//             })?;
//
//             tts.init_model().map_err(|e| {
//                 let err = format!("Failed to init model: {}", e);
//                 eprintln!("[TTS] {}", err);
//                 err
//             })?;
//         }
//
//         println!("[TTS] Generating audio with Chatterbox...");
//
//         let audio = tts.generate(&text, speed).map_err(|e| {
//             let err = format!("Generation error: {}", e);
//             eprintln!("[TTS] {}", err);
//             err
//         })?;
//
//         println!("[TTS] Audio generated, {} samples", audio.audio.len());
//         audio.to_wav()
//     };
//
//     println!(
//         "[TTS] WAV data size: {} bytes, starting playback...",
//         wav_data.len()
//     );
//
//     // Play audio
//     let play_result = tokio::task::spawn_blocking(move || {
//         let player = AudioPlayer::new();
//         player.play_wav_blocking(wav_data)
//     })
//     .await
//     .map_err(|e| {
//         let err = format!("Task error: {}", e);
//         eprintln!("[TTS] {}", err);
//         err
//     })?;
//
//     match &play_result {
//         Ok(_) => println!("[TTS] Playback completed successfully"),
//         Err(e) => eprintln!("[TTS] Playback error: {}", e),
//     }
//
//     play_result.map_err(|e| e.to_string())
// }

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

// Legacy tts_enqueue_chunk - now returns error since only Echo is supported
/// Enqueue a chunk for generation + playback (legacy - now returns error).
/// Use tts_stream_text instead for Echo engine.
#[tauri::command]
pub async fn tts_enqueue_chunk(
    _session_id: String,
    _chunk_index: usize,
    _text: String,
    _voice: String,
    _speed: f32,
) -> Result<(), String> {
    Err(
        "Legacy TTS engines are no longer supported. Please use Echo engine (tts_stream_text)."
            .to_string(),
    )
}

/// Stream full text through Echo-1B TTS engine.
///
/// Unlike `tts_enqueue_chunk`, this sends the entire text to the model in one call
/// and streams audio frames directly to playback as they're generated.
/// No sentence splitting needed -- the model handles the full text.
#[tauri::command]
pub async fn tts_stream_text(
    session_id: String,
    text: String,
    _voice: String,
    speed: f32,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }

    let playback = state.get_or_init_playback(&app)?;
    let echo = Arc::clone(&state.echo);
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        // Session check
        if let Ok(current) = playback.current_session_id.lock() {
            if current.as_ref() != Some(&session_id) {
                return;
            }
        }

        // Initialize Echo if needed (downloads model on first call)
        if !echo.is_initialized() {
            println!("[Echo] Initializing model...");
            if let Err(e) = echo.initialize().await {
                eprintln!("[Echo] Init error: {}", e);
                let _ = app_handle.emit(
                    "tts-playback-event",
                    TtsPlaybackEvent {
                        session_id: session_id.clone(),
                        chunk_index: 0,
                        event: "generation_error".to_string(),
                        message: Some(format!("Echo init failed: {}", e)),
                    },
                );
                return;
            }
        }

        // Session check again after potentially long init/model download
        if let Ok(current) = playback.current_session_id.lock() {
            if current.as_ref() != Some(&session_id) {
                println!("[Echo] Session cancelled during init");
                return;
            }
        }

        // Generate streaming audio -- returns immediately with a StreamingSource
        match echo.generate_streaming(&text, 0, 0.7, speed).await {
            Ok(source) => {
                // Enqueue as chunk_index=0 (single streaming source for full text)
                playback.enqueue_streaming(session_id.clone(), 0, source, speed);
                println!(
                    "[Echo] Streaming source enqueued for session {}",
                    &session_id[..8.min(session_id.len())]
                );
            }
            Err(e) => {
                eprintln!("[Echo] Generation error: {}", e);
                let _ = app_handle.emit(
                    "tts-playback-event",
                    TtsPlaybackEvent {
                        session_id: session_id.clone(),
                        chunk_index: 0,
                        event: "generation_error".to_string(),
                        message: Some(format!("Echo generation failed: {}", e)),
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
pub fn get_voices(state: State<'_, AppState>) -> Vec<Voice> {
    let engine = state.get_engine().unwrap_or_default();
    Voice::get_voices(engine)
}

/// Set the TTS engine
#[tauri::command]
pub async fn set_tts_engine(engine: String, state: State<'_, AppState>) -> Result<(), String> {
    // Only Echo engine is currently supported
    let tts_engine = match engine.to_lowercase().as_str() {
        "echo" | "echo-1b" | "echo1b" => TTSEngine::Echo,
        // Python-based engines temporarily disabled
        // "qwen3" | "qwen3tts" | "qwen3-tts" | "qwen" => TTSEngine::Qwen3TTS,
        // "chatterbox" => TTSEngine::Chatterbox,
        _ => TTSEngine::Echo,
    };

    let current = state.get_engine()?;
    if current == tts_engine {
        return Ok(());
    }

    // Shutdown the old engine (only Echo is currently active)
    state.echo.shutdown().await;

    // Update current engine
    {
        let mut eng = state.current_engine.lock().map_err(|e| e.to_string())?;
        *eng = tts_engine;
    }

    println!("[TTS] Switched to engine: {:?}", tts_engine);
    Ok(())
}

/// Get the current TTS engine
#[tauri::command]
pub fn get_tts_engine(state: State<'_, AppState>) -> String {
    // Only Echo is currently supported
    match state.get_engine().unwrap_or_default() {
        TTSEngine::Echo => "Echo".to_string(),
        // Python-based engines temporarily disabled
        // TTSEngine::Chatterbox => "Chatterbox".to_string(),
        // TTSEngine::Qwen3TTS => "Qwen3TTS".to_string(),
    }
}

/// Trigger TTS warmup (optional - called when user has enabled warmup in settings)
#[tauri::command]
pub async fn tts_warmup(state: State<'_, AppState>) -> Result<bool, String> {
    println!("[TTS] Warmup requested by frontend...");

    // Only Echo engine is currently active
    // Initialize the Echo model (downloads on first use)
    match state.echo.initialize().await {
        Ok(_) => {
            println!("[Echo] Warmup: model initialized");
            Ok(true)
        }
        Err(e) => {
            println!("[Echo] Warmup failed: {}", e);
            Ok(false)
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
#[tauri::command]
pub fn check_model_status(state: State<'_, AppState>) -> ModelStatus {
    let _engine = state.get_engine().unwrap_or_default();

    // Only Echo engine is currently supported
    // Check if sesame/csm-1b model exists in HuggingFace cache
    let cache_dir = dirs::home_dir()
        .map(|p| {
            p.join(".cache")
                .join("huggingface")
                .join("hub")
                .join("models--sesame--csm-1b")
        })
        .unwrap_or_default();

    // Check if model directory exists AND has snapshots (actual model files)
    let snapshots_dir = cache_dir.join("snapshots");
    let is_ready = snapshots_dir.exists() && snapshots_dir.is_dir() && {
        // Check if snapshots directory has any content
        std::fs::read_dir(&snapshots_dir)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(false)
    };

    ModelStatus {
        is_ready,
        is_downloading: false,
        missing_files: if is_ready {
            vec![]
        } else {
            vec!["sesame/csm-1b".to_string()]
        },
        download_size_bytes: if is_ready { 0 } else { 4_000_000_000 },
        model_dir: cache_dir.to_string_lossy().to_string(),
    }
}

/// Download all model files
/// Triggers Echo model initialization which downloads from HuggingFace on first call
#[tauri::command]
pub async fn download_model(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let echo = Arc::clone(&state.echo);

    // Emit starting status
    let _ = app.emit(
        "model-download-progress",
        DownloadProgress {
            file_name: "sesame/csm-1b".to_string(),
            bytes_downloaded: 0,
            total_bytes: Some(4_000_000_000), // ~4GB estimate
            current_file: 1,
            total_files: 1,
            status: "downloading".to_string(),
        },
    );

    // Initialize Echo - this triggers the HuggingFace download
    match echo.initialize().await {
        Ok(_) => {
            println!("[Echo] Model downloaded and initialized successfully");
            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    file_name: "sesame/csm-1b".to_string(),
                    bytes_downloaded: 4_000_000_000,
                    total_bytes: Some(4_000_000_000),
                    current_file: 1,
                    total_files: 1,
                    status: "complete".to_string(),
                },
            );
            Ok(())
        }
        Err(e) => {
            eprintln!("[Echo] Model download failed: {}", e);
            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    file_name: "sesame/csm-1b".to_string(),
                    bytes_downloaded: 0,
                    total_bytes: None,
                    current_file: 1,
                    total_files: 1,
                    status: format!("error: {}", e),
                },
            );
            Err(format!("Model download failed: {}", e))
        }
    }
}

/// Download a specific voice (not applicable for Chatterbox)
#[tauri::command]
pub async fn download_voice(
    _voice_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    download_model(app, state).await
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
