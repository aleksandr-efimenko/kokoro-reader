#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dest_dir="$repo_root/src-tauri/espeak-ng"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to vendor eSpeak NG on macOS." >&2
  exit 1
fi

if ! brew list espeak-ng >/dev/null 2>&1; then
  echo "eSpeak NG is not installed. Run: brew install espeak-ng" >&2
  exit 1
fi

prefix="$(brew --prefix espeak-ng)"

bin_src="$prefix/bin/espeak-ng"
if [[ ! -f "$bin_src" ]]; then
  echo "Could not find espeak-ng binary at: $bin_src" >&2
  exit 1
fi

# Locate data dir (Homebrew location varies slightly across versions)
data_src=""
for candidate in \
  "$prefix/share/espeak-ng-data" \
  "$prefix/share/espeak-ng/espeak-ng-data" \
  "$prefix/share/espeak-ng-data/" \
  ; do
  if [[ -d "$candidate" ]]; then
    data_src="$candidate"
    break
  fi
done

if [[ -z "$data_src" ]]; then
  echo "Could not locate espeak-ng-data under $prefix/share" >&2
  echo "Try: find \"$prefix/share\" -maxdepth 3 -type d -name espeak-ng-data" >&2
  exit 1
fi

echo "Vendoring eSpeak NG from: $prefix"
echo "- binary: $bin_src"
echo "- data:   $data_src"

mkdir -p "$dest_dir"

# Clean old content but keep README.md
find "$dest_dir" -mindepth 1 -maxdepth 1 ! -name README.md -exec rm -rf {} +

cp "$bin_src" "$dest_dir/espeak-ng"
chmod +x "$dest_dir/espeak-ng" || true

rsync -a --delete "$data_src/" "$dest_dir/espeak-ng-data/"

# Basic sanity check
"$dest_dir/espeak-ng" --version | head -n 1 || true

echo "\nDependency check (may require bundling dylibs for release):"
otool -L "$dest_dir/espeak-ng" || true

echo "\nDone. The Tauri bundle will include src-tauri/espeak-ng/**."
