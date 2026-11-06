---
name: rebake
description: Convert files in your browser. Nothing is uploaded.
colors:
  ink: "oklch(21% 0.005 70)"
  on-ink: "oklch(98% 0.004 85)"
  work: "oklch(65% 0.165 56)"
  done: "oklch(50% 0.125 152)"
  error: "oklch(50% 0.175 25)"
  paper: "oklch(97.9% 0.004 85)"
  sheet: "oklch(99.5% 0.002 85)"
  well: "oklch(93.8% 0.005 80)"
  well-2: "oklch(90.6% 0.006 80)"
  soft: "oklch(93.8% 0.005 80)"
  line: "oklch(87.5% 0.007 75)"
  ink-2: "oklch(45% 0.012 65)"
  ink-3: "oklch(64% 0.01 70)"
  ink-dark: "oklch(94.5% 0.006 80)"
  on-ink-dark: "oklch(19% 0.004 70)"
  work-dark: "oklch(76% 0.15 60)"
  done-dark: "oklch(79% 0.14 152)"
  error-dark: "oklch(73% 0.15 25)"
  paper-dark: "oklch(19% 0.004 70)"
  sheet-dark: "oklch(26% 0.005 70)"
  well-dark: "oklch(15% 0.004 70)"
  well-2-dark: "oklch(30% 0.005 70)"
  soft-dark: "oklch(26% 0.005 70)"
  line-dark: "oklch(32% 0.005 70)"
  ink-2-dark: "oklch(73% 0.01 75)"
  ink-3-dark: "oklch(52% 0.01 70)"
typography:
  route:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 8.4vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 4.4vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.022em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.5
  target:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "clamp(0.9375rem, 2.9vw, 1.0625rem)"
    fontWeight: 600
    lineHeight: 1.5
  print:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.01em"
  rider:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  r-xs: "6px"
  r-s: "8px"
  r-m: "12px"
  r-l: "16px"
spacing:
  gutter: "clamp(1rem, 4vw, 2rem)"
  column: "38.75rem"
  touch: "2.75rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.r-m}"
    height: "3.25rem"
    padding: "0 1.5rem"
  button-raised:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-m}"
    height: "2.75rem"
    padding: "0 1.125rem"
  button-soft:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-m}"
    height: "3.25rem"
    padding: "0 1.5rem"
  button-quiet:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r-m}"
    height: "3.25rem"
    padding: "0 1rem"
  drop-zone:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-l}"
    padding: "2rem 1.5rem"
  drop-zone-negative:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.r-l}"
  segment:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r-m}"
    padding: "3px"
  segment-large:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r-l}"
    padding: "4px"
  input:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-s}"
    height: "2.75rem"
    padding: "0 0.75rem"
---

# Design System: rebake

## Overview

**Creative North Star: "The Darkroom"**

rebake is a tool, not a page. A print develops in the room you are standing in, and nothing goes to a lab. One object, the `FORMAT → FORMAT` title, carries the whole job from pick to tick.

The drop zone is the first screen: wordmark, zone, All formats, footer, and no headline above it. The column then changes in place. Screens are never swapped.

**Key Characteristics:**
- Fibre paper and black ink in light, the unlit room in dark. Both follow the system.
- Colour means state, and nothing else.
- The arrow is the progress bar, and it folds into the tick.

## Colors

Warm paper, warm black, and three colours that each mean one thing. `-dark` keys replace their light twins.

### Primary
- **Developer Ink** (`ink`, `on-ink`): text, primary button, selection, focus.

### Secondary
- **Safelight Amber** (`work`): the arrow while it works.
- **Fixed Green** (`done`): the arrow when it folds, and a finished row's tick.
- **Stop Red** (`error`): the error line and a failed row.

### Neutral
- **Fibre Paper** (`paper`): the page. **Raised Sheet** (`sheet`): the one thing above it.
- **Well** (`well`, `well-2`): pressed into the page, and its hover. **Soft** (`soft`): a button that has stopped pushing.
- **Ink 2** (`ink-2`): secondary text. **Ink 3** (`ink-3`): about 3:1, so large type and marks only. **Line** (`line`): the arrow's track.

### Named Rules

**The State Colour Rule.** Amber is working, green is done, red is error. Actions, focus and selection are ink. The only other colour on screen is the visitor's own pictures.

**The Negative Rule.** The drop effect has no colour. The zone becomes its own negative, ink spreading from the pointer. With a file open, the Add files row fills with ink the same way.

