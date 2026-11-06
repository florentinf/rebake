# Architecture

Static vanilla TypeScript, built with Vite. No backend. [SPEC.md](SPEC.md) is the contract; this document describes the seams.

```
main thread                              worker (one per engine)
─────────────                            ───────────────────────
ui/app.ts ─ core/detect ─ core/routes
              │
          core/convert ── Engine ── WorkerHost ═══ worker-runtime ── engine code + WASM
              │                     (crash, cancel, transfer)
          core/output (OutputSink)
```

## Flow

1. `detect(file)` reads magic bytes, then the extension, then the MIME type.
2. `ROUTES[format]` gives the engine and ordered targets. The first target is the default. No graph search, no chaining. `core/table.ts` holds the table as plain data so the build can read it, and a row's `via` names another engine for one target, as with images to PDF.
3. `engine.inspect(source)`, where an engine has it, reads the file's tracks and reports what this file can become here.
4. `offeredTargets(route, input, inspection)` drops targets the engine can't produce in this browser, then anything the inspection ruled out.
5. `convert()` probes the engine, runs it, then re-reads the output's magic bytes. A mismatch throws, and the file is discarded.
6. `chooseSink()` picks where the output goes.

Several files follow the same path one at a time, offered only the targets they share, then go through `buildZip()`. Where the target's engine has `merge`, they become one file instead: images to PDF.

## Engine interface

`src/core/engine.ts`. Everything an engine must provide:

```ts
interface Engine {
  readonly id: string;
  probe(): Promise<EngineProbe>;              // cheap feature checks, no download
  targets(input: FormatId): FormatId[];       // what it can produce here
  inspect?(source): Promise<Inspection>;      // optional: what this one file can do here
  downloadSize(input, target): Promise<number>; // bytes still to fetch
  convert(source, target, options, onProgress, signal): Promise<ConvertResult>;
}
```

`convert` must reject with a `RebakeError` carrying the right `ErrorCode`, and must honour `signal`. `onProgress` takes `{ stage, fraction }`; `fraction` is `null` when a stage has no real signal. Never estimate one: the UI holds the bar still and pulses it instead.

Session 2 changed the interface in three additive ways. `inspect` exists because what a video can become depends on its tracks, not its extension. `ConvertOptions` gained the media settings and `destination`, a file to stream into. `ConvertResult.blob` may now be a disk-backed `File`, which costs no memory to hold and goes through the same verification. Format checks became `sameFormat()`, since M4A and MP4, or OGG and Opus, can be byte-identical at the head.

Session 3 changed it in three more additive ways. `ConvertResult.parts` is for results that can't be one file: a PDF's pages, or Markdown and its media. Each non-`asset` part is verified, and the UI zips them. `ConvertResult.note` says what went missing on the way. `Engine.merge` takes a whole batch. `verified()` treats text formats, which have no magic bytes, as valid UTF-8 with no NUL.

### Adding an engine

1. Add its formats to `FormatId` and `FORMATS`.
2. Add its binaries to `PACKAGES` in `scripts/vendor.mjs`, then run `npm run vendor`.
3. Create `src/engines/<name>/index.ts` (the `Engine`) and `worker.ts` (`serve({ ... })`).
4. Add rows to `TABLE` in `core/table.ts`, and the engine to `ENGINES` in `core/routes.ts`. The rows get their pages and sitemap entries from the build.
5. Add its error strings to `ERRORS` in `ui/app.ts`, if it has new failure modes.

Nothing else in `core/` needs editing.

## Workers

`WorkerHost` owns one engine's worker, and the worker is replaced lazily on the next call.

- **Transfer:** pass buffers in `transfer`. A handler returns `new Transfer(value, [buffers])` to move results back.
- **Cancel:** an aborted `signal` terminates the worker. WASM can't be interrupted mid-call, and this always works.
- **Crash:** `onerror`, an unreadable message, or a reply marked `fatal` rejects what's in flight and discards the worker. `generation` increments on each spawn, so engines can tell their state was lost.

## Capabilities

`core/capabilities.ts` holds `platform` (features read once) and `probeEngine` (one cached probe per engine). `onMeteredConnection` decides whether to show the download size first.

