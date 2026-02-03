# TTS Setup Guide

This document describes how to set up the Text-to-Speech (TTS) functionality for Kokoro Reader on different platforms.

## Windows Setup

### 1. Install Python Dependencies

```bash
cd python-tts
pip install -r requirements-cuda.txt
```

### 2. Install SoX (Sound eXchange)

#### Option A: Download and Extract to Project (Recommended for Development)

```bash
# Create bin directory
mkdir bin

# Download SoX
curl -L "https://sourceforge.net/projects/sox/files/sox/14.4.2/sox-14.4.2-win32.zip/download" -o sox.zip

# Extract to bin directory
unzip sox.zip -d bin
mv bin/sox-14.4.2/* bin/
rmdir bin/sox-14.4.2
rm sox.zip
```

#### Option B: Install to User Directory

```bash
mkdir -p ~/sox
cd ~/sox
curl -L "https://sourceforge.net/projects/sox/files/sox/14.4.2/sox-14.4.2-win32.zip/download" -o sox.zip
unzip sox.zip
```

### 3. Build the TTS Sidecar (Optional for Production)

For production builds, compile the Python script into a standalone executable:

```bash
python scripts/build_sidecar.py
```

This will create `qwen3-tts-cuda-x86_64-pc-windows-msvc.exe` in `src-tauri/binaries/`.

## macOS Setup

### 1. Install Python Dependencies

```bash
cd python-tts
pip install -r requirements-chatterbox.txt  # For Chatterbox TTS (MLX-based)
```

### 2. Build the TTS Sidecar

```bash
python scripts/build_sidecar.py
```

## Linux Setup

### 1. Install SoX via Package Manager

```bash
# Ubuntu/Debian
sudo apt-get install sox

# Fedora
sudo dnf install sox

# Arch
sudo pacman -S sox
```

### 2. Install Python Dependencies

```bash
cd python-tts
pip install -r requirements-cuda.txt
```

### 3. Build the TTS Sidecar (Optional for Production)

```bash
python scripts/build_sidecar.py
```

## TTS Engines

### Windows/Linux: Qwen3-TTS

- **Model**: Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice (600M parameters)
- **Features**: 9 premium voices, 10 languages support
- **Device**: CPU or CUDA GPU
- **Sample Rate**: 12kHz

### macOS: Chatterbox

- **Model**: Chatterbox-Turbo (MLX-optimized for Apple Silicon)
- **Features**: High-quality voice synthesis with emotion control
- **Device**: Apple Metal (MPS)

## Development vs Production

### Development Mode
- Uses Python scripts directly from `python-tts/`
- Requires Python runtime and all dependencies installed
- Easier for debugging and development
- Models are downloaded on first use from Hugging Face

### Production Mode
- Uses compiled executables from `src-tauri/binaries/`
- Bundles Python + dependencies into single executable via PyInstaller
- No Python installation required on end-user machines
- Models still downloaded on first use (stored in user's cache)

## Troubleshooting

### "SoX could not be found"
- Ensure SoX is installed in `bin/` directory or `~/sox/sox-14.4.2/`
- Verify `sox.exe` (Windows) or `sox` binary exists
- Check that all DLL files are present alongside sox.exe

### "Failed to initialize model"
- Ensure internet connection for first-time model download
- Check disk space (models are ~1-2GB)
- Models are cached in: `~/.cache/huggingface/hub/`

### "Invalid response from TTS"
- Check Python dependencies are installed: `pip list | grep qwen-tts`
- Verify SoX is accessible: `sox --version`
- Check console output for error messages

## Model Information

The Qwen3-TTS model will be automatically downloaded from Hugging Face on first use. The 0.6B variant requires approximately 1.2GB of disk space.

Available speakers for Qwen3-TTS CustomVoice:
- Ryan (default)
- Emily
- Michael
- Sarah
- David
- Jessica
- Chris
- Amanda
- James

To change the speaker, modify `self.speaker` in `python-tts/qwen3_tts_cuda.py`.
