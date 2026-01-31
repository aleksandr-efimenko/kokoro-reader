//! Kokoro Reader - Tauri Application
//! 
//! An ebook reader with AI-powered text-to-speech using the Kokoro-82M model.

mod commands;
mod epub;
mod tts;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::open_book,
            commands::get_current_book,
            commands::get_chapter,
            commands::speak,
            commands::speak_chapter,
            commands::stop_speaking,
            commands::pause_speaking,
            commands::resume_speaking,
            commands::set_speed,
            commands::is_playing,
            commands::is_paused,
            commands::get_voices,
            // Model download commands
            commands::check_model_status,
            commands::download_model,
            commands::get_model_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
