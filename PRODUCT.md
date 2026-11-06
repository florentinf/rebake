# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone with a file in the wrong format. The first screen serves the middle of that crowd: a person who searched "heic to jpg", possibly on a phone, is not technical, and wants the file done in under a minute. Designers, developers and editors use the same screen and find every setting one level down. Neither group should feel the product was made for the other.

## Product Purpose

rebake converts files entirely in the visitor's browser: drop a file, pick a format, get the file back. The server only ships static code. Success means the visitor gets the right file on the first try, trusts where it went, and comes back the next time without searching.

## Positioning

Nothing is uploaded, and that can be checked. Conversion runs in the tab, a Content Security Policy blocks outbound connections, the code is open source under MIT, and a used converter works in airplane mode. Upload-based converters cannot truthfully say this. The claim belongs in the first sentence a visitor reads.

## Operating Context

Visitors arrive from search on a converter page such as `/heic-to-jpg`, or directly at `/`. Files arrive by drag and drop, paste, the file picker, or the phone's share and photo sheets. Sessions are short and usually one job. Sizes range from a 70 B icon to a 1.3 GB video, and batches are common. Phones are a first-class target, used one-handed.

## Capabilities and Constraints

- Images: JPG, PNG, WebP, AVIF, GIF, TIFF, JPEG XL, ICO, with HEIC and SVG as input only.
- Video: MP4, MOV, WebM, MKV, with GIF output for clips up to 15 s, and audio extraction.
- Audio: MP3, M4A, Opus, OGG, FLAC, WAV, with AAC as input.
- Documents: Markdown, HTML, DOCX, ODT, EPUB, RTF, LaTeX in any direction, to PDF as well.
- PDF to PNG or JPG, and images to PDF. A batch of images to PDF gives one PDF.
- Data: CSV, TSV, JSON, YAML in any direction, XLSX to CSV.
- Settings by category: image quality, max width and height, strip metadata (on by default); video quality preset, max resolution, trim, remove audio; audio bitrate and channels; PDF page size, page range; workbook sheet.
- Only targets this browser can really produce are offered. A file is never produced in a format other than the one asked for.
- Progress shows only what is measured. Cancel always works, and Escape also cancels.
- Batches download as one ZIP. Results download automatically, named after the original.
- Shell under 50 KB, no framework, vanilla TypeScript. Every asset comes from rebake's own origin, under a CSP with no inline script.
- UI language is English only.
- localStorage holds only the last target and the settings state per category. No analytics, no cookies.

## Brand Commitments

The name is rebake, lowercase. The product lives at rebake.florentinf.dev. The `FORMAT → FORMAT` title and an arrow that becomes a tick are established and recognisable.

## Evidence on Hand

The README's "Check the claim" steps, the published CSP, the MIT source, and `tests/privacy.spec.ts` and `tests/offline.spec.ts`. There are no user counts, testimonials or benchmarks, and none may be invented.

## Product Principles

1. Nothing leaves the tab, and anyone can verify that.
2. Only offer what will work here, and fail loudly instead of returning a wrong file.
3. The common path is three actions: drop, pick, done.
4. Nothing useful is hidden, and nothing unnecessary is shown.
5. Narrow and excellent beats broad and flaky.

## Accessibility & Inclusion

Full keyboard access, visible focus, 44 px touch targets, and `prefers-reduced-motion` respected. Light and dark follow the system. Plain language throughout: no codec jargon on the common path.