Codec checks need the file's real dimensions, so the media engine runs them per file in `inspect`. Mediabunny's `canEncode*` and `track.canDecode()` wrap `isConfigSupported`. `probe()` only asks for WebAssembly, because a remux needs no WebCodecs at all.

`isConfigSupported` isn't proof. WebKit's GStreamer audio encoders accept Opus and AAC, then stamp packets from the input buffer, so the muxer rejects the stream. `media/encoder-probe.ts` therefore encodes a moment of audio in sizes matching neither codec's frame and requires rising timestamps. A failed probe sends AAC to the WASM encoder and hides anything that needs Opus. Video targets count too: a file whose audio has to become Opus doesn't offer WebM there. Decoding has the same problem: WebKit accepts AV1 on chips with no AV1 decoder, then fails on the first frame, so `inspect` decodes one frame of AV1 and HEVC files and treats a failure, not a slow answer, as unreadable. `tests/capability.spec.ts` converts every offered target, on every platform CI runs, including the Linux WebKit that exposed this.

## Output

`OutputSink` has `deliver(file)` and `dispose()`. `BlobDownload` hands a file to the browser. `SavedFile` is for output already streamed to disk, so its first delivery does nothing. `chooseSink(file, destination)` picks between them.

Memory stays flat because finished bytes never sit in the worker. `core/spool.ts` opens the output in this order:

1. **Chosen file.** At 100 MB and up, `pickDestination()` opens the save dialog inside the click, and the worker writes through `createWritable`. Chromium only.
2. **Spool.** A file in the origin-private file system, written through a sync access handle. Works in Firefox and Safari too, and the `File` it returns is disk-backed.
3. **Memory.** Only when neither exists. The UI warns before converting.

`clearSpool()` empties this tab's folder on every new job, on cancel and on reset, and removes folders of closed tabs, which it recognises by their missing Web Lock. Batches always spool, then `buildZip()` streams client-zip's output through the same `openOutput` in `core/zip-worker.ts`.

## Image engine

`src/engines/image/`.

- vips side modules are fixed at startup, so `modulesFor()` loads only what a job touches. A job needing a module the worker lacks restarts it with the union.
- **Normalise:** apply EXIF rotation, convert to sRGB, resize, then flatten for JPG. sRGB comes first because stripping removes the ICC profile, and the pixels must stay correct without it.
- **HEIC:** wasm-vips has no HEVC decoder. `decodeNative` uses `createImageBitmap` and reads pixels through a 4096×2048 canvas in tiles, because iOS caps a canvas near 16.7 MP. If that fails, `decodeLibheif` runs, and carries the `colr` ICC profile across so Display P3 photos keep their colour.
- **ICO:** libvips has no ICO codec. `ico.ts` reads PNG and DIB entries and writes PNG entries.
- Canvas is used only to read pixels. Encoding is always vips.

## Media engine

`src/engines/media/`. Video and audio share one worker, Mediabunny on WebCodecs.

- **Plans:** `PLANS` in `worker.ts` gives each target a container, the codecs worth keeping as they are, the codecs legal to copy as a last resort, and the order to encode in. MP4, MOV and MKV prefer H.264, WebM prefers VP9. A VP9 file going to MP4 is re-encoded, because MP4 with VP9 is legal but won't play in QuickTime or on iPhones. If the browser can't decode it, the legal copy is the fallback.
- **Copy first:** nothing is re-encoded unless the job needs it. `copy.shiftTolerance: Infinity` stops a small timestamp offset turning a remux into an encode. Small preset, a resolution cap and a trim start force an encode. The trim is then exact to the frame.
- **Tracks:** the first audio track the browser can decode wins, so an iPhone's spatial APAC track is skipped for its AAC one.
- **HDR:** copied streams stay HDR. An encode tone-maps through a 2D canvas, because 8-bit encoders fed HLG or PQ directly produce flat grey pictures.
- **Encoders:** LAME, libavcodec's AAC and libFLAC are Mediabunny custom encoders, vendored like any engine and imported only when a job needs them. AAC uses WebCodecs where it can. Each runs in a Blob worker of its own, which `worker-src blob:` allows. The extensions' bare `mediabunny` import is patched to read a `globalThis.Mediabunny` the worker sets, so an extension can't pair with a second copy of the library.
- **GIF:** `CanvasSink` frames at 12 fps through gifenc, 15 s at most (`GIF_MAX_SECONDS`), 270p unless the drawer says otherwise. A longer file keeps the chip and shows the limit, since a trim can fix it.

