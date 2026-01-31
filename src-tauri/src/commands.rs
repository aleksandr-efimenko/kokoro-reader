//! Tauri commands for the frontend to interact with the Rust backend

use crate::epub::{Book, Chapter, EpubParser};
use crate::tts::{AudioPlayer, KokoroTTS, Voice};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Application state
pub struct AppState {
    pub tts: Mutex<KokoroTTS>,
    pub audio_speed: Mutex<f32>,
    pub current_book: Mutex<Option<Book>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            tts: Mutex::new(KokoroTTS::new()),
            audio_speed: Mutex::new(1.0),
            current_book: Mutex::new(None),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Open and parse a book file
#[tauri::command]
pub async fn open_book(path: String, state: State<'_, AppState>) -> Result<Book, String> {
    let path = PathBuf::from(&path);
    
    // Parse on blocking thread to avoid blocking async runtime
    let book = tokio::task::spawn_blocking(move || {
        EpubParser::parse(&path)
    })
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

/// Speak text using TTS (generates and plays audio)
#[tauri::command]
pub async fn speak(
    text: String,
    voice: String,
    speed: f32,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Generate audio in a scoped block to drop the lock before await
    let wav_data = {
        let tts = state.tts.lock().map_err(|e| e.to_string())?;
        let result = tts.generate(&text, &voice, speed).map_err(|e| e.to_string())?;
        result.to_wav()
    };

    // Play audio (this blocks until playback is complete)
    // We spawn this on a blocking thread to avoid blocking the async runtime
    let play_result = tokio::task::spawn_blocking(move || {
        let player = AudioPlayer::new();
        player.play_wav_blocking(wav_data)
    })
    .await
    .map_err(|e| e.to_string())?;

    play_result.map_err(|e| e.to_string())
}

/// Speak a chapter with chunked playback
#[tauri::command]
pub async fn speak_chapter(
    chapter_index: usize,
    _voice: String,
    _speed: f32,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let current = state.current_book.lock().map_err(|e| e.to_string())?;

    let chapter = current
        .as_ref()
        .and_then(|b| b.chapters.get(chapter_index))
        .ok_or("Chapter not found")?;

    let chunks = KokoroTTS::split_into_chunks(&chapter.content, 300);

    // For now, just return the chunks - frontend will call speak for each
    Ok(chunks)
}

/// Stop TTS playback
#[tauri::command]
pub fn stop_speaking() -> Result<(), String> {
    // With our current blocking approach, we can't interrupt
    // This would require a more complex architecture with channels
    Ok(())
}

/// Pause TTS playback
#[tauri::command]
pub fn pause_speaking() -> Result<(), String> {
    // Not implemented with blocking approach
    Ok(())
}

/// Resume TTS playback
#[tauri::command]
pub fn resume_speaking() -> Result<(), String> {
    // Not implemented with blocking approach
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
pub fn is_playing() -> Result<bool, String> {
    // With blocking approach, always returns false after command completes
    Ok(false)
}

/// Check if audio is paused
#[tauri::command]
pub fn is_paused() -> Result<bool, String> {
    Ok(false)
}

/// Get available TTS voices
#[tauri::command]
pub fn get_voices() -> Vec<Voice> {
    KokoroTTS::get_voices()
}

// ============================================================================
// Model Download Commands
// ============================================================================

use crate::tts::{get_default_model_dir, ModelDownloader, ModelFiles, DownloadProgress};
use tauri::{Emitter, AppHandle};

/// Model status information
#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelStatus {
    pub is_ready: bool,
    pub is_downloading: bool,
    pub missing_files: Vec<String>,
    pub download_size_bytes: u64,
    pub model_dir: String,
}

/// Check if model is downloaded and ready
#[tauri::command]
pub fn check_model_status() -> ModelStatus {
    let model_dir = get_default_model_dir();
    let model_files = ModelFiles::new(model_dir.clone());
    
    let missing = model_files.get_missing_files();
    let missing_names: Vec<String> = missing.iter().map(|(_, name, _)| name.to_string()).collect();
    let download_size: u64 = missing.iter().map(|(_, _, size)| size).sum();
    
    ModelStatus {
        is_ready: model_files.is_complete(),
        is_downloading: false,
        missing_files: missing_names,
        download_size_bytes: download_size,
        model_dir: model_dir.to_string_lossy().to_string(),
    }
}

/// Download missing model files with progress events
#[tauri::command]
pub async fn download_model(app: AppHandle) -> Result<(), String> {
    let model_dir = get_default_model_dir();
    let downloader = ModelDownloader::new(model_dir);
    
    // Check if already complete
    if downloader.model_files().is_complete() {
        return Ok(());
    }
    
    // Clone app handle for the callback
    let app_clone = app.clone();
    
    // Download with progress callback
    let result = tokio::task::spawn_blocking(move || {
        let callback = Box::new(move |progress: DownloadProgress| {
            // Emit progress event to frontend
            let _ = app_clone.emit("model-download-progress", progress);
        });
        
        downloader.download_all(Some(callback))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?;
    
    result.map_err(|e| e.to_string())
}

/// Get the model directory path
#[tauri::command]
pub fn get_model_dir() -> String {
    get_default_model_dir().to_string_lossy().to_string()
}
