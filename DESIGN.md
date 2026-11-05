# Design

rebake is an instrument. It should feel like a good pair of callipers: neutral, exact, and a pleasure to hold.

## Rules

1. Functional and neutral, not warm. Its own identity, unrelated to any portfolio.
2. Minimal text. Every word earns its place: no taglines, no explainers. One line says files never leave the device.
3. One primary action visible at a time. The whole window is the drop zone.
4. Motion is purposeful, fast and calm. Never cute, never decorative.
5. Honest progress: show only what is measured.
6. Light and dark follow the system, and both are fully designed.
7. Respect `prefers-reduced-motion`. Full keyboard access, visible focus, 44 px touch targets, excellent on a phone.

## The idea

The title is the interface. `HEIC → JPG` set huge states what you have and what you'll get, so no label is needed. When the job finishes, the arrow redraws as a tick, and that is the only flourish in the product.

Content sits at the bottom left: on a phone that's where the thumb is, on a desktop it reads as a poster rather than a centred form.

## Type

**Schibsted Grotesk**, OFL, variable, self-hosted. Subset to Latin with `wght` limited to 400–600 (33 KB). Two weights: 400 and 600.

Built for a Nordic news group, not for app templates. It has a news grotesk's firm, slightly squared construction, with tighter apertures than the neutral UI faces, so format names set at 136 px have a voice while body text stays plain. It's also rare enough not to read as a default. Tabular figures stay on everywhere, so percentages don't jitter.

Sizes: title `clamp(3rem, 12.5vw, 8.5rem)` at -0.04em, everything else 1rem.

## Colour

True greys with zero chroma, so nothing leans warm or cold. One accent: a cold viridian, hue 187 in OKLCH.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | 97.5% | 17% | Page |
| `--surface` | 93% | 23.5% | Target chips, progress track |
| `--ink` | 19% | 95% | Text, primary button, selected chip |
| `--ink-2` | 45% | 72% | Secondary text |
| `--accent` | 50% .11 187 | 78% .11 187 | Focus ring, drag frame, progress fill, done tick, selection |
| `--error` | 50% .17 27 | 76% .13 27 | Errors |

The primary button is ink, not accent. Accent marks state, not action.

## Motion

| Moment | Treatment | Timing |
| --- | --- | --- |
| State change | FLIP: elements glide from their old position, new ones rise 6 px and fade | 220 ms ease-out |
| Target change | Title word settles in | 160 ms ease-out |
| Drag over | Frame arrives with a slight overshoot | 280 ms spring, `linear()` |
| Press | Scale to 0.985 | 150 ms |
| Progress | Fill follows measured value | 220 ms ease-out |
| No signal | Fill holds its position and breathes opacity | 1.4 s |
| Done | Arrow undraws, tick draws in accent | 220 ms |

FLIP measures mid-animation, so transitions can be interrupted without jumping. With reduced motion, positions change instantly and the tick simply appears.

## Components

- **Primary button:** 56 px tall, 8 px radius. On a phone it spans the width. When done it drops to surface grey: the job is over, so the page stops pushing.
- **Target chips:** radios, 44 px tall. Selected is solid ink.
- **Progress:** takes the button's exact place, so nothing moves. Cancel sits beside it. Escape also cancels.
- **Drawer:** "More" expands in place. Closed by default, and each category remembers its own state. Settings that pick one of a few values are small target chips, not selects. Only what applies to the current target shows.
- **Batch:** the title counts (`3 files → MP4`), and the progress text counts too (`2/3 · 40%`). Nothing else changes.
- **Errors:** replace the meta line, in plain language, and always leave the page usable.
- **Converter pages:** `/heic-to-jpg` is the same page, opening on that title with one line beneath it. No other copy.
- **Text pages:** Privacy and Not found use the title's size and the meta line's grey, with no script.
- **Warnings:** a large file's warning joins the meta line before Convert, in the same grey. Only errors are red.
