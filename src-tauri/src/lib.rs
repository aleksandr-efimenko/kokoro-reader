//! Kokoro Reader - Tauri Application
//!
//! An ebook reader with AI-powered text-to-speech using Kokoro-82M TTS.

mod ai;
mod commands;
mod epub;
mod tts;

use commands::AppState;
use tauri::Emitter;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState::new())
        .setup(|app| {
            // Handle deep links for auth callback
            // Expected format: textclarifier://auth?token=xxx&refresh_token=yyy
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(query) = url.query() {
                        let mut token = None;
                        let mut refresh_token = None;

                        // Parse query params to extract tokens
                        for pair in query.split('&') {
                            if let Some(value) = pair.strip_prefix("token=") {
                                token = Some(
                                    urlencoding::decode(value).unwrap_or_default().to_string(),
                                );
                            } else if let Some(value) = pair.strip_prefix("refresh_token=") {
                                refresh_token = Some(
                                    urlencoding::decode(value).unwrap_or_default().to_string(),
                                );
                            }
                        }

                        if let Some(t) = token {
                            println!("Deep link received token: {}...", &t[..8.min(t.len())]);
                            // Emit as 'key' for frontend compatibility
                            let payload = serde_json::json!({
                                "key": t,
                                "refreshToken": refresh_token
                            });
                            let _ = handle.emit("auth-success", payload);
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_epub_bytes,
            commands::open_book,
            commands::get_current_book,
            commands::get_chapter,
            commands::speak,
            // Chunked / queued TTS
            commands::tts_start_session,
            commands::tts_enqueue_chunk,
            commands::tts_stop,
            commands::tts_pause,
            commands::tts_resume,
            commands::stop_speaking,
            commands::pause_speaking,
            commands::resume_speaking,
            commands::set_speed,
            commands::is_playing,
            commands::is_paused,
            commands::get_voices,
            commands::set_tts_engine,
            commands::get_tts_engine,
            // Model download commands
            commands::check_model_status,
            commands::download_model,
            commands::download_voice,
            commands::get_model_dir,
            // AI Commands
            ai::open_auth_window,
            ai::explain_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
