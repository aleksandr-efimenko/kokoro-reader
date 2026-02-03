#!/usr/bin/env python3
"""
Qwen3-TTS server for Windows/Linux with CUDA support.
Communicates with Tauri via JSON over stdin/stdout.

Protocol:
- Startup: Print {"status": "ok", "action": "ready"} when ready
- Commands via stdin (JSON lines):
  - {"action": "init"}
  - {"action": "generate", "text": "...", "speed": 1.0, "temperature": 0.1}
  - {"action": "ping"}
  - {"action": "warmup"}
  - {"action": "shutdown"}
- Responses via stdout (JSON lines)
"""

import sys
import os
from pathlib import Path

# Add SoX to PATH for Windows
if sys.platform == "win32":
    # Try multiple locations for SoX
    sox_locations = [
        Path.home() / "sox" / "sox-14.4.2",  # User home directory
        Path(__file__).parent.parent / "bin",  # Project bin directory
        Path(__file__).parent.parent / "src-tauri" / "bin",  # Tauri bin directory
    ]

    for sox_path in sox_locations:
        if sox_path.exists() and (sox_path / "sox.exe").exists():
            os.environ["PATH"] = str(sox_path) + os.pathsep + os.environ.get("PATH", "")
            break

import json
import io
import base64
import warnings

# Suppress ALL warnings and redirect library outputs to stderr
warnings.filterwarnings("ignore")
os.environ["PYTHONWARNINGS"] = "ignore"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["CUDA_LAUNCH_BLOCKING"] = "1"  # Better error messages
os.environ["TORCH_USE_CUDA_DSA"] = "1"  # Enable device-side assertions

# Redirect stdout temporarily to capture any library initialization output
_original_stdout = sys.stdout
_stderr_backup = sys.stderr

# Try to import required libraries
try:
    # Temporarily redirect stdout to stderr during imports to prevent pollution
    sys.stdout = sys.stderr

    import torch
    import torchaudio
    import numpy as np

    # Restore stdout
    sys.stdout = _original_stdout
except ImportError as e:
    sys.stdout = _original_stdout
    print(json.dumps({
        "status": "error",
        "action": "startup",
        "error": f"Missing required library: {e}. Please install: pip install torch torchaudio numpy"
    }), flush=True)
    sys.exit(1)


