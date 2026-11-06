import { onMobile, platform, probeEngine } from '../core/capabilities';
import { canMerge, convert, merge } from '../core/convert';
import { detect } from '../core/detect';
import { DEFAULT_OPTIONS, type ConvertOptions, type Inspection, type PageSize, type Progress, type SourceFile, type VideoPreset } from '../core/engine';
import { RebakeError, type ErrorCode } from '../core/errors';
import { FORMATS, type Category, type FormatId } from '../core/formats';
import {
  buildZip, chooseSink, clearSpool, discardDestination, LARGE_FILE_BYTES, outputName, pickDestination,
  type OutputFile, type OutputSink,
} from '../core/output';
import { linkFromPath } from '../core/links';
import { parsePages } from '../core/pages';
import { engineFor, engineOf, offeredTargets, ROUTES } from '../core/routes';
import { createSegment, createSlider, createTrim, formatTime } from './controls';
import { createDrawer } from './drawer';
import { createFormatIndex } from './format-index';
import { collapse, clamp, GLIDE, nudge, rise, rollLabel, SNAP, Spring } from './motion';
import { createRoute } from './route';
import { createSheet, type Row } from './sheet';
import { filmstrip } from './thumbs';

type State = 'empty' | 'file' | 'converting' | 'done';

const STORE_KEY = 'rebake.target';
const ZIP_NAME = 'rebake.zip';
const MERGED_NAME = 'rebake';
const ZONE_LINE = 'Nothing is uploaded. It all happens on your device.';
const TITLE_RESTORE_MS = 280;
const STRIP_FRAMES = 8;
const STRIP_FRAME_SIZE = [96, 72] as const;
/** Overall bar position where each stage starts. Each stage fills up to the next. */
const STAGE_START: Partial<Record<Progress['stage'], number>> = { loading: 0, decoding: 0.15, encoding: 0.3 };
const STAGE_END: Partial<Record<Progress['stage'], number>> = { loading: 0.15, decoding: 0.3, encoding: 1 };
const ETA_AFTER_MS = 1500;
/** The share of a batch's bar kept for writing the ZIP. */
const ZIP_SHARE = 0.05;

const ERRORS: Partial<Record<ErrorCode, string>> = {
  crashed: 'The converter crashed. Try again.',
  memory: "Too large for this device's memory. Set a max width under Options.",
  offline: "You're offline and the converter isn't saved yet. Connect once, then it works offline.",
  corrupt: "This file looks damaged and couldn't be read.",
  locked: 'This file is password-protected. Remove the password, then try again.',
  space: 'Not enough free disk space for this file.',
};