## Document engine

`src/engines/document/`. Pandoc's official `pandoc.wasm`, on the same bridge as its `wasm/pandoc.js` minus the CDN import. The module compiles once and each job gets a fresh instance, so a bad file leaves nothing behind.

- **Media:** HTML embeds images, and DOCX, ODT, EPUB and RTF hold them from pandoc's own media bag. Markdown and LaTeX can't hold them, so they come back in a ZIP beside the document. Anything pandoc reports it couldn't carry shows as a note on the result.
- **PDF:** pandoc writes Typst, and typst.ts compiles it with `media.zip` mapped into its virtual file system. Fonts are the nine in `vendor/fonts`. Typst has no TIFF decoder, so `convert` returns any TIFFs, the image engine turns them into PNGs, and `finishPdf` compiles without re-running pandoc. Other formats it can't read, such as EMF, refuse with a message. Typst prints empty boxes for glyphs it lacks without saying so, so `NO_GLYPHS` refuses those scripts before it runs.

## PDF engine

`src/engines/pdf/`. pdf.js runs in the engine's worker, using its "fake worker" path, so no nested worker and no `document`. `disableFontFace` draws glyphs as paths, `isEvalSupported: false` keeps it inside the CSP. CMaps and standard fonts come from one `data.pack`, fetched up front, so a CJK PDF works offline after any other PDF has opened. pdf-lib builds images to PDF. A JPEG with no rotation goes in byte for byte, with its metadata segments removed. Everything else passes through the image engine first.

## Data engine

`src/engines/data/`. Papa Parse and yaml, plus SheetJS loaded only for XLSX. JSON is checked by `JSON.parse`, then re-read by the YAML parser only when it holds 16 digits in a row, so long integers aren't rounded. Numbers in CSV stay text unless they read back identically.

## Pages

`pages()` in `vite.config.ts` writes one HTML file per routing-table row from the built `index.html`, then `privacy.html`, `404.html`, `sitemap.xml` and `robots.txt`. Caddy serves them with `try_files {path} {path}.html`. The app reads `location.pathname` itself, so offline the shell stands in for any converter page. Only `/` and `/privacy` are precached.

## The drawer

`ui/drawer.ts`. Controls carry `data-show` (tokens `syncOptions()` turns on) and `data-keep` (the key they're remembered under). State lives in `localStorage` as `rebake.more.<category>`, wrapped in try/catch, and the drawer swaps it when the target moves to another category. Trim and page ranges are never remembered, because they belong to one file. Sheet chips are built per workbook from `inspection.sheets`.

## Assets, caching and offline

- `vendor/` holds binaries and their checksums. `vite.config.ts` emits them to `engines/<pkg>-<hash>/`: the URL is immutable but the filenames stay, because Emscripten's glue expects them.
- The service worker precaches the shell, and caches `/engines/*` the first time each is fetched. A navigation tries the network for 2.5 s, then falls back to the cached shell.
- `vendor/pandoc/pandoc.wasm` stays in plain Git, not LFS. At 58.4 MB it's under GitHub's 100 MB limit, takes 18.5 MB of a 41 MB `.git`, and changes only when pandoc is upgraded. CI's checkout takes 2 s. LFS would add a dependency to every clone, CI checkout and build, and solve nothing we have, and `vendor/SHA256SUMS` already pins the bytes. Revisit if a future file nears 100 MB or upgrades start to bloat the history.
- CSP, COOP and COEP live in `deploy/rebake.florentinf.dev.caddy`. `scripts/serve.mjs` reads the same block, so tests run against the real headers.

## CSP

`script-src 'self' 'wasm-unsafe-eval'` rules out `eval` and `new Function`. Any new engine must load under it: test it first in a build served by `scripts/serve.mjs`, not in `vite dev`, which sends no CSP. See `THIRD_PARTY.md` for the patches wasm-vips and typst.ts needed.
