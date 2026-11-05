# Third-party code

Every engine is served from rebake's own origin as a separate file, in `vendor/`, verified at build time against `vendor/SHA256SUMS`.

| Component | Version | Licence | Source | Used for |
| --- | --- | --- | --- | --- |
| [wasm-vips](https://github.com/kleisauke/wasm-vips) | 0.0.19 | MIT | [github.com/kleisauke/wasm-vips](https://github.com/kleisauke/wasm-vips) | Image decoding and encoding |
| [libvips](https://github.com/libvips/libvips) | 8.18.7 | LGPL-2.1-or-later | [github.com/libvips/libvips](https://github.com/libvips/libvips) | Bundled in wasm-vips |
| [libheif-js](https://github.com/catdad-experiments/libheif-js) | 1.23.5 | LGPL-3.0 | [github.com/catdad-experiments/libheif-js](https://github.com/catdad-experiments/libheif-js) | HEIC decoding where the browser has none; includes [libheif](https://github.com/strukturag/libheif) and [libde265](https://github.com/strukturag/libde265) |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | 1.65.2 | MPL-2.0 | [github.com/Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) | Video and audio reading, writing and conversion. Bundled unmodified in the media worker |
| [@mediabunny/mp3-encoder](https://mediabunny.dev/guide/extensions/mp3-encoder) | 1.65.2 | MPL-2.0; includes [LAME](https://lame.sourceforge.io/), LGPL-2.0-or-later | [github.com/Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny/tree/main/packages/mp3-encoder) | MP3 encoding |
| [@mediabunny/aac-encoder](https://mediabunny.dev/guide/extensions/aac-encoder) | 1.65.2 | MPL-2.0; includes [FFmpeg](https://ffmpeg.org/) libavcodec, LGPL-2.1-or-later | [github.com/Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder) | AAC encoding where WebCodecs has none |
| [@mediabunny/flac-encoder](https://mediabunny.dev/guide/extensions/flac-encoder) | 1.65.2 | MPL-2.0; includes [libFLAC](https://github.com/xiph/flac), BSD-3-Clause | [github.com/Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny/tree/main/packages/flac-encoder) | FLAC encoding |
| [pandoc](https://pandoc.org/) | 3.9 | GPL-2.0-or-later | [github.com/jgm/pandoc, tag 3.9](https://github.com/jgm/pandoc/tree/3.9) | Document conversion. The unmodified official `pandoc.wasm` from the [3.9 release](https://github.com/jgm/pandoc/releases/tag/3.9), checked against a pinned SHA-256 |
| [typst.ts](https://github.com/Myriad-Dreamin/typst.ts) web compiler | 0.7.0 | Apache-2.0; includes [Typst](https://github.com/typst/typst), Apache-2.0 | [github.com/Myriad-Dreamin/typst.ts](https://github.com/Myriad-Dreamin/typst.ts) | PDF output from documents |
| [Libertinus Serif](https://github.com/alerque/libertinus), [New Computer Modern Math](https://www.ctan.org/pkg/newcomputermodern), [DejaVu Sans Mono](https://dejavu-fonts.github.io/) | [typst-assets](https://github.com/typst/typst-assets) 0.14.2 | OFL-1.1; GUST Font License; DejaVu licence | [github.com/typst/typst-assets](https://github.com/typst/typst-assets) | Fonts inside generated PDFs. Full texts in `vendor/fonts/NOTICE` |
| [pdf.js](https://github.com/mozilla/pdf.js) (pdfjs-dist) | 6.5.438 | Apache-2.0; its wasm includes [OpenJPEG](https://github.com/uclouvain/openjpeg), BSD-2-Clause, the JBIG2 decoder from [PDFium](https://pdfium.googlesource.com/pdfium/), BSD-3-Clause, and [qcms](https://github.com/FirefoxGraphics/qcms): see `vendor/pdfjs/LICENSE_*` | [github.com/mozilla/pdf.js](https://github.com/mozilla/pdf.js) | PDF to images. The CMaps and fonts it ships (Adobe, Foxit, Liberation) are packed unchanged into `vendor/pdfjs/data.pack` |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT; includes [pako](https://github.com/nodeca/pako), MIT and Zlib, and [UPNG](https://github.com/Hopding/upng), MIT | [github.com/Hopding/pdf-lib](https://github.com/Hopding/pdf-lib) | Images to PDF |
| [SheetJS](https://git.sheetjs.com/sheetjs/sheetjs) (xlsx) | 0.20.3 | Apache-2.0 | [git.sheetjs.com/sheetjs/sheetjs](https://git.sheetjs.com/sheetjs/sheetjs) | Reading XLSX. From cdn.sheetjs.com at build time, because the npm release is years behind |
| [Papa Parse](https://github.com/mholt/PapaParse) | 5.7.0 | MIT | [github.com/mholt/PapaParse](https://github.com/mholt/PapaParse) | CSV and TSV. Bundled in the data worker |
| [yaml](https://github.com/eemeli/yaml) | 2.9.1 | ISC | [github.com/eemeli/yaml](https://github.com/eemeli/yaml) | YAML. Bundled in the data worker |
| [browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) | 0.4.2 | MIT OR Apache-2.0 | [github.com/bjorn3/browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) | The system interface `pandoc.wasm` runs on. Bundled in the document worker |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | [github.com/101arrowz/fflate](https://github.com/101arrowz/fflate) | Unpacking pandoc's extracted media |
| [client-zip](https://github.com/Touffy/client-zip) | 2.5.1 | MIT | [github.com/Touffy/client-zip](https://github.com/Touffy/client-zip) | Batch ZIPs |
| [gifenc](https://github.com/mattdesl/gifenc) | 1.0.3 | MIT | [github.com/mattdesl/gifenc](https://github.com/mattdesl/gifenc) | Video to GIF |
| [Schibsted Grotesk](https://github.com/schibsted/schibsted-grotesk) | 1.x | OFL-1.1 | [github.com/schibsted/schibsted-grotesk](https://github.com/schibsted/schibsted-grotesk) | Interface type, subset by `scripts/subset-font.sh` |

wasm-vips bundles further libraries (aom, libjxl, cgif, mozjpeg, libwebp, resvg and others). Their versions and licences are in `vendor/vips/THIRD-PARTY-NOTICES.md`.

pandoc is GPL and runs as a separate program in its own worker. `vendor/pandoc/pandoc.wasm` is byte-for-byte the upstream release, with `COPYING.md` and `COPYRIGHT` beside it, so rebake's own code stays MIT. `src/engines/document/pandoc.ts` is adapted from pandoc's MIT-licensed `wasm/pandoc.js`: see `vendor/pandoc/LICENSE.pandoc-js`.

The LGPL components ship as separate, replaceable files. Replacing `vendor/libheif/libheif-bundle.mjs` and rebuilding is enough to swap libheif, and the same goes for `vendor/mp3/mp3-encoder.mjs` and `vendor/aac/aac-encoder.mjs`. Their licence texts sit beside them.

## Modified files

`vendor/mp3/mp3-encoder.mjs`, `vendor/aac/aac-encoder.mjs` and `vendor/flac/flac-encoder.mjs` differ from their releases in one way: their `import ... from "mediabunny"` statements read `globalThis.Mediabunny` instead, because a file served from `/engines/` can't resolve a bare package name. `vendor/manifest.json` records both checksums.

`vendor/typst/typst.mjs` differs from its release in one way: typst.ts builds five fixed callbacks with `new Function`, which the CSP forbids, so `scripts/vendor.mjs` replaces those with a lookup of the same five. `vendor/manifest.json` records both checksums.

`vendor/vips/vips-es6.js` differs from the wasm-vips release in two places. embind builds call wrappers with `new Function`, which rebake's CSP forbids, so `scripts/vendor.mjs` replaces both with closures that make the same calls. `vendor/manifest.json` records the checksum of the upstream file and of the patched one.
