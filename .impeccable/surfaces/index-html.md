---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["src/ui/styles.css","src/ui/app.ts"]
---

# Converter app and first visit

Scope: `/`, the `/x-to-y` converter pages and Privacy. Visitor mode: Operate, with one first-visit job of explaining the product.

Audience and job: anyone with a file in the wrong format finishes in under a minute. Settings stay one level down and always visible as a summary.

Constraints: PRODUCT.md. No framework, shell under 50 KB, self-hosted font, CSP without inline script.

Chosen direction: Darkroom. A print develops in the room you are standing in; nothing goes to a lab.

Memorable moment: the arrow in the title is the progress bar. It grows across the page to reach the target format, then folds into a tick.

Unresolved: real thumbnails for HEIC in non-Safari browsers; waveform and first-frame extraction cost.

## Direction contract

THESIS: rebake is a tool, not a page. One object, the `FORMAT → FORMAT` title, carries the whole job from pick to tick. Refuses headlines, pitches, the upload box and swapped screens.

OWN-WORLD: Fibre-paper ground and developer-black ink in light; the unlit room, warm black, in dark. Safelight amber means working, fixed green means done. A batch is a list of rows, each with a small print that develops. Ply is the only rank: page and one raised sheet.

STORY: The visitor reads what rebake does and that nothing uploads, drops a file, watches it develop, and gets it back.

FIRST VIEWPORT: Wordmark, then one 620 px column. A large drop zone with four corner marks, a short title, one line saying nothing is uploaded, and Choose files. All formats folds below it. Footer: Free and open source, Privacy. No headline or marketing copy.

FORM: Darkroom safelight and developing print, position 6 of 7, seed:f04a5ea8a005087b.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