## Typography

**Font:** Hanken Grotesk (with system-ui, sans-serif). OFL, variable, self-hosted, Latin subset with `wght` limited to 400–600.

**Character:** Plain at reading size, firm when set large. One family does everything. Tabular figures stay on everywhere, so percentages don't jitter.

### Hierarchy
- **Route** (600): the title. It shrinks to fit a long format name and never wraps.
- **Title** (600): the zone title and text page headings.
- **Body** (400): everything that reads.
- **Label** (500): format names.
- **Target** (600): the format picker, fluid within its fixed-height cells.
- **Print** (600): the fallback format label inside a thumbnail. The filename beside it stays body size.
- **Rider** (600): the percentage under the arrow's tip.

## Layout

One centred column, with the action bar sticky at the bottom. Sections open and close to their natural height in place. Below 40rem the zone fills the height and the action drops under the thumb. Past five files the list scrolls inside itself.

## Elevation & Depth

Ply is the only rank: the page and one raised sheet, on the two soft layers of `--ply`. Wells sink instead. Raised things are the sliding mark, the switch and slider thumbs, and Choose files, and nothing stacks on them.

## Shapes

Gently curved, in four steps: zone, buttons, fields and prints, small marks. A shape inside a well takes the outer radius less the padding. Every stroke has round caps and joins, and every icon is authored SVG.

Nested corners are derived, not additional surface tokens: the small segment's sliding mark and focus shape use 9 px (12 px minus 3 px padding). The switch and its thumb are capsules, with radii half their heights (14 px and 11 px). Slider rails and trim grips use 3 px, alignment marks use 1 px, the Options focus shape uses 4 px, and link focus shapes use 2 px. These details do not change the four-step surface scale.

## Components

- **Drop zone:** a well with four corner marks, like an enlarger's easel. The whole window accepts the drop.
- **Route:** format, arrow, format. The arrow is three strokes on three springs. It grows across the column to the target with the percentage riding its tip, then folds into the tick, or retracts from wherever it is. With no signal it holds still and breathes.
- **Rows:** a small print, a name, a size, a result. The print develops from pale grey to the finished picture, following real progress.
- **Buttons:** primary is ink, Choose files is raised. Once the job runs the page stops pushing: Cancel and Convert another are soft, Download again is quiet.
- **Target picker:** a well with one mark that slides between radios, across rows too.
- **Options:** folded by default, and the folded head still shows the values, like `Original size · Location removed`.
- **Slider and trim:** the value rides the thumb, and it stops softly at the recommended value. Trim's Start and End fields stay the source of truth for its handles.
- **Errors:** replace the meta line in plain language and leave the page usable.
- **Warnings:** size and first-use download notices appear in the meta line before Convert, in secondary ink. Errors use red; warnings do not. A partial batch keeps successful results and names the failed files.
- **Converter pages:** `/heic-to-jpg` opens the same interface with its route title and a matching drop prompt. Privacy and Not found use the same column, paper, type and focus treatment without loading the app script.

### Motion

| Spring | Response | Damping | Use |
| --- | --- | --- | --- |
| Snap | 0.22 s | 1 | Controls: sliding mark, slider |
| Glide | 0.42 s | 1 | Layout: collapse, row shifts, the negative |
| Chase | 0.62 s | 1 | Real progress: arrow tip, print developing |
| Flick | 0.40 s | 0.78 | Arrival: the arrow's fold, rows landing from a drop |

Layout, progress and direct manipulation run on springs, so they can be turned back at any point. Entrances, label changes and refusal feedback use short Web Animations; colour, presses, the switch and row ticks use CSS transitions. With reduced motion, springs jump to their target, Web Animations are skipped and CSS animation durations are reduced to effectively zero. The measured progress, state colours and status text remain available.

## Do's and Don'ts

### Do:
- **Do** keep native inputs as the real controls. Range, radio and checkbox stay in place, transparent, so the keyboard, assistive tech and saved state keep working.
- **Do** show only measured progress.
- **Do** keep 44 px touch targets.

### Don't:
- **Don't** put style attributes or `<style>` in markup. The CSP has no `style-src`, so `default-src 'self'` blocks them. Script may still set `element.style`, and the springs depend on it.
- **Don't** add an accent, or colour the drop effect.
- **Don't** give the zone a dashed outline. The arrow's dotted track stays: it marks the distance left.
- **Don't** set Hanken Grotesk outside 400–600. The file stops there and synthesis is off.
