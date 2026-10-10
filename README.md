# ✂️ Bismark Cut

A super-simple video editor that runs entirely in your browser — no uploads, no accounts, your video files never leave your device.

**Live app:** https://bismark57.github.io/bismark-cut/

## What it does

- **Import** videos and photos into a media bin
- **Timeline**: arrange clips in order, drag to reorder, drag edges to trim, split at the playhead, delete
- **Preview** with play/pause/seek — trims and captions show live
- **Text captions**: bold white-with-black-outline Shorts style, draggable on the preview, start/end timing, size/color/background options
- **Audio**: background music track with volume control, optional mute of original clip sound
- **Project settings**: 9:16 / 16:9 / 1:1, 720p / 1080p
- **Export** to MP4 right in the browser (FFmpeg.wasm, single-threaded core — works on GitHub Pages with no special server headers)

## How it works

Pure HTML + CSS + vanilla JS. No build step — GitHub Pages serves the files directly.
Video rendering uses `@ffmpeg/ffmpeg` 0.12.x with the single-threaded `@ffmpeg/core`
(works without `SharedArrayBuffer`/COOP+COEP headers). Captions are burned in with
`drawtext` using Archivo Black (a heavy Shorts-style font) fetched from a CDN at export time.

## Notes

- Export speed depends on your device — short clips (like 15s Shorts) render in a minute or two on a laptop; phones are slower.
- iOS Safari works for editing; very large files may hit mobile browser memory limits.
- Made for Bismark's Shorts workflow: Kling clip in → captions on → Short out.