const PRESETS: Record<string, string> = { small: 'Small file', balanced: 'Balanced', high: 'High quality' };
const RESOLUTIONS: Record<string, string> = { 2160: '4K', 1080: '1080p', 720: '720p', 480: '480p' };
const CHANNELS: Record<string, string> = { 1: 'Mono', 2: 'Stereo' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const formatBytes = (bytes: number) => {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
};

const formatLeft = (seconds: number) => `About ${seconds < 120 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`} left`;

/** How a result compares with what went in. */
function sizeChange(before: number, after: number) {
  const ratio = after / before;
  if (Math.abs(ratio - 1) < 0.01) return 'Same size';
  return ratio < 1 ? `${Math.round((1 - ratio) * 100)}% smaller` : `${ratio.toFixed(1)}× larger`;
}

/** `83`, `1:23` or `1:02:03.5` to seconds. Null means it can't be read as a time. */
function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d*)?$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function remember(target: FormatId) {
  try { localStorage.setItem(STORE_KEY, target); } catch { /* private mode */ }
}

function remembered(): string | null {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

interface Item {
  source: SourceFile;
  inspection?: Inspection;
  row: Row;
}

interface Blocker {
  text: string;
  fix?: { label: string; run: () => void };
}

export function startApp() {
  const body = document.body;
  const title = $('title');
  const from = $('from');
  const to = $('to');
  const zone = $('zone');
  const zoneNegative = $('zone-negative');
  const zoneTitle = $('zone-title');
  const negativeTitle = $('negative-title');
  const zoneLine = $('zone-line');
  const negativeLine = $('negative-line');
  const sheetList = $<HTMLUListElement>('sheet');
  const meta = $('meta');
  const formats = $('formats');
  const formatsToggle = $<HTMLButtonElement>('formats-toggle');
  const formatsPanel = $('formats-panel');
  const pick = $('pick');
  const targets = $('targets');
  const drawerRoot = $('drawer');
  const more = $<HTMLButtonElement>('more');
  const options = $('options');
  const summary = $('summary');
  const quality = $<HTMLInputElement>('quality');
  const maxWidth = $<HTMLInputElement>('max-width');
  const maxHeight = $<HTMLInputElement>('max-height');
  const strip = $<HTMLInputElement>('strip');
  const trimStart = $<HTMLInputElement>('trim-start');
  const trimEnd = $<HTMLInputElement>('trim-end');
  const trimStrip = $('trim-strip');
  const removeAudio = $<HTMLInputElement>('remove-audio');
  const pages = $<HTMLInputElement>('pages');
  const sheets = $('sheets');
  const statusWrap = $('status-wrap');
  const progressBar = $('progress');
  const progressText = $('progress-text');
  const progressSide = $('progress-side');
  const action = $('action');
  const primary = $<HTMLButtonElement>('primary');
  const secondary = $<HTMLButtonElement>('secondary');
  const picker = $<HTMLInputElement>('picker');
  const live = $('live');

  const coarse = matchMedia('(pointer: coarse)').matches;
  /** A page like /heic-to-jpg: it opens on that conversion and prefers that target. */
  const link = linkFromPath(location.pathname);

  const route = createRoute(title, from, to, $('glyph'), document.getElementById('arrow') as unknown as SVGPathElement, document.getElementById('track') as unknown as SVGPathElement, $('rider'));
  const drawer = createDrawer(more, options);
  const sheet = createSheet(sheetList, () => {
    pickerAdds = true;
    picker.click();
  });
  const targetSegment = createSegment(targets);
  const sheetSegment = createSegment(sheets);
  const segments = [...options.querySelectorAll<HTMLElement>('.seg')].filter((seg) => seg !== sheets).map(createSegment);
  const slider = createSlider(quality, $('quality-slider'), Number(quality.defaultValue));
  const trim = createTrim($('trim'), trimStart, trimEnd, parseTime, () => {
    showSummary();
    syncReadiness();
  });

  let state: State = 'empty';
  let items: Item[] = [];
  let skipped = 0;
  let target: FormatId = 'jpg';
  let job: AbortController | null = null;
  let sink: OutputSink | null = null;
  let output: OutputFile | null = null;
  let opening = 0;
  let shown = 0;
  let itemShown = 0;
  let convertFrom: number | null = null;
  let encodeStart = 0;
  let batchIndex = 0;
  /** Files the progress bar divides between. A merge is one job, however many files go in. */
  let jobCount = 1;
  /** The result left as a ZIP, which is what the title should then say. */
  let zipped = false;
  let merging = false;
  /** The next pick adds to the list instead of replacing it. */
  let pickerAdds = false;
  let formatsOpen = false;
  let visible = new Set<string>();
  let stripFile: File | null = null;

  const announce = (text: string) => { live.textContent = text; };
  const first = () => items[0]?.source ?? null;
  const totalBytes = () => items.reduce((sum, item) => sum + item.source.file.size, 0);
  const isBatch = () => items.length > 1;
  const isMedia = (format: FormatId) => ['video', 'audio'].includes(FORMATS[format].category);
  const sources = () => items.map((item) => item.source);
  const radio = (name: string) => document.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)?.value ?? '';
  const targetLabel = () => FORMATS[target].label;
  const convertLabel = () => (isBatch() ? `Convert ${items.length} files to ${targetLabel()}` : `Convert to ${targetLabel()}`);

  function setMeta(text: string, isError = false, fix?: Blocker['fix']) {
    meta.replaceChildren(text);
    if (fix) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = fix.label;
      button.addEventListener('click', fix.run);
      meta.append(button);
    }
    meta.hidden = !text;
    meta.classList.toggle('error', isError);
  }

  function setZoneText(text: string, line = zoneLine.textContent ?? '') {
    zoneTitle.textContent = text;
    negativeTitle.textContent = text;
    zoneLine.textContent = line;
    negativeLine.textContent = line;
  }

  function fromLabel() {
    const source = first();
    if (!source) return link ? FORMATS[link.from].label : '';
    if (!isBatch()) return FORMATS[source.format].label;
    const same = items.every((item) => item.source.format === source.format);
    return same ? `${items.length} ${FORMATS[source.format].label}` : `${items.length} files`;
  }

  /** Anything worth saying about the files before Convert. The rows already show the rest. */
  function noteText(extra?: string) {
    const source = first();
    if (!source) return '';
    const notes = [];
    if (skipped) notes.push(`${skipped} skipped`);
    if (totalBytes() >= LARGE_FILE_BYTES && isMedia(source.format) && !platform.streamToDisk) {
      notes.push('getDirectory' in (navigator.storage ?? {})
        ? 'Large: needs free disk space for the whole result'
        : 'Large: may not fit in memory in this browser');
    }
    if (extra) notes.push(extra);
    return notes.join(' · ');
  }

  function render(next: State) {
    const previous = state;
    state = next;
    body.dataset.state = next;
    const hasFile = next !== 'empty';
    const idleLink = next === 'empty' ? link : null;
    const instant = previous === 'empty' || next === 'empty';

    title.hidden = !hasFile && !idleLink;
    zone.hidden = hasFile;
    formats.hidden = hasFile;
    sheetList.hidden = !hasFile;
    action.hidden = !hasFile;
    pick.hidden = !hasFile;
    statusWrap.hidden = !hasFile;
    drawerRoot.hidden = !hasFile || !visible.size;
    route.set(fromLabel(), idleLink ? FORMATS[idleLink.to].label
      : hasFile ? (next === 'done' && zipped ? 'ZIP' : targetLabel()) : '');

    collapse(pick, next === 'file', instant);
    collapse(drawerRoot, next === 'file', instant);
    collapse(statusWrap, next === 'converting' || next === 'done', instant);

    primary.hidden = next === 'converting';
    primary.classList.toggle('soft', next !== 'file');
    secondary.hidden = next === 'empty' || next === 'file';
    secondary.className = next === 'converting' ? 'btn soft grow' : 'quiet';

    if (next === 'file') rollLabel(primary, convertLabel());
    if (next === 'converting') secondary.textContent = 'Cancel';
    if (next === 'done') {
      rollLabel(primary, 'Convert another');
      secondary.textContent = 'Download again';
    }
    if (next === 'converting') progressBar.setAttribute('role', 'progressbar');
    else progressBar.removeAttribute('role');
  }

  function transition(next: State, afterRender?: () => void) {
    const previous = state;
    render(next);
    afterRender?.();
    if (previous === 'empty' && next !== 'empty') {
      rise(title);
      rise(pick, 40);
      rise(drawerRoot, 80);
      rise(action, 120);
    }
    if (next === 'empty') rise(zone, 0, 6);
    if (next === 'converting') secondary.focus({ preventScroll: true });
    else if (next !== 'empty') primary.focus({ preventScroll: true });
    else $('choose').focus({ preventScroll: true });
  }

  /** Targets every file in the selection can become, in the first file's order. */
  function commonTargets(): FormatId[] {
    const lists = items.map(({ source, inspection }) => {
      const list = offeredTargets(ROUTES[source.format]!, source.format, inspection);
      // A long clip in a batch can't be trimmed, so its limit simply rules the target out.
      if (!isBatch()) return list;
      return list.filter((format) => {
        const limit = inspection?.limits?.[format];
        return limit === undefined || (inspection?.duration ?? 0) <= limit;
      });
    });
    return lists[0]!.filter((format) => lists.every((list) => list.includes(format)));
  }

  function buildTargets(keep = false) {
    const list = commonTargets();
    const last = remembered();
    const limit = items[0]?.inspection?.limits?.[last as FormatId];
    const fits = limit === undefined || (items[0]?.inspection?.duration ?? 0) <= limit;
    target = (keep ? list.find((format) => format === target) : undefined)
      ?? list.find((format) => format === link?.to)
      ?? list.find((format) => format === last && fits)
      ?? list[0] ?? 'jpg';
    const count = list.length;
    targets.style.setProperty('--columns', String(count <= 5 ? Math.max(count, 1) : Math.ceil(count / 2)));
    targets.replaceChildren();
    for (const format of list) {
      const label = document.createElement('label');
      label.className = 'target';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'target';
      input.value = format;
      input.checked = format === target;
      const text = document.createElement('span');
      text.textContent = FORMATS[format].label;
      label.append(input, text);
      targets.append(label);
    }
    targetSegment.refresh();
    syncOptions();
  }

  /** Which drawer applies: a video's GIF still takes video settings, a video's MP3 takes audio ones. */
  function drawerKind(): Category {
    const source = first();
    const from = source ? FORMATS[source.format].category : null;
    if (target === 'gif' && from === 'video') return 'video';
    if (from === 'pdf' || from === 'document' || from === 'data') return from;
    return FORMATS[target].category;
  }

  /** What's set right now, so folding the options hides nothing. */
  function showSummary() {
    const has = (token: string) => visible.has(token);
    const bits: string[] = [];
    if (has('lossy-image')) bits.push(`Quality ${quality.value}`);
    if (has('image')) {
      bits.push(maxWidth.value || maxHeight.value ? `Max ${maxWidth.value || 'any'} × ${maxHeight.value || 'any'}` : 'Original size');
      bits.push(strip.checked ? 'Location removed' : 'Location kept');
    }
    if (has('video')) bits.push(PRESETS[radio('preset')] ?? PRESETS.balanced!);
    if (has('video') || has('gif')) {
      const resolution = RESOLUTIONS[radio('resolution')];
      bits.push(resolution ? `Up to ${resolution}` : 'Original resolution');
    }
    if (has('trim')) {
      const duration = items[0]?.inspection?.duration ?? 0;
      const start = trimStart.value ? parseTime(trimStart.value) : 0;
      const end = trimEnd.value ? parseTime(trimEnd.value) : duration;
      const trimmed = !!(trimStart.value || trimEnd.value);
      bits.push(trimmed && start !== null && end !== null && end > start ? `Trimmed to ${formatTime(end - start)}` : 'Full length');
    }
    if (has('has-audio') && removeAudio.checked) bits.push('No sound');
    if (has('lossy-audio')) bits.push(radio('bitrate') ? `${Number(radio('bitrate')) / 1000} kbps` : 'Automatic bitrate');
    if (has('audio')) bits.push(CHANNELS[radio('channels')] ?? 'Same channels');
    if (has('page-size')) bits.push(radio('pageSize') === 'letter' ? 'Letter' : 'A4');
    if (has('pages')) bits.push(pages.value.trim() ? `Pages ${pages.value.trim()}` : 'All pages');
    if (has('sheets')) bits.push(radio('sheet'));
    summary.textContent = bits.join(' · ');
  }

  function syncOptions() {
    const source = first();
    const show = new Set<string>();
    const kind = drawerKind();
    const lossy = !!FORMATS[target].lossy;
    if (kind === 'image') show.add('image');
    if (kind === 'image' && lossy) show.add('lossy-image');
    if (target === 'gif' && kind === 'video') show.add('gif');
    else if (kind === 'video') show.add('video');
    if (kind === 'audio') show.add('audio');
    if (kind === 'audio' && lossy) show.add('lossy-audio');
    if (target === 'pdf') show.add('page-size');
    if (kind === 'pdf' && source?.format === 'pdf') show.add('pages');
    if (kind === 'pdf' && lossy) show.add('lossy-image');
    if (!isBatch() && (items[0]?.inspection?.sheets?.length ?? 0) > 1) show.add('sheets');
    const fromVideo = !!source && FORMATS[source.format].category === 'video';
    if (fromVideo && !isBatch()) show.add('trim');
    if (show.has('video') && items.some((item) => item.inspection?.hasAudio)) show.add('has-audio');
    visible = show;
    drawer.sync(kind, { show });
    drawerRoot.hidden = state === 'empty' || ![...show].length;
    slider.sync();
    for (const segment of segments) segment.refresh();
    sheetSegment.refresh();
    trim.setDuration(!isBatch() ? items[0]?.inspection?.duration ?? 0 : 0);
    showSummary();
    loadFilmstrip();
  }

  /** The trim timeline's frames, once someone can actually see them. */
  async function loadFilmstrip() {
    const file = first()?.file ?? null;
    if (!file || !visible.has('trim') || !drawer.isOpen() || file === stripFile) return;
    stripFile = file;
    trimStrip.replaceChildren();
    const frames = await filmstrip(file, STRIP_FRAMES, ...STRIP_FRAME_SIZE);
    if (frames && stripFile === file) trimStrip.replaceChildren(...frames);
  }

  function setDrawer(open: boolean) {
    drawer.setOpen(open);
    drawer.save();
    loadFilmstrip();
  }

  /** Why Convert can't run right now, in the visitor's terms. Null when it can. */
  function blocker(): Blocker | null {
    const source = first();
    if (!source) return null;
    const inspection = items[0]?.inspection;
    if (source.format === 'pdf' && pages.value.trim() && !parsePages(pages.value)) return { text: 'Use pages like 1-3, 5.' };
    if (!isBatch() && (trimStart.value || trimEnd.value)) {
      const start = trimStart.value ? parseTime(trimStart.value) : 0;
      const end = trimEnd.value ? parseTime(trimEnd.value) : inspection?.duration ?? null;
      if (start === null || end === null) return { text: 'Use a time like 1:30.' };
      if (end <= start) return { text: 'Trim end must be after the start.' };
      if (inspection?.duration && start >= inspection.duration) return { text: 'Trim start is past the end of the file.' };
    }
    const limit = inspection?.limits?.[target];
    if (limit !== undefined && !isBatch()) {
      const start = parseTime(trimStart.value) ?? 0;
      const end = (trimEnd.value ? parseTime(trimEnd.value) : null) ?? inspection?.duration ?? 0;
      if (end - start > limit) {
        return {
          text: `${targetLabel()} works up to ${limit} s.`,
          fix: {
            label: `Trim to ${limit} s`,
            run: () => {
              trimEnd.value = formatTime(start + limit);
              if (!drawer.isOpen()) setDrawer(true);
              trim.draw();
              showSummary();
              syncReadiness();
            },
          },
        };
      }
    }
    return null;
  }

  function syncReadiness(note?: string) {
    const problem = blocker();
    primary.disabled = !!problem;
    if (problem) setMeta(problem.text, true, problem.fix);
    else setMeta(noteText(note));
  }

  function pickTarget(format: FormatId) {
    target = format;
    remember(format);
    route.set(fromLabel(), targetLabel());
    syncOptions();
    rollLabel(primary, convertLabel());
    syncReadiness();
    showDownloadHint();
  }

  async function showDownloadHint() {
    const source = first();
    if (!source || !onMobile() || blocker()) return;
    const asked = target;
    const size = await engineFor(ROUTES[source.format]!, target).downloadSize(source.format, target);
    if (state === 'file' && target === asked) setMeta(noteText(size ? `First use downloads ${formatBytes(size)}` : undefined));
  }

  function refuse(text: string) {
    items = [];
    sheet.clear();
    route.reset();
    render('empty');
    setMeta(text, true);
    setFormats(true);
    nudge(zone);
    announce(text);
  }

  function makeItem(source: SourceFile, inspection?: Inspection): Item {
    const item: Item = {
      source,
      ...(inspection ? { inspection } : {}),
      row: sheet.createRow(source.file, source.format, formatBytes(source.file.size), () => removeItem(item)),
    };
    return item;
  }

  function resetInputs() {
    trimStart.value = '';
    trimEnd.value = '';
    pages.value = '';
    stripFile = null;
    trimStrip.replaceChildren();
  }

  async function open(files: File[], dropPoint?: { x: number; y: number }, adding = false) {
    if (state === 'converting' || !files.length) return;
    const ticket = ++opening;
    const found: Item[] = [];
    let unreadable = 0;
    let lastError: unknown = null;
    for (const file of files) {
      const format = await detect(file);
      const route_ = format ? ROUTES[format] : undefined;
      if (!format || !route_) { unreadable++; continue; }
      const engine = engineOf(route_);
      const probe = await probeEngine(engine);
      const source = { file, format };
      if (!probe.available) {
        if (ticket !== opening) return;
        items = [makeItem(source)];
        skipped = 0;
        route.reset();
        buildTargets();
        sheet.show(items.map((item) => item.row), items.map((item) => item.row), dropPoint);
        transition('file', () => setMeta(probe.reason ?? "This browser can't convert this file.", true));
        primary.disabled = true;
        return;
      }
      try {
        const inspection = await engine.inspect?.(source);
        found.push(makeItem(source, inspection));
      } catch (error) {
        unreadable++;
        lastError = error;
      }
    }
    if (ticket !== opening || (state as State) === 'converting') return;

    if (!found.length) {
      const known = lastError instanceof RebakeError ? ERRORS[lastError.code] : undefined;
      const text = files.length > 1 ? "rebake can't open these files." : known ?? `rebake can't open ${files[0]!.name}.`;
      if (adding) setMeta(text, true);
      else refuse(text);
      return;
    }

    const previous = items;
    items = adding ? [...items, ...found] : found;
    skipped = (adding ? skipped : 0) + unreadable;
    if (!adding) resetInputs();
    buildSheets();
    const list = commonTargets();
    if (!list.length) {
      const note = found[0]?.inspection?.note;
      if (!isBatch() && note) {
        route.reset();
        buildTargets();
        sheet.show(items.map((item) => item.row), found.map((item) => item.row), dropPoint);
        transition('file', () => setMeta(note, true));
        primary.disabled = true;
        announce(note);
        return;
      }
      if (adding) {
        items = previous;
        setMeta('These files have no format in common.', true);
        return;
      }
      refuse('These files have no format in common.');
      return;
    }
    if (!adding) route.reset();
    buildTargets(adding);
    sheet.show(items.map((item) => item.row), found.map((item) => item.row), dropPoint);
    const note = isBatch() ? undefined : found[0]?.inspection?.note;
    transition('file', () => syncReadiness(note));
    announce(`${fromLabel()}. Converting to ${targetLabel()}.`);
    showDownloadHint();
  }

  function removeItem(item: Item) {
    if (state !== 'file') return;
    if (items.length === 1) {
      reset();
      return;
    }
    items = items.filter((other) => other !== item);
    buildSheets();
    buildTargets(true);
    sheet.show(items.map((other) => other.row), []);
    route.set(fromLabel(), targetLabel());
    rollLabel(primary, convertLabel());
    syncReadiness();
  }

  /** A chip per sheet, built only for a workbook that has a choice to make. */
  function buildSheets() {
    const names = items[0]?.inspection?.sheets ?? [];
    sheets.replaceChildren();
    names.forEach((name, index) => {
      const label = document.createElement('label');
      label.className = 'target';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'sheet';
      input.value = name;
      input.checked = index === 0;
      const text = document.createElement('span');
      text.textContent = name;
      label.append(input, text);
      sheets.append(label);
    });
    sheetSegment.refresh();
  }

  function readOptions(): ConvertOptions {
    const options: ConvertOptions = {
      ...DEFAULT_OPTIONS,
      quality: quality.valueAsNumber,
      maxWidth: maxWidth.valueAsNumber || undefined,
      maxHeight: maxHeight.valueAsNumber || undefined,
      stripMetadata: strip.checked,
    };
    const kind = drawerKind();
    if (kind === 'video') {
      options.preset = (radio('preset') || 'balanced') as VideoPreset;
      options.maxResolution = Number(radio('resolution')) || undefined;
      options.removeAudio = removeAudio.checked;
    }
    if (kind === 'audio') {
      options.audioBitrate = FORMATS[target].lossy ? Number(radio('bitrate')) || undefined : undefined;
      options.channels = (Number(radio('channels')) || undefined) as 1 | 2 | undefined;
    }
    if (target === 'pdf') options.pageSize = (radio('pageSize') || 'a4') as PageSize;
    if (kind === 'pdf' && !isBatch() && pages.value.trim()) options.pages = pages.value;
    if (kind === 'data' && !isBatch()) {
      const sheet = radio('sheet');
      if (sheet) options.sheet = sheet;
    }
    if (!isBatch()) {
      options.trimStart = (trimStart.value ? parseTime(trimStart.value) : null) || undefined;
      options.trimEnd = trimEnd.value ? parseTime(trimEnd.value) ?? undefined : undefined;
    }
    return options;
  }

  function setStatus(text: string, side: string) {
    progressText.textContent = text;
    progressSide.textContent = side;
  }

  function placeBar(position: number, left: string, waiting: boolean) {
    shown = Math.max(shown, position);
    route.advance(shown);
    route.waiting(waiting);
    progressBar.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
    const counting = jobCount > 1 ? `Converting ${batchIndex + 1} of ${jobCount}` : 'Converting';
    setStatus(counting, left);
  }

  function showProgress({ stage, fraction }: Progress) {
    if (state !== 'converting') return;
    if (stage === 'converting') {
      convertFrom ??= itemShown;
      itemShown = Math.max(itemShown, convertFrom + (1 - convertFrom) * (fraction ?? 0));
    } else if (stage !== 'finishing') {
      const start = STAGE_START[stage]!;
      const end = STAGE_END[stage]!;
      itemShown = Math.max(itemShown, start + (end - start) * (fraction ?? 0));
    }
    const position = jobCount > 1 ? ((batchIndex + itemShown) / jobCount) * (1 - ZIP_SHARE) : itemShown;
    if (merging) for (const item of items) item.row.develop(itemShown);
    else items[batchIndex]?.row.develop(itemShown);

    let left = '';
    if ((stage === 'encoding' || stage === 'converting') && fraction) {
      encodeStart ||= performance.now();
      const elapsed = performance.now() - encodeStart;
      if (elapsed > ETA_AFTER_MS && fraction > 0.02 && fraction < 1) {
        left = formatLeft(Math.ceil((elapsed / fraction - elapsed) / 1000));
      }
    }
    placeBar(position, left, fraction === null);
    if (stage === 'loading' && jobCount === 1) setStatus('Getting the converter ready', '');
  }

  function uniqueName(name: string, taken: Set<string>) {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    for (let n = 2; taken.has(candidate); n++) candidate = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
    taken.add(candidate);
    return candidate;
  }

  function restoreRows() {
    for (const { source, row } of items) row.restore(source.file.name, formatBytes(source.file.size));
  }

  async function run() {
    const source = first();
    if (!source || state !== 'file' || blocker()) return;
    merging = canMerge(sources(), target);
    const batch = isBatch() && !merging;
    const info = FORMATS[target];
    const finalName = batch ? ZIP_NAME : merging ? `${MERGED_NAME}.${info.extension}` : outputName(source.file.name, info.extension);
    const large = !merging && totalBytes() >= LARGE_FILE_BYTES && (batch || isMedia(source.format));

    // Has to come first: the picker needs the click that got us here.
    let destination: FileSystemFileHandle | null = null;
    if (large) {
      try {
        destination = batch
          ? await pickDestination(finalName, 'application/zip', 'zip')
          : await pickDestination(finalName, info.mime, info.extension);
      } catch {
        return;
      }
    }

    const controller = new AbortController();
    job = controller;
    shown = 0;
    itemShown = 0;
    convertFrom = null;
    encodeStart = 0;
    batchIndex = 0;
    jobCount = batch ? items.length : 1;
    zipped = false;
    const options = readOptions();
    for (const { row } of items) row.latent();
    route.begin();
    route.waiting(true);
    setStatus(batch ? `Converting 1 of ${items.length}` : 'Converting', '');
    transition('converting', () => setMeta(''));
    announce('Converting.');

    try {
      await clearSpool();
      const results: OutputFile[] = [];
      const failed: string[] = [];
      const notes: string[] = [];
      const names = new Set<string>();
      let firstFailure: unknown = null;
      let lastPath = '';

      if (merging) {
        const result = await merge(sources(), target, options, showProgress, controller.signal);
        lastPath = result.path;
        results.push({ blob: result.blob, name: finalName });
      } else {
        for (const [index, { source: item, row }] of items.entries()) {
          batchIndex = index;
          itemShown = 0;
          convertFrom = null;
          encodeStart = 0;
          try {
            const single = batch ? options : { ...options, ...(destination ? { destination } : {}) };
            const result = await convert(item, target, single, showProgress, controller.signal);
            lastPath = result.path;
            if (result.note) notes.push(result.note);
            const stem = outputName(item.file.name, '').slice(0, -1);
            const parts = result.parts ?? [{ blob: result.blob, name: outputName(item.file.name, info.extension) }];
            for (const part of parts) {
              // A file with parts keeps them together in its own folder inside a batch.
              const name = batch && result.parts ? `${stem}/${part.name}` : part.name;
              results.push({ blob: part.blob, name: uniqueName(name, names) });
            }
            const bytes = parts.reduce((sum, part) => sum + part.blob.size, 0);
            row.succeed(parts.length > 1 ? `${parts.length} files` : parts[0]!.name, formatBytes(bytes));
          } catch (error) {
            if (!batch || controller.signal.aborted) throw error;
            firstFailure ??= error;
            failed.push(item.file.name);
            row.fail("Couldn't convert");
          }
        }
      }
      if (!results.length) throw firstFailure;

      if (batch || results.length > 1) {
        const name = batch ? ZIP_NAME : outputName(source.file.name, 'zip');
        const blob = await buildZip(results, name, destination, (fraction) => {
          setStatus('Making the ZIP', '');
          placeBar(1 - ZIP_SHARE + ZIP_SHARE * (fraction ?? 0), '', fraction === null);
          setStatus('Making the ZIP', '');
        }, controller.signal);
        output = { blob, name };
        zipped = true;
      } else {
        output = results[0]!;
      }

      sink = chooseSink(output, destination);
      await sink.deliver(output);
      if (merging) for (const { source: item, row } of items) row.succeed(item.file.name, formatBytes(item.file.size));
      await route.arrive();
      const finished = output;
      const before = totalBytes();
      const change = sizeChange(before, finished.blob.size);
      const line = batch ? (failed.length ? `${items.length - failed.length} of ${items.length} saved as ${finished.name}` : `Saved as ${finished.name}`)
        : merging || results.length > 1 ? `Saved as ${finished.name}`
        : 'Saved';
      const side = batch || merging || results.length > 1 ? `${formatBytes(finished.blob.size)}, ${change}` : change;
      route.finish();
      transition('done', () => {
        const failure = failed.length ? `Failed: ${failed.join(', ')}.` : '';
        const note = [...new Set(notes)].join(' ');
        setStatus(line, side);
        setMeta([failure, note].filter(Boolean).join(' '), failed.length > 0);
        meta.dataset.path = lastPath;
      });
      announce(`Done. ${finished.name} saved.`);
    } catch (error) {
      await discardDestination(destination);
      await clearSpool();
      restoreRows();
      route.retract();
      if (controller.signal.aborted) {
        transition('file', () => syncReadiness());
        announce('Cancelled.');
        return;
      }
      console.error(error);
      const code = error instanceof RebakeError ? error.code : 'crashed';
      const message = ERRORS[code] ?? (error instanceof Error ? error.message : ERRORS.crashed!);
      transition('file', () => setMeta(message, true));
      nudge(title);
      announce(message);
    } finally {
      job = null;
    }
  }

  function reset() {
    sink?.dispose();
    sink = null;
    output = null;
    items = [];
    skipped = 0;
    opening++;
    picker.value = '';
    resetInputs();
    delete meta.dataset.path;
    primary.disabled = false;
    zipped = false;
    sheet.clear();
    route.reset();
    transition('empty', () => setMeta(''));
    void clearSpool();
  }

  function setFormats(open: boolean) {
    formatsOpen = open;
    formatsToggle.setAttribute('aria-expanded', String(open));
    collapse(formatsPanel, open);
  }

  primary.addEventListener('click', () => {
    if (state === 'file') run();
    else if (state === 'done') reset();
  });

  secondary.addEventListener('click', () => {
    if (state === 'converting') job?.abort();
    else if (state === 'done' && output) sink?.deliver(output);
  });

  zone.addEventListener('click', () => {
    pickerAdds = false;
    picker.click();
  });

  formatsToggle.addEventListener('click', () => setFormats(!formatsOpen));
  more.addEventListener('click', () => setDrawer(!drawer.isOpen()));

  picker.addEventListener('change', () => {
    void open([...(picker.files ?? [])], undefined, pickerAdds && state === 'file');
    pickerAdds = false;
  });
  picker.addEventListener('cancel', () => { pickerAdds = false; });

  targets.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'target') return;
    pickTarget(input.value as FormatId);
  });

  options.addEventListener('input', showSummary);
  options.addEventListener('change', showSummary);
  trimStart.addEventListener('input', () => syncReadiness());
  trimEnd.addEventListener('input', () => syncReadiness());
  pages.addEventListener('input', () => syncReadiness());

  addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state === 'converting') job?.abort();
    else if (state === 'file' || state === 'done') reset();
  });

  // The whole window is the drop zone. The counter survives crossing child elements.
  let depth = 0;
  let negativeReach = 0;
  let restTitle: string | null = null;
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const negative = new Spring(0, GLIDE, (radius) => {
    zoneNegative.style.setProperty('--radius', `${Math.max(0, radius).toFixed(1)}px`);
  });
  const corners = new Spring(0, SNAP, (value) => {
    zone.style.setProperty('--in', `${14 + value * 8}px`);
    zone.style.setProperty('--arm', `${20 + value * 22}px`);
  });

  /** The negative spreads from wherever the pointer is. */
  function aimNegative(x: number, y: number) {
    const box = zone.getBoundingClientRect();
    if (!box.width) return;
    const inside = [clamp(x - box.left, 0, box.width), clamp(y - box.top, 0, box.height)] as const;
    zoneNegative.style.setProperty('--x', `${inside[0]}px`);
    zoneNegative.style.setProperty('--y', `${inside[1]}px`);
    negativeReach = Math.hypot(Math.max(inside[0], box.width - inside[0]), Math.max(inside[1], box.height - inside[1])) + 2;
    if (body.classList.contains('dragging')) negative.to(negativeReach, GLIDE);
  }

  function dragLabel(event: DragEvent) {
    const list = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file');
    if (!list.length) return state === 'empty' ? 'Drop to convert' : 'Drop to add';
    const every = (kind: string) => list.every((item) => item.type.startsWith(kind));
    const noun = every('image/') ? 'photo' : every('video/') ? 'video' : every('audio/') ? 'audio file' : 'file';
    return list.length === 1 ? `Drop your ${noun}` : `Drop ${list.length} ${noun}s`;
  }

  function setDragging(on: boolean, label = '') {
    body.classList.toggle('dragging', on);
    if (state === 'empty') {
      if (on) {
        restTitle ??= zoneTitle.textContent;
        setZoneText(label);
      }
      negative.to(on ? negativeReach : 0, on ? GLIDE : { response: 0.3, damping: 1 });
    }
    if (!on && restTitle) {
      const rest = restTitle;
      restTitle = null;
      setTimeout(() => {
        if (!body.classList.contains('dragging')) setZoneText(rest);
      }, TITLE_RESTORE_MS);
    }
    corners.to(on ? 1 : 0, on ? { response: 0.38, damping: 0.72 } : SNAP);
    const catching = on && state === 'file';
    sheet.addCell.classList.toggle('catch', catching);
    sheet.addLabel.textContent = catching ? label : 'Add files';
    if (catching) sheetList.scrollTo({ top: sheetList.scrollHeight });
  }

  addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    aimNegative(event.clientX, event.clientY);
    if (!depth++) setDragging(true, dragLabel(event));
  });
  addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    aimNegative(event.clientX, event.clientY);
  });
  addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) setDragging(false);
  });
  addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    setDragging(false);
    void open([...(event.dataTransfer?.files ?? [])], { x: event.clientX, y: event.clientY }, state === 'file');
  });

  addEventListener('paste', (event) => {
    void open([...(event.clipboardData?.files ?? [])], undefined, state === 'file');
  });

  if (link) {
    const label = FORMATS[link.from].label;
    setZoneText(coarse ? `Convert ${label} files` : `Drop ${label} files`, ZONE_LINE);
  } else {
    setZoneText(coarse ? 'Convert files' : 'Drop files to convert', ZONE_LINE);
  }
  createFormatIndex($('index'), $('lookup'));
  render('empty');
}
