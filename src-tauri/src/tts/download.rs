//! Model download and management for Kokoro TTS
//!
//! Handles automatic downloading of ONNX model and voice files from HuggingFace.

use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DownloadError {
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Failed to create directory: {0}")]
    DirectoryError(String),
    #[error("Download interrupted")]
    Interrupted,
}

/// Download progress callback type
pub type ProgressCallback = Box<dyn Fn(DownloadProgress) + Send + Sync>;

/// Download progress information
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub file_name: String,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub current_file: usize,
    pub total_files: usize,
    pub status: DownloadStatus,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadStatus {
    Starting,
    Downloading,
    Completed,
    Failed,
    AlreadyExists,
}

/// HuggingFace model repository info
const HF_BASE_URL: &str = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";

/// Files required for the model to work
pub struct ModelFiles {
    /// Base directory for model files
    pub base_dir: PathBuf,
}

impl ModelFiles {
    /// Create a new ModelFiles instance
    pub fn new(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    /// Get paths to all required files
    pub fn get_required_files() -> Vec<(&'static str, &'static str, u64)> {
        vec![
            // (relative_path, display_name, approximate_size_bytes)
            ("onnx/model_q8f16.onnx", "Kokoro Model (86MB)", 86_000_000),
            ("tokenizer.json", "Tokenizer", 3_500),
            ("config.json", "Config", 44),
            // Voice files - using just a subset of essential voices
            ("voices/af.bin", "Voice: American Female (default)", 1_200_000),
            ("voices/af_bella.bin", "Voice: Bella", 1_200_000),
            ("voices/af_heart.bin", "Voice: Heart", 1_200_000),
            ("voices/am_adam.bin", "Voice: Adam", 1_200_000),
            ("voices/bf_emma.bin", "Voice: Emma (British)", 1_200_000),
            ("voices/bm_george.bin", "Voice: George (British)", 1_200_000),
        ]
    }

    /// Check if all required files exist
    pub fn is_complete(&self) -> bool {
        Self::get_required_files()
            .iter()
            .all(|(path, _, _)| self.base_dir.join(path).exists())
    }

    /// Get model file path
    pub fn model_path(&self) -> PathBuf {
        self.base_dir.join("onnx/model_q8f16.onnx")
    }

    /// Get tokenizer file path
    pub fn tokenizer_path(&self) -> PathBuf {
        self.base_dir.join("tokenizer.json")
    }

    /// Get voice file path
    pub fn voice_path(&self, voice_id: &str) -> PathBuf {
        self.base_dir.join(format!("voices/{}.bin", voice_id))
    }

    /// Get missing files
    pub fn get_missing_files(&self) -> Vec<(&'static str, &'static str, u64)> {
        Self::get_required_files()
            .into_iter()
            .filter(|(path, _, _)| !self.base_dir.join(path).exists())
            .collect()
    }

    /// Calculate total download size for missing files
    pub fn get_download_size(&self) -> u64 {
        self.get_missing_files()
            .iter()
            .map(|(_, _, size)| size)
            .sum()
    }
}

/// Model downloader
pub struct ModelDownloader {
    model_files: ModelFiles,
}

impl ModelDownloader {
    /// Create a new downloader
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            model_files: ModelFiles::new(base_dir),
        }
    }

    /// Get reference to model files
    pub fn model_files(&self) -> &ModelFiles {
        &self.model_files
    }

    /// Download all missing model files
    pub fn download_all(&self, progress_callback: Option<ProgressCallback>) -> Result<(), DownloadError> {
        let missing_files = self.model_files.get_missing_files();
        
        if missing_files.is_empty() {
            if let Some(ref callback) = progress_callback {
                callback(DownloadProgress {
                    file_name: "All files".to_string(),
                    bytes_downloaded: 0,
                    total_bytes: None,
                    current_file: 0,
                    total_files: 0,
                    status: DownloadStatus::AlreadyExists,
                });
            }
            return Ok(());
        }

        let total_files = missing_files.len();

        for (index, (relative_path, display_name, _approx_size)) in missing_files.iter().enumerate() {
            let url = format!("{}/{}", HF_BASE_URL, relative_path);
            let dest_path = self.model_files.base_dir.join(relative_path);

            // Ensure parent directory exists
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent)?;
            }

            if let Some(ref callback) = progress_callback {
                callback(DownloadProgress {
                    file_name: display_name.to_string(),
                    bytes_downloaded: 0,
                    total_bytes: None,
                    current_file: index + 1,
                    total_files,
                    status: DownloadStatus::Starting,
                });
            }

            self.download_file(&url, &dest_path, display_name, index + 1, total_files, &progress_callback)?;
        }

        if let Some(ref callback) = progress_callback {
            callback(DownloadProgress {
                file_name: "All files".to_string(),
                bytes_downloaded: 0,
                total_bytes: None,
                current_file: total_files,
                total_files,
                status: DownloadStatus::Completed,
            });
        }

        Ok(())
    }

    /// Download a single file with progress reporting
    fn download_file(
        &self,
        url: &str,
        dest_path: &Path,
        display_name: &str,
        current_file: usize,
        total_files: usize,
        progress_callback: &Option<ProgressCallback>,
    ) -> Result<(), DownloadError> {
        // Use ureq for HTTP requests
        let response = ureq::get(url)
            .call()
            .map_err(|e| DownloadError::NetworkError(e.to_string()))?;

        // Get content-length from headers
        let total_bytes = response.headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok());

        // Create temporary file first
        let temp_path = dest_path.with_extension("tmp");
        let file = File::create(&temp_path)?;
        let mut writer = BufWriter::new(file);

        // Read and write in chunks using ureq v3 body reader
        let mut reader = response.into_body().into_reader();
        let mut buffer = [0u8; 65536]; // 64KB chunks
        let mut bytes_downloaded: u64 = 0;
        let mut last_progress_update = std::time::Instant::now();

        loop {
            let bytes_read = reader.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }

            writer.write_all(&buffer[..bytes_read])?;
            bytes_downloaded += bytes_read as u64;

            // Update progress at most every 100ms to avoid overwhelming the UI
            if last_progress_update.elapsed().as_millis() >= 100 {
                if let Some(ref callback) = progress_callback {
                    callback(DownloadProgress {
                        file_name: display_name.to_string(),
                        bytes_downloaded,
                        total_bytes,
                        current_file,
                        total_files,
                        status: DownloadStatus::Downloading,
                    });
                }
                last_progress_update = std::time::Instant::now();
            }
        }

        writer.flush()?;
        drop(writer);

        // Rename temp file to final destination
        fs::rename(&temp_path, dest_path)?;

        if let Some(ref callback) = progress_callback {
            callback(DownloadProgress {
                file_name: display_name.to_string(),
                bytes_downloaded,
                total_bytes,
                current_file,
                total_files,
                status: DownloadStatus::Completed,
            });
        }

        Ok(())
    }
}

/// Get the default model directory (in app data)
pub fn get_default_model_dir() -> PathBuf {
    // Use platform-specific app data directory
    #[cfg(target_os = "macos")]
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.kokororeader.app");

    #[cfg(target_os = "windows")]
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("KokoroReader");

    #[cfg(target_os = "linux")]
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("kokoro-reader");

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let base = PathBuf::from(".").join("kokoro-reader-data");

    base.join("models")
}
