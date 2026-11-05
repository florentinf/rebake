# rebake

Converts files in your browser. Nothing is uploaded: the server ships static code, and a Content Security Policy stops the page from sending your files anywhere.

**[rebake.florentinf.dev](https://rebake.florentinf.dev)**

## Check the claim

- Open devtools, watch the Network tab, convert a file. The only requests are for rebake's own code.
- Read the `Content-Security-Policy` header. It allows connections to this origin only, and no endpoint here accepts data.
- Convert once, turn on airplane mode, reload, convert again.

## Formats

| Read | Write |
| --- | --- |
| JPG, PNG, WebP, AVIF, GIF, TIFF, JPEG XL, HEIC, SVG, ICO | JPG, PNG, WebP, AVIF, GIF, TIFF, JPEG XL, ICO |
| MP4, MOV, WebM, MKV (H.264, HEVC, VP9, AV1) | MP4, MOV, WebM, MKV, and GIF up to 15 s |
| MP3, M4A, AAC, Opus, OGG, FLAC, WAV | MP3, M4A, Opus, OGG, FLAC, WAV |
| Markdown, HTML, DOCX, ODT, EPUB, RTF, LaTeX | The same seven, and PDF |
| PDF | PNG, JPG |
| Any image above | PDF |
| CSV, TSV, JSON, YAML | The same four |
| XLSX | CSV |

Only what your browser can really do is offered. HEVC needs Safari or Chrome to re-encode, though copying it from MOV to MP4 works anywhere. HEIC is read-only: writing it needs x265, which is GPL and has no suitable WebAssembly build here.

Documents keep their structure, not their exact layout. PDF output covers Latin, Greek, Cyrillic and Hebrew text and refuses anything else, because the bundled fonts can't draw it.

## Develop

Needs Node 22. Tests read fixtures from `REBAKE_FIXTURES` (default `../rebake-fixtures`), which stay out of the repo.

```sh
npm ci
npm run dev                         # http://localhost:5173
npm run fixtures                    # generate test files (needs ffmpeg, pandoc and qpdf; HEIC needs macOS)
npm run build && npx playwright test
npm run fixtures:large              # a 1.3 GB file for the memory tests
REBAKE_LARGE=1 npx playwright test tests/large.spec.ts --workers=1
npm run deploy                      # needs SSH to furka over Tailscale
```

Known browser gaps are listed, with reasons, in `tests/lib/media-gaps.ts`. A listed gap that stops being one fails the suite.

`npm run vendor` refreshes `vendor/` from `node_modules` and rewrites `vendor/SHA256SUMS`, which `npm run build` verifies. See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together and [DESIGN.md](DESIGN.md) for the design rules.

## Licence

MIT. Third-party engines keep their own licences: see [THIRD_PARTY.md](THIRD_PARTY.md).
