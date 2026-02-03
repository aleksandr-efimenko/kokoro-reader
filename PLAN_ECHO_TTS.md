# Plan: Integrate Echo-1B as Native Rust TTS Engine

Replace the Python sidecar TTS (Qwen3-TTS/Chatterbox subprocess) with Echo-1B, a pure-Rust implementation of Sesame CSM-1B using HuggingFace Candle. Use full-text streaming instead of sentence chunking -- send the entire text to Echo-1B, stream audio frames directly to the playback sink as they're generated.

## Architecture Change

**Before (chunked):** Frontend splits text into sentences -> `tts_enqueue_chunk` per sentence -> `spawn_blocking` -> Python subprocess -> JSON/base64 WAV -> decode -> `PlaybackManager::enqueue_wav()`

**After (streaming):** Frontend sends full text -> `tts_stream_text` -> `tokio::spawn` -> Echo-1B `generate_stream()` -> `crossbeam` channel -> `StreamingSource` -> `sink.append()` -> audio plays as frames arrive

No sentence splitting. No WAV encoding. No subprocess. No Python.

---

## Step 1: Dependencies (`src-tauri/Cargo.toml`)

```toml
[dependencies]
echo = { git = "https://gitlab.com/maxmcneal/echo-1b.git", branch = "main", default-features = false }
crossbeam-channel = "0.5"
futures-util = "0.3"
tokio = { version = "1", features = ["sync", "parking_lot", "rt-multi-thread"] }

[features]
default = []
cuda = ["echo/cuda"]
cudnn = ["echo/cudnn"]
metal = ["echo/metal"]
accelerate = ["echo/accelerate"]
mkl = ["echo/mkl"]
```

## Step 2: `streaming_source.rs` - Custom rodio Source

Channel-backed `rodio::Source<Item=f32>`:
- Pulls from `crossbeam_channel::Receiver<Vec<f32>>` into internal VecDeque buffer
- `recv_timeout(50ms)` when buffer empty; yields silence on timeout
- Returns `None` on channel disconnect (stream complete)
- channels=1, sample_rate=24000, unknown duration

## Step 3: `echo_tts.rs` - Native Rust TTS backend

- `EchoTTS`: wraps `echo::GeneratorService`, auto-selects device (CUDA > Metal > CPU)
- `generate_streaming(text, speaker_id, temp)` -> `(StreamingSource, JoinHandle)`
  - Calls `generator.generate_stream()` for async stream of audio Tensors
  - Spawns background task converting tensors to f32 samples, pushing through channel
  - Returns StreamingSource immediately for instant playback start
- `EchoManager`: thread-safe wrapper with `tokio::sync::Mutex`

## Step 4: `playback.rs` - Add streaming support

- New `PlaybackCmd::EnqueueStreaming` variant
- New `PendingAudio` enum: `Wav(Vec<u8>, f32)` | `Streaming(StreamingSource, f32)`
- `enqueue_streaming()` method sends StreamingSource to audio thread
- Audio thread appends StreamingSource directly to sink (no WAV decode)

## Step 5: `mod.rs` - Update TTS module

- Add `Echo` to `TTSEngine` enum, make it default
- Register new modules: `echo_tts`, `streaming_source`

## Step 6: `commands.rs` - New streaming command + updates

- New `tts_stream_text(session_id, text, voice, speed)` command:
  - Single call for full text (no chunking)
  - Creates StreamingSource via EchoManager
  - Enqueues as chunk_index=0 to PlaybackManager
  - Audio starts playing as soon as first frames arrive
- Keep `tts_enqueue_chunk` for legacy engines
- Update `AppState`, `set_tts_engine`, `get_tts_engine`, `tts_warmup`

## Step 7: `lib.rs` - Initialize EchoManager in AppState

## Step 8: Frontend Changes

- `useSettings.ts`: Add `'Echo'` engine type, make default
- `useTTS.ts`: When engine is Echo, call `tts_stream_text(sessionId, fullText)` instead of splitting into sentences
- `SettingsPanel.tsx`: Add Echo-1B button as primary option

## Files Modified

1. `src-tauri/Cargo.toml` - deps + features
2. `src-tauri/src/tts/streaming_source.rs` - NEW
3. `src-tauri/src/tts/echo_tts.rs` - NEW
4. `src-tauri/src/tts/mod.rs` - modules + enum
5. `src-tauri/src/tts/playback.rs` - streaming support
6. `src-tauri/src/commands.rs` - new command + state
7. `src-tauri/src/lib.rs` - init
8. `src/hooks/useSettings.ts` - Echo engine
9. `src/hooks/useTTS.ts` - streaming mode
10. `src/components/SettingsPanel.tsx` - UI

## References

- Echo-1B: https://gitlab.com/maxmcneal/echo-1b
- CSM-1B model: https://huggingface.co/sesame/csm-1b
- Article: https://www.maxmcneal.com/articles/performance-neural-tts
