# Kokoro Reader

An ebook reader with AI-powered text-to-speech, built with Tauri, React, and TypeScript.

## Features

- 📖 **EPUB Support** - Read your ebook library
- 🔊 **AI Text-to-Speech** - High-quality neural TTS with streaming playback
- ⚡ **Native Performance** - Built with Rust for speed and efficiency

## TTS Engines

### Echo-1B (Default - Native Rust)

Echo-1B is a pure Rust implementation of Sesame CSM-1B using HuggingFace Candle. No Python required.

**Build with hardware acceleration:**

```bash
# NVIDIA GPU (CUDA)
npm run tauri build -- -- --features cuda

# Intel MKL
npm run tauri build -- -- --features mkl

# CPU only (default)
npm run tauri build
```

**Development:**

```bash
# With CUDA
npm run tauri dev -- -- --features cuda

# CPU only
npm run tauri dev
```

The model (~1-2GB) downloads automatically from HuggingFace on first use.

---

### Legacy: Python Sidecar (Qwen3-TTS / Chatterbox)

For Python-based TTS engines, see [SETUP_TTS.md](./SETUP_TTS.md).

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Requirements

### System
- **OS**: Windows 10/11, macOS 12+, or Linux
- **RAM**: 8GB minimum, 16GB recommended
- **Disk Space**: ~3GB (app + TTS model)

### Development
- **Node.js** 18+
- **Rust** (latest stable) - [Install via rustup](https://rustup.rs/)
- **npm** or **pnpm**

### GPU Acceleration (Optional)
- **NVIDIA GPU**: CUDA Toolkit 12.x + cuDNN
- **Intel CPU**: Intel MKL for accelerated inference
- **Apple Silicon**: Metal support (use `--features metal`)

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
