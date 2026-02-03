// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Load .env file for HuggingFace token (HF_TOKEN)
    match dotenvy::dotenv() {
        Ok(path) => eprintln!("[ENV] Loaded .env from: {:?}", path),
        Err(e) => eprintln!("[ENV] Warning: Could not load .env: {}", e),
    }

    // Debug: Check if HF_TOKEN is set
    match std::env::var("HF_TOKEN") {
        Ok(token) => eprintln!("[ENV] HF_TOKEN is set (length: {} chars)", token.len()),
        Err(_) => eprintln!("[ENV] WARNING: HF_TOKEN is NOT set!"),
    }

    kokoro_reader_lib::run()
}
