# rebake

[![CI](https://github.com/florentinf/rebake/actions/workflows/ci.yml/badge.svg)](https://github.com/florentinf/rebake/actions/workflows/ci.yml)
[![MIT licence](https://img.shields.io/badge/licence-MIT-lightgrey)](LICENSE)

rebake converts files without sending them anywhere. The site is static code with no backend, and a Content Security Policy limits what the page can request to rebake's own files.

**[rebake.app](https://rebake.app)**

## Check the claim

- Open devtools, watch the Network tab, convert a file. The only requests are for rebake's own code.
- Read the `Content-Security-Policy` header. It allows requests to this origin only, and no endpoint here accepts uploads.
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

## How it works

A static, framework-free TypeScript app built with Vite. Each kind of conversion is an engine that runs in its own Web Worker and loads the first time a file needs it: wasm-vips for images, Mediabunny on WebCodecs for video and audio, pandoc and Typst for documents, pdf.js and pdf-lib for PDF. Every output's format is checked before it's handed over. The service worker keeps used engines for offline use.

[Architecture](docs/ARCHITECTURE.md) explains how it fits together, [Design](docs/DESIGN.md) the design rules, and the [Spec](docs/SPEC.md) what rebake is meant to be and what's out of scope.

## Develop

Needs Node 22. Generating test files needs ffmpeg, pandoc and qpdf, and HEIC fixtures need macOS.

```sh
npm ci
npm run dev                 # http://localhost:5173, without the production headers
npm run build && npm run serve   # http://127.0.0.1:4319, with them

npx playwright install      # once, for the test browsers
npm run fixtures            # generate test files into ../rebake-fixtures
npm run test:quick          # Chromium only, about three minutes
npm test                    # every browser, plus real Chrome where it's installed
```

Tests run against `dist/`, so build first. [CONTRIBUTING.md](.github/CONTRIBUTING.md) has the rest, including the things that aren't obvious.

## Contributing

Bug reports, fixes and new test cases are welcome: see [CONTRIBUTING.md](.github/CONTRIBUTING.md). Report security problems privately, as [SECURITY.md](.github/SECURITY.md) describes. Everyone taking part follows the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Licence

MIT. Third-party engines keep their own licences: see [THIRD_PARTY.md](docs/THIRD_PARTY.md). The site serves their full texts at [/third-party-licenses.txt](https://rebake.app/third-party-licenses.txt).
