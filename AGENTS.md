# Smart Library

Aesthetic ebook/PDF reader built with Tauri v2 + React + TypeScript.

## Development

```bash
# Frontend dev only (runs at http://localhost:5173)
npm run dev

# Full app (compiles Rust + launches desktop window)
npm run tauri dev

# Production build (bundles the desktop app)
npm run tauri build

# Type-check the frontend
npm run typecheck
```

## Architecture

- **Frontend**: React 19 + Vite 8 + Tailwind v4 + Framer Motion + Zustand + React Router
- **PDF rendering**: `pdfjs-dist` (worker loaded via Vite `?url` import)
- **EPUB rendering**: `epubjs`
- **Backend (Rust)**: Tauri v2 with plugins: `dialog`, `fs`, `sql` (SQLite)
- **Persistence**: SQLite (`smart_library.db`) stores books, reading progress, and settings (theme, EPUB CFI)

## Key files

- `src-tauri/src/lib.rs` — Rust commands: `scan_folder`, `read_book_bytes`, `get_app_data_dir`; SQLite migrations
- `src/lib/db.ts` — frontend SQL helpers (books, progress, settings)
- `src/lib/tauri.ts` — `invoke` wrappers
- `src/store/theme.ts` — dark/light theme with CSS variables + persistence
- `src/store/library.ts` — book scanning + library state
- `src/pages/LibraryPage.tsx` — book grid, search, filters, continue-reading
- `src/pages/ReaderPage.tsx` — reader shell with progress bar
- `src/components/PdfReader.tsx` — pdf.js canvas renderer with thumbnails
- `src/components/EpubReader.tsx` — epub.js rendition with TOC

## Notes

- Theme tokens live in `src/styles/theme.css` as CSS variables consumed by inline styles + Tailwind.
- Reading progress is debounced (600ms) and saved on every page/CFI change; library reorders by last-read on exit.
- PDF page count is extracted in Rust via `lopdf`; covers use deterministic gradients until real cover extraction is added.
- The PDF reader uses `page-flip` (StPageFlip) with a two-page spread, flip sound at `public/sounds/page-flip.mp3` (CC0).
- Book page dimensions are computed to fit within BOTH width and height of the stage — otherwise tall PDFs get clipped top/bottom by `overflow-hidden`.
- TTS uses Piper via `@mintplex-labs/piper-tts-web` (WASM + ONNX Runtime Web, runs fully in the webview). WASM assets are bundled in `public/tts/` (piper phonemize + onnxruntime). Voice models download once to OPFS and work offline.
- Indonesian voice `id_ID-news_tts-medium` is NOT on the `diffusionstudio` mirror — `src/lib/tts.ts` registers it in `PATH_MAP` and seeds OPFS directly from `rhasspy/piper-voices` (storage is keyed by filename, so the session resolves from cache).
