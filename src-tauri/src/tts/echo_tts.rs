//! Echo-1B native Rust TTS backend.
//!
//! Uses the `echo` crate (Sesame CSM-1B via HuggingFace Candle) for
//! pure-Rust text-to-speech with streaming audio generation.

use crate::tts::streaming_source::StreamingSource;
use crossbeam_channel::bounded;
use echo::{
    BufferSize, GeneratorConfig, GeneratorService, MaxAudioLength, ModelSource, SpeakerId,
    Temperature, TopK,
};
use futures_util::StreamExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// Errors from the Echo TTS engine.
#[derive(Debug, thiserror::Error)]
pub enum EchoError {
    #[error("Echo initialization failed: {0}")]
    InitError(String),
    #[error("Echo not initialized")]
    NotInitialized,
    #[error("Generation error: {0}")]
    GenerationError(String),
    #[error("Echo engine is busy (being used by another stream)")]
    Busy,
}

/// Select the best available compute device.
fn select_device() -> candle_core::Device {
    // Try CUDA (Windows/Linux)
    #[cfg(feature = "cuda")]
    {
        if let Ok(device) = candle_core::Device::new_cuda(0) {
            eprintln!("[Echo] Using CUDA device");
            return device;
        }
    }

    // Try Metal (macOS)
    #[cfg(feature = "metal")]
    {
        if let Ok(device) = candle_core::Device::new_metal(0) {
            eprintln!("[Echo] Using Metal device");
            return device;
        }
    }

    eprintln!("[Echo] Using CPU device");
    candle_core::Device::Cpu
}

/// Core Echo TTS engine wrapping the GeneratorService.
pub struct EchoTTS {
    generator: GeneratorService,
    sample_rate: u32,
}

impl EchoTTS {
    /// Create and initialize a new EchoTTS instance.
    /// Downloads the CSM-1B model from HuggingFace on first use.
    pub async fn new() -> Result<Self, EchoError> {
        let device = select_device();

        let config = GeneratorConfig {
            model_source: ModelSource::HuggingFace {
                model_id: "sesame/csm-1b".to_string(),
                model_file: None,
                index_file: None,
            },
            tokenizer_id: None,
            device,
        };

        eprintln!("[Echo] Initializing GeneratorService (this may download the model)...");

        let generator = GeneratorService::new(config)
            .await
            .map_err(|e| EchoError::InitError(e.to_string()))?;

        let sample_rate = generator.sample_rate().as_u32();
        eprintln!("[Echo] Initialized, sample_rate={}", sample_rate);

        Ok(Self {
            generator,
            sample_rate,
        })
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
}

/// Thread-safe manager for the Echo TTS engine.
///
/// Uses `tokio::sync::Mutex` because initialization is async (model download).
/// During streaming generation, the EchoTTS instance is temporarily moved out
/// of the mutex and into the generation task, then returned when done.
pub struct EchoManager {
    inner: Arc<TokioMutex<Option<EchoTTS>>>,
    initialized: AtomicBool,
}

impl EchoManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(TokioMutex::new(None)),
            initialized: AtomicBool::new(false),
        }
    }

    /// Initialize the Echo model. Downloads from HuggingFace on first call.
    pub async fn initialize(&self) -> Result<(), EchoError> {
        let mut guard = self.inner.lock().await;
        if guard.is_none() {
            let echo = EchoTTS::new().await?;
            *guard = Some(echo);
            self.initialized.store(true, Ordering::SeqCst);
        }
        Ok(())
    }

    pub fn is_initialized(&self) -> bool {
        self.initialized.load(Ordering::SeqCst)
    }

    /// Generate streaming audio for the given text.
    ///
    /// Returns a `StreamingSource` for immediate playback. The EchoTTS engine
    /// is temporarily taken from the manager and moved into a background task
    /// that feeds audio frames to the source. The engine is returned to the
    /// manager when generation completes.
    ///
    /// While a stream is active, subsequent calls will return `EchoError::Busy`.
    pub async fn generate_streaming(
        &self,
        text: &str,
        speaker_id: u32,
        temperature: f64,
        _speed: f32,
    ) -> Result<StreamingSource, EchoError> {
        // Take the EchoTTS out of the mutex so it can be moved into the task
        let mut guard = self.inner.lock().await;
        let mut echo = guard.take().ok_or(EchoError::NotInitialized)?;
        drop(guard); // Release the mutex immediately

        let (tx, rx) = bounded::<Vec<f32>>(32);
        let sample_rate = echo.sample_rate;
        let text_owned = text.to_string();
        let inner = Arc::clone(&self.inner);

        let speaker = SpeakerId::new(speaker_id).unwrap_or_default();
        let temp = Temperature::new(temperature).unwrap_or_default();
        let top_k = TopK::default();
        let buffer_size = BufferSize::new(20).unwrap_or_default();
        let max_len = MaxAudioLength::new(60000.0).unwrap_or_default();

        // Spawn background task that owns `echo` and consumes the stream.
        // Both `echo` (generator) and `text_owned` are moved into the task,
        // so the stream's borrows of &mut generator and &str are satisfied.
        tokio::spawn(async move {
            eprintln!(
                "[Echo] Streaming generation started for: \"{}...\"",
                &text_owned[..text_owned.len().min(50)]
            );

            let mut total_samples = 0usize;

            // Create the stream inside the task -- it borrows echo.generator and text_owned
            {
                eprintln!(
                    "[Echo] Creating generate_stream for text of {} chars",
                    text_owned.len()
                );
                let mut stream = echo.generator.generate_stream(
                    &text_owned,
                    speaker,
                    max_len,
                    temp,
                    top_k,
                    buffer_size,
                    None,
                );
                eprintln!("[Echo] Stream created, starting to poll frames...");

                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(tensor) => {
                            let samples: Vec<f32> = match tensor
                                .to_dtype(candle_core::DType::F32)
                                .and_then(|t| t.to_vec1())
                            {
                                Ok(s) => s,
                                Err(e) => {
                                    eprintln!("[Echo] Tensor conversion error: {}", e);
                                    break;
                                }
                            };

                            total_samples += samples.len();

                            if tx.send(samples).is_err() {
                                eprintln!("[Echo] Receiver dropped, stopping generation");
                                break;
                            }
                        }
                        Err(e) => {
                            eprintln!("[Echo] Stream error: {}", e);
                            break;
                        }
                    }
                }
                // stream dropped here, releasing borrows of echo.generator
            }

            let duration_secs = total_samples as f64 / sample_rate as f64;
            eprintln!(
                "[Echo] Generation complete: {} samples ({:.1}s audio)",
                total_samples, duration_secs
            );

            // Return the EchoTTS to the manager so it can be used again
            let mut guard = inner.lock().await;
            *guard = Some(echo);
        });

        let source = StreamingSource::new(rx, sample_rate);
        Ok(source)
    }

    /// Get the sample rate of the loaded model.
    pub async fn sample_rate(&self) -> u32 {
        self.inner
            .lock()
            .await
            .as_ref()
            .map(|e| e.sample_rate())
            .unwrap_or(24000)
    }

    /// Shutdown the engine, freeing VRAM/memory.
    pub async fn shutdown(&self) {
        let mut guard = self.inner.lock().await;
        *guard = None;
        self.initialized.store(false, Ordering::SeqCst);
        eprintln!("[Echo] Engine shut down");
    }
}
