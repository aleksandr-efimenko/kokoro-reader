#!/usr/bin/env python3
"""
Build script to create a standalone TTS executable using PyInstaller.
This bundles Python + mlx-audio into a single executable for Tauri sidecar.

Run from the repository root:
    python scripts/build_sidecar.py
"""

import subprocess
import sys
import platform
import shutil
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent.absolute()
REPO_ROOT = SCRIPT_DIR.parent
PYTHON_TTS_DIR = REPO_ROOT / "python-tts"
BINARIES_DIR = REPO_ROOT / "src-tauri" / "binaries"

# Target architecture
ARCH = platform.machine()  # arm64 on Apple Silicon
if ARCH == "arm64":
    TARGET_TRIPLE = "aarch64-apple-darwin"
else:
    TARGET_TRIPLE = "x86_64-apple-darwin"

TARGETS = [
    {
        "name": "chatterbox-tts",
        "script": "chatterbox_tts.py",
        "requirements": "requirements-chatterbox.txt",
        "hidden_imports": [
            "mlx", "mlx.core", "mlx_audio", "mlx_audio.tts",
            "librosa", "soundfile"
        ],
        "collect_all": ["mlx_audio", "mlx"]
    },
    {
        "name": "qwen3-tts",
        "script": "qwen3_tts.py",
        "requirements": "requirements-qwen3tts.txt",
        "hidden_imports": [
            "torch", "transformers", "soundfile",
            "qwen_tts", "qwen_tts.models", "qwen_tts.tokenizer"
        ],
        "collect_all": ["torch", "transformers", "qwen_tts"]
    }
]


def build_target(target):
    name = target["name"]
    script_name = target["script"]
    script_path = PYTHON_TTS_DIR / script_name
    output_name = f"{name}-{TARGET_TRIPLE}"
    
    print(f"\nBuilding {name} sidecar for {TARGET_TRIPLE}...")

    if not script_path.exists():
        print(f"Error: {script_path} not found")
        sys.exit(1)

    # PyInstaller command
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--name", output_name,
        "--distpath", str(BINARIES_DIR),
        "--workpath", str(REPO_ROOT / "build" / "pyinstaller" / name),
        "--specpath", str(REPO_ROOT / "build" / "pyinstaller" / name),
        "--clean",
        "--noconfirm",
    ]

    # Add hidden imports
    for imp in target.get("hidden_imports", []):
        cmd.extend(["--hidden-import", imp])

    # Add collect all
    for col in target.get("collect_all", []):
        cmd.extend(["--collect-all", col])

    # Add datas
    for src, dst in target.get("datas", []):
        # Resolve source absolute path
        src_path = PYTHON_TTS_DIR / src
        # Format: source:dest (separator : on Unix, ; on Windows)
        sep = ":" if platform.system() != "Windows" else ";"
        cmd.extend(["--add-data", f"{src_path}{sep}{dst}"])

    cmd.append(str(script_path))
    
    print(f"Running: {' '.join(cmd[:10])}...")
    result = subprocess.run(cmd)
    
    if result.returncode != 0:
        print(f"PyInstaller build failed for {name}!")
        sys.exit(1)
    
    output_path = BINARIES_DIR / output_name
    if output_path.exists():
        # Make executable
        output_path.chmod(0o755)
        print(f"✅ Successfully built: {output_path}")
        print(f"   Size: {output_path.stat().st_size / 1024 / 1024:.1f} MB")
    else:
        print(f"Error: Expected output not found at {output_path}")
        sys.exit(1)

def main():
    print(f"Building TTS sidecars for {TARGET_TRIPLE}...")
    
    # Ensure binaries directory exists
    BINARIES_DIR.mkdir(parents=True, exist_ok=True)
    
    
    # Install requirements first (if common) - removed to support per-target reqs
    # print("Installing Python dependencies...")
    # subprocess.run([
    #     sys.executable, "-m", "pip", "install", "-r",
    #     str(PYTHON_TTS_DIR / "requirements.txt")
    # ], check=True)
    
    for target in TARGETS:
        # Install target specific requirements
        if "requirements" in target:
            req_file = PYTHON_TTS_DIR / target["requirements"]
            print(f"Installing dependencies for {target['name']} from {req_file.name}...")
            # We use --force-reinstall for key packages to ensure we switch versions
            # But standard install might be enough if we just want to ensure compliance
            # However, since they conflict, we likely need to at least ensure we upgrade/downgrade
            subprocess.run([
                sys.executable, "-m", "pip", "install", "-r",str(req_file)
            ], check=True)
            
        build_target(target)


if __name__ == "__main__":
    main()
