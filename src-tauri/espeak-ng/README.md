# eSpeak NG vendoring

This folder is used to bundle eSpeak NG into the Tauri app so English phonemization works fully offline without requiring Homebrew on end-user machines.

Expected layout (created by the vendoring script):

- `src-tauri/espeak-ng/espeak-ng` (executable)
- `src-tauri/espeak-ng/espeak-ng-data/` (data directory)

To populate on macOS (development machine):

- Install eSpeak NG: `brew install espeak-ng`
- Vendor into the app: `npm run vendor:espeak-ng:macos`

Note: the vendored binary may depend on Homebrew dynamic libraries. If so, you may need a proper distribution build of eSpeak NG (static or with bundled dylibs) for release.
