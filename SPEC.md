# Local File Converter — Spec

Nov 5, 2026 · @Florentin

## Goal

A website that converts files entirely in the visitor's browser: drop a file, pick a format, get the file back. The server only ships static code, so conversion load on it is zero and no file ever leaves the device.

Principles, in priority order:

1. Nothing leaves the tab. No uploads, no third-party origins, no analytics, no fallback server.
2. Provable, not promised. Open source (MIT), a CSP that blocks outbound connections, works offline.
3. Just works. Only offer a target format this browser can actually produce. Fail loudly instead of returning a wrong file.
4. Insanely simple. One drop zone, smart defaults, settings tucked into a hidden drawer.
5. Narrow and excellent beats broad and flaky. About 40 common conversions in v1, not 250 formats.

## v1 scope

v1 covers the conversions people actually look for, all of which run well locally on desktop and mobile.

| Category | Conversions | Engine | Caveat |
| --- | --- | --- | --- |
| Images | JPG, PNG, WebP, AVIF, GIF, TIFF, HEIC, JPEG XL in any direction; SVG to raster; image to ICO | [wasm-vips](https://github.com/kleisauke/wasm-vips) (libvips + heif/jxl modules); native HEIC decode on Safari | Never trust canvas encoding: Safari silently returns PNG for WebP |
| Video | MP4, MOV, WebM, MKV with H.264, VP9, AV1; MOV to MP4 as instant remux; video to GIF for short clips | [Mediabunny](https://mediabunny.dev/) (WebCodecs, hardware-accelerated) | HEVC decode depends on browser and OS; stream output to disk above \~100 MB |
| Audio | MP3, AAC/M4A, Opus, OGG, FLAC, WAV; extract audio from video | Mediabunny + LAME WASM for MP3, libavcodec WASM as the AAC fallback, libFLAC WASM for FLAC | No browser encodes MP3 natively; AAC encode missing in Firefox and on desktop Linux |
| Documents | Markdown, HTML, DOCX, ODT, EPUB, RTF, LaTeX in any direction; to PDF via Typst | [pandoc.wasm](https://github.com/pandoc/pandoc-wasm) 3.9 (12.7 MB compressed, plus 10.2 MB for PDF output) | Keeps structure, not exact layout; no PDF input. A DOCX with images to Markdown or LaTeX returns a ZIP. PDF output refuses scripts the bundled fonts can't draw, and images it can't read, such as EMF |
| PDF | PDF to PNG/JPG, images to PDF | pdf.js, pdf-lib | — |
| Data | CSV, JSON, YAML, TSV; XLSX to CSV | Small JS libraries | — |

## Architecture

A static vanilla TypeScript app built with Vite. Each engine runs in its own Web Worker and loads only when a file of its type is dropped.

&#91;embedded content: conversion pipeline · one tab, four engine workers\]

The server's only role is the one arrow in: engine code, fetched once and cached.

- Shell: a page under 50 KB covering the drop zone, the format picker, the progress and download UI, and the service worker. No framework.
- Detection: read the first bytes of the file (magic numbers), then fall back to the extension, then the MIME type.
- Routing: a static table maps each input format to its target formats and the engine that handles them. There is no graph search and no chained conversions in v1.
- Capability probing: on first use per engine, run `VideoEncoder.isConfigSupported`, `AudioEncoder.isConfigSupported` and similar checks. A browser's audio encoders also have to pass a short real encode, because a config check can say yes to one that writes a broken stream. Hide any target this browser cannot produce, or route it to the WASM fallback (LAME for MP3).
- Workers: one per engine family (images, media, documents, PDF). Files are passed as transferable objects, never copied to the main thread twice. A crashed worker shows an error and is respawned; it never takes the page down.
- Output: Blob plus download for small files. For media over about 100 MB, stream to disk via the File System Access API where available, and warn about size on browsers without it. Batches download as a ZIP built locally with client-zip, except images to PDF, which give one PDF.
- Offline: the service worker precaches the shell. Engines cache on first use of each category, so working offline needs an earlier visit that used that category. Cached engines keep working with no network.

## Privacy and verifiability

The claim is "your files never leave this tab", and every part of it can be checked by anyone with devtools.

- One origin: every script, WASM binary and font is served from the converter's own domain. No CDN, no Google Fonts, no third-party anything.
- CSP: `default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'; form-action 'none'`. `connect-src 'self'` exists only so engines can be fetched; there is no endpoint that accepts data.
- No analytics, no cookies. localStorage holds only the last-used target format and the "more" drawer's state per category.
- Offline test, stated on the page: open a converter once, turn on airplane mode, then convert a file of that type.
- Open source under MIT. GPL and LGPL engines (pandoc, LAME, libavcodec) ship as separate files with links to their source.
- Phase 2: enrol in [WEBCAT](https://github.com/freedomofpress/webcat). It signs a manifest of every served file, so users with the extension can confirm the code matches the public release.

## UX

The whole flow is three actions: drop, pick, done.

1. Drop, paste or pick one or more files anywhere on the page.
2. The page shows the detected format and only the targets that work in this browser. The most likely target is preselected, for example HEIC to JPG or MOV to MP4.
3. Convert. A progress bar with an honest estimate replaces the button. Cancel always works.
4. The file downloads automatically, named after the original with the new extension. A batch downloads as one ZIP. A batch of images to PDF gives one PDF.

The hidden "more" drawer is collapsed by default and remembered per category:

| Category | Options |
| --- | --- |
| Images | Quality, max width/height, strip metadata (on by default) |
| Video | Quality preset (small / balanced / high), max resolution, trim start and end, remove audio |
| Audio | Bitrate, mono/stereo |
| Documents | PDF page size (A4 / Letter) |
| PDF | Page range and JPG quality for PDF to images; page size (A4 / Letter) for images to PDF |
| Data | Which sheet, for an XLSX with more than one |

Errors are plain-language and specific, for example "This browser can't encode AAC. Use Chrome or Safari, or pick Opus." A file is never produced in a format other than the one asked for. The UI is responsive and works one-handed on a phone; heavy engines show their download size before loading on mobile data.

## Hosting and ops

The app is plain static files behind Caddy on furka. There is no backend, no database and nothing to keep running except the web server.

- Headers: the CSP above, plus `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. These enable SharedArrayBuffer for threaded WASM, and they cost nothing because there are no third-party embeds.
- Caching: content-hashed filenames with `Cache-Control: public, max-age=31536000, immutable`. HTML uses `no-cache`. WASM is precompressed with Brotli.
- Load: only first-visit engine downloads. A visitor converting images costs about 3 MB; documents cost 12.7 MB, plus 10.2 MB for PDF output. Repeat visits cost close to zero.
- Deploy: build in GitHub Actions, then rsync `dist/` to furka. The build is reproducible, so the WEBCAT manifest can be generated from the same artifact later.
- Repo: public, MIT. A `THIRD_PARTY.md` lists each engine with its licence and source link.
- Testing: a Playwright suite runs fixture files for every row of the scope table in Chromium, Firefox and WebKit. Each output is checked by re-reading its header, not just by checking that a file was produced.

## Out of scope and later

Left out of v1 because they can't be done well locally or would break simplicity:

- Layout-faithful Office to PDF (DOCX, PPTX, XLSX). It needs the \~240 MB LibreOffice WASM engine. Candidate for v2 as an explicit opt-in on desktop only.
- PDF to editable DOCX, and OCR of scanned PDFs.
- Legacy video codecs (AVI, WMV, FLV, MPEG-4 Part 2). They would need ffmpeg.wasm, which is slow and memory-capped. Maybe v2 for short clips.
- RAW camera files, fonts, archives, 3D models, e-books beyond EPUB.
- Any server-side fallback, ever.

## Decisions

- [x] Name and domain: rebake, at rebake.florentinf.dev.
- [x] UI language: English only.
- [x] Host: furka.
- [x] Stripping image metadata (EXIF, GPS): on by default.