class Qwen3TTS:
    def __init__(self):
        self.model = None
        self.device = None
        self.sample_rate = 24000

    def init_model(self):
        """Initialize the Qwen3-TTS model."""
        try:
            # Detect device
            if torch.cuda.is_available():
                self.device = torch.device("cuda:0")
                dtype = torch.float32  # Use float32 for CUDA (more stable than float16)
                print(f"CUDA available! Using GPU: {torch.cuda.get_device_name(0)}", file=sys.stderr, flush=True)
                print(f"CUDA version: {torch.version.cuda}", file=sys.stderr, flush=True)
            else:
                self.device = torch.device("cpu")
                dtype = torch.float32  # Use float32 for CPU
                print("CUDA not available, using CPU", file=sys.stderr, flush=True)

            # Load Qwen3-TTS model (redirect stdout to prevent library messages)
            _stdout = sys.stdout
            sys.stdout = sys.stderr

            try:
                from qwen_tts import Qwen3TTSModel

                # Use the CustomVoice model with pre-defined speakers
                # Using 0.6B variant for faster generation (smaller model)
                device_str = "cuda" if torch.cuda.is_available() else "cpu"

                self.model = Qwen3TTSModel.from_pretrained(
                    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
                    device_map=device_str,
                    torch_dtype=dtype,
                )

                # Verify model is on correct device (if the model has a .model attribute)
                try:
                    if hasattr(self.model, 'model'):
                        param_device = next(self.model.model.parameters()).device
                        print(f"Model loaded on device: {param_device}", file=sys.stderr, flush=True)
                    else:
                        print(f"Model loaded with device_map: {device_str}", file=sys.stderr, flush=True)
                except Exception as e:
                    print(f"Model loaded (device verification skipped: {e})", file=sys.stderr, flush=True)

            finally:
                sys.stdout = _stdout

            # Set a default speaker (Ryan is a good default)
            self.speaker = "Ryan"
            self.sample_rate = 12000  # 12Hz model uses 12kHz sample rate

            return str(self.device)

        except Exception as e:
            raise RuntimeError(f"Failed to initialize model: {e}")

    def warmup(self):
        """Warmup the model with a test generation."""
        try:
            if self.model is None:
                raise RuntimeError("Model not initialized")

            # Generate a short test audio to warm up caches
            self.generate("Hello.", speed=1.0, temperature=0.1)

        except Exception as e:
            raise RuntimeError(f"Warmup failed: {e}")

    def generate(self, text: str, speed: float = 1.0, temperature: float = 0.1):
        """
        Generate speech from text.

        Args:
            text: Text to synthesize
            speed: Speech speed multiplier (default 1.0)
            temperature: Generation temperature (default 0.1)

        Returns:
            tuple: (wav_bytes, sample_rate)
        """
        try:
            if self.model is None:
                # For development/testing without actual model:
                # Generate a simple sine wave as placeholder
                duration = len(text) * 0.05  # ~50ms per character
                t = np.linspace(0, duration, int(24000 * duration))
                audio = np.sin(2 * np.pi * 440 * t) * 0.3  # 440 Hz tone
                audio = (audio * 32767).astype(np.int16)

                # Convert to WAV bytes
                wav_bytes = self._to_wav_bytes(audio, 24000)
                return wav_bytes, 24000

            # Generate speech using Qwen3-TTS (redirect stdout to prevent library messages)
            _stdout = sys.stdout
            sys.stdout = sys.stderr
            try:
                # Ensure generation happens on the correct device
                with torch.inference_mode():
                    wavs, sr = self.model.generate_custom_voice(
                        text=text,
                        language="English",
                        speaker=self.speaker,
                    )
            finally:
                sys.stdout = _stdout

            # Convert to numpy array if needed
            if torch.is_tensor(wavs[0]):
                audio = wavs[0].cpu().numpy()
            else:
                audio = wavs[0]

            # Apply speed adjustment if needed
            if speed != 1.0:
                audio = self._adjust_speed(audio, speed)

            # Ensure proper range for int16 conversion
            if audio.dtype == np.float32 or audio.dtype == np.float64:
                # Audio is expected to be in [-1, 1] range
                audio = np.clip(audio, -1.0, 1.0)
                audio = (audio * 32767).astype(np.int16)
            elif audio.dtype != np.int16:
                audio = audio.astype(np.int16)

            # Convert to WAV bytes
            wav_bytes = self._to_wav_bytes(audio, sr)
            return wav_bytes, sr

        except Exception as e:
            raise RuntimeError(f"Generation failed: {e}")

    def _to_wav_bytes(self, audio: np.ndarray, sample_rate: int) -> bytes:
        """Convert audio array to WAV bytes."""
        import wave

        # Ensure audio is int16
        if audio.dtype != np.int16:
            audio = (audio * 32767).astype(np.int16)

        # Create WAV in memory
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(audio.tobytes())

        return wav_buffer.getvalue()

    def _adjust_speed(self, audio: np.ndarray, speed: float) -> np.ndarray:
        """Adjust audio speed without changing pitch."""
        if speed == 1.0:
            return audio

        # Simple resampling for speed adjustment
        # For production, use librosa.effects.time_stretch or similar
        new_length = int(len(audio) / speed)
        indices = np.linspace(0, len(audio) - 1, new_length)
        return np.interp(indices, np.arange(len(audio)), audio)


def main():
    """Main server loop."""
    tts = Qwen3TTS()

    # Signal ready
    print(json.dumps({"status": "ok", "action": "ready"}), flush=True)

    # Command loop
    for line in sys.stdin:
        try:
            cmd = json.loads(line.strip())
            action = cmd.get("action")

            if action == "init":
                device = tts.init_model()
                print(json.dumps({
                    "status": "ok",
                    "action": "init",
                    "device": device,
                    "model_loaded": True
                }), flush=True)

            elif action == "warmup":
                tts.warmup()
                print(json.dumps({
                    "status": "ok",
                    "action": "warmup"
                }), flush=True)

            elif action == "generate":
                text = cmd.get("text", "")
                speed = cmd.get("speed", 1.0)
                temperature = cmd.get("temperature", 0.1)

                wav_bytes, sample_rate = tts.generate(text, speed, temperature)
                audio_b64 = base64.b64encode(wav_bytes).decode('utf-8')

                print(json.dumps({
                    "status": "ok",
                    "action": "generate",
                    "audio": audio_b64,
                    "sample_rate": sample_rate
                }), flush=True)

            elif action == "ping":
                print(json.dumps({
                    "status": "ok",
                    "action": "ping",
                    "model_loaded": tts.model is not None
                }), flush=True)

            elif action == "shutdown":
                print(json.dumps({
                    "status": "ok",
                    "action": "shutdown"
                }), flush=True)
                break

            else:
                print(json.dumps({
                    "status": "error",
                    "action": action,
                    "error": f"Unknown action: {action}"
                }), flush=True)

        except Exception as e:
            print(json.dumps({
                "status": "error",
                "action": cmd.get("action", "unknown") if 'cmd' in locals() else "unknown",
                "error": str(e)
            }), flush=True)


if __name__ == "__main__":
    main()
