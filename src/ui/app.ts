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
import { linkFromPath, linkLine } from '../core/links';
import { parsePages } from '../core/pages';
import { engineFor, engineOf, offeredTargets, ROUTES } from '../core/routes';
import { createDrawer } from './drawer';
import { flip, prefersReducedMotion } from './flip';

type State = 'empty' | 'file' | 'converting' | 'done';

const STORE_KEY = 'rebake.target';
const ZIP_NAME = 'rebake.zip';
const MERGED_NAME = 'rebake';
/** Overall bar position where each stage starts. Each stage fills up to the next. */
const STAGE_START: Partial<Record<Progress['stage'], number>> = { loading: 0, decoding: 0.15, encoding: 0.3 };
const STAGE_END: Partial<Record<Progress['stage'], number>> = { loading: 0.15, decoding: 0.3, encoding: 1 };
const ETA_AFTER_MS = 1500;
/** The share of a batch's bar kept for writing the ZIP. */
const ZIP_SHARE = 0.05;

const ERRORS: Partial<Record<ErrorCode, string>> = {
  crashed: 'The converter crashed. Try again.',
  memory: "Too large for this device's memory. Set a max width under More.",
  offline: "You're offline and the converter isn't saved yet. Connect once, then it works offline.",
  corrupt: "This file looks damaged and couldn't be read.",
  locked: 'This file is password-protected. Remove the password, then try again.',
  space: 'Not enough free disk space for this file.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const formatBytes = (bytes: number) => {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
};

const formatLeft = (seconds: number) => (seconds < 120 ? `${seconds} s left` : `${Math.ceil(seconds / 60)} min left`);

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
}

export function startApp() {
  const body = document.body;
  const title = $('title');
  const from = $('from');
  const to = $('to');
  const glyph = document.getElementById('glyph') as unknown as SVGElement;
  const joiner = $('joiner');
  const meta = $('meta');
  const targets = $<HTMLFieldSetElement>('targets');
  const drawerRoot = $('drawer');
  const more = $<HTMLButtonElement>('more');
  const quality = $<HTMLInputElement>('quality');
  const qualityValue = $<HTMLOutputElement>('quality-value');
  const maxWidth = $<HTMLInputElement>('max-width');
  const maxHeight = $<HTMLInputElement>('max-height');
  const strip = $<HTMLInputElement>('strip');
  const trimStart = $<HTMLInputElement>('trim-start');
  const trimEnd = $<HTMLInputElement>('trim-end');
  const removeAudio = $<HTMLInputElement>('remove-audio');
  const pages = $<HTMLInputElement>('pages');
  const sheets = $<HTMLFieldSetElement>('sheets');
  const primary = $<HTMLButtonElement>('primary');
  const secondary = $<HTMLButtonElement>('secondary');
  const progressBar = $('progress');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const picker = $<HTMLInputElement>('picker');
  const live = $('live');
  const drawer = createDrawer(drawerRoot, more, $('options'));

  const idleTitle = matchMedia('(pointer: coarse)').matches ? 'Pick a file' : 'Drop a file';
  /** A page like /heic-to-jpg: it opens on that conversion and prefers that target. */
  const link = linkFromPath(location.pathname);

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

  const announce = (text: string) => { live.textContent = text; };
  const first = () => items[0]?.source ?? null;
  const totalBytes = () => items.reduce((sum, item) => sum + item.source.file.size, 0);
  const isBatch = () => items.length > 1;
  const isMedia = (format: FormatId) => ['video', 'audio'].includes(FORMATS[format].category);
  const sources = () => items.map((item) => item.source);
  const radio = (name: string) => document.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)?.value ?? '';

  function setMeta(text: string, isError = false) {
    meta.textContent = text;
    meta.hidden = !text;
    meta.classList.toggle('error', isError);
  }

  function fromLabel() {
    const source = first();
    if (!source) return idleTitle;
    if (!isBatch()) return FORMATS[source.format].label;
    const same = items.every((item) => item.source.format === source.format);
    return same ? `${items.length} ${FORMATS[source.format].label}` : `${items.length} files`;
  }

  /** What the file state says about the job. Warnings live here so they're seen before Convert. */
  function selectedLabel() {
    const source = first();
    if (!source) return '';
    let text = isBatch()
      ? `${items.length} files · ${formatBytes(totalBytes())}`
      : `${source.file.name} · ${formatBytes(source.file.size)}`;
    if (skipped) text += ` · ${skipped} skipped`;
    if (totalBytes() >= LARGE_FILE_BYTES && isMedia(source.format) && !platform.streamToDisk) {
      text += 'getDirectory' in (navigator.storage ?? {})
        ? ' · Large: needs free disk space for the whole result'
        : ' · Large: may not fit in memory in this browser';
    }
    return text;
  }

  function render(next: State) {
    state = next;
    body.dataset.state = next;
    const hasFile = next !== 'empty';

    const idleLink = next === 'empty' ? link : null;
    from.textContent = hasFile ? fromLabel() : idleLink ? FORMATS[idleLink.from].label : idleTitle;
    to.textContent = idleLink ? FORMATS[idleLink.to].label
      : hasFile ? (next === 'done' && zipped ? 'ZIP' : FORMATS[target].label) : '';
    glyph.toggleAttribute('hidden', !hasFile && !idleLink);
    joiner.hidden = !hasFile && !idleLink;
    targets.hidden = next !== 'file';
    drawerRoot.hidden = next !== 'file';
    primary.hidden = next === 'converting';
    progressBar.hidden = next !== 'converting';
    secondary.hidden = next === 'empty' || next === 'file';

    if (next === 'empty') primary.textContent = 'Choose file';
    if (next === 'file') primary.textContent = 'Convert';
    if (next === 'converting') secondary.textContent = 'Cancel';
    if (next === 'done') {
      primary.textContent = 'Convert another';
      secondary.textContent = 'Save again';
    }
  }

  function transition(next: State, afterRender?: () => void) {
    flip(() => {
      render(next);
      afterRender?.();
    });
    if (next === 'converting') secondary.focus({ preventScroll: true });
    else primary.focus({ preventScroll: true });
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

  function buildTargets() {
    const list = commonTargets();
    const last = remembered();
    const limit = items[0]?.inspection?.limits?.[last as FormatId];
    const fits = limit === undefined || (items[0]?.inspection?.duration ?? 0) <= limit;
    target = list.find((format) => format === link?.to)
      ?? list.find((format) => format === last && fits)
      ?? list[0] ?? 'jpg';
    targets.replaceChildren(targets.querySelector('legend')!);
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
    drawer.sync(kind, { show });
    drawerRoot.hidden = state !== 'file' || ![...show].length;
    qualityValue.textContent = quality.value;
  }

  /** Why Convert can't run right now, in the visitor's terms. Null when it can. */
  function blocker(): string | null {
    const source = first();
    if (!source) return null;
    const inspection = items[0]?.inspection;
    if (source.format === 'pdf' && pages.value.trim() && !parsePages(pages.value)) return 'Use pages like 1-3, 5.';
    if (!isBatch() && (trimStart.value || trimEnd.value)) {
      const start = trimStart.value ? parseTime(trimStart.value) : 0;
      const end = trimEnd.value ? parseTime(trimEnd.value) : inspection?.duration ?? null;
      if (start === null || end === null) return 'Use a time like 1:30.';
      if (end <= start) return 'Trim end must be after the start.';
      if (inspection?.duration && start >= inspection.duration) return 'Trim start is past the end of the file.';
    }
    const limit = inspection?.limits?.[target];
    if (limit !== undefined && !isBatch()) {
      const start = parseTime(trimStart.value) ?? 0;
      const end = (trimEnd.value ? parseTime(trimEnd.value) : null) ?? inspection?.duration ?? 0;
      if (end - start > limit) return `${FORMATS[target].label} is limited to ${limit} s. Trim it under More.`;
    }
    return null;
  }

  function syncReadiness(note?: string) {
    const problem = blocker();
    primary.disabled = !!problem;
    if (problem) setMeta(problem, true);
    else setMeta(note ?? selectedLabel());
  }

  function pickTarget(format: FormatId) {
    target = format;
    remember(format);
    to.textContent = FORMATS[format].label;
    flip(syncOptions);
    syncReadiness();
    showDownloadHint();
    if (!prefersReducedMotion()) {
      to.animate(
        [{ opacity: 0, transform: 'translateY(0.08em)' }, { opacity: 1, transform: 'none' }],
        { duration: 160, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
  }

  async function showDownloadHint() {
    const source = first();
    if (!source || !onMobile() || blocker()) return;
    const asked = target;
    const size = await engineFor(ROUTES[source.format]!, target).downloadSize(source.format, target);
    if (state === 'file' && target === asked) setMeta(size ? `${selectedLabel()} · ${formatBytes(size)} download` : selectedLabel());
  }

  function refuse(text: string) {
    items = [];
    flip(() => {
      render('empty');
      setMeta(text, true);
    });
    announce(text);
  }

  async function open(files: File[]) {
    if (state === 'converting' || !files.length) return;
    const ticket = ++opening;
    const found: Item[] = [];
    let unreadable = 0;
    let lastError: unknown = null;
    for (const file of files) {
      const format = await detect(file);
      const route = format ? ROUTES[format] : undefined;
      if (!format || !route) { unreadable++; continue; }
      const engine = engineOf(route);
      const probe = await probeEngine(engine);
      const source = { file, format };
      if (!probe.available) {
        if (ticket !== opening) return;
        items = [{ source }];
        skipped = 0;
        buildTargets();
        transition('file', () => setMeta(probe.reason ?? "This browser can't convert this file.", true));
        primary.disabled = true;
        return;
      }
      try {
        const inspection = await engine.inspect?.(source);
        found.push(inspection ? { source, inspection } : { source });
      } catch (error) {
        unreadable++;
        lastError = error;
      }
    }
    if (ticket !== opening || (state as State) === 'converting') return;

    if (!found.length) {
      const known = lastError instanceof RebakeError ? ERRORS[lastError.code] : undefined;
      refuse(files.length > 1 ? "rebake can't open these files." : known ?? `rebake can't open ${files[0]!.name}.`);
      return;
    }

    items = found;
    skipped = unreadable;
    trimStart.value = '';
    trimEnd.value = '';
    pages.value = '';
    buildSheets();
    const list = commonTargets();
    if (!list.length) {
      const note = found[0]?.inspection?.note;
      if (!isBatch() && note) {
        buildTargets();
        transition('file', () => setMeta(note, true));
        primary.disabled = true;
        announce(note);
        return;
      }
      refuse('These files have no format in common.');
      return;
    }
    buildTargets();
    const note = isBatch() ? undefined : found[0]?.inspection?.note;
    transition('file', () => syncReadiness(note));
    announce(`${fromLabel()}. Converting to ${FORMATS[target].label}.`);
    showDownloadHint();
  }

  /** A chip per sheet, built only for a workbook that has a choice to make. */
  function buildSheets() {
    const names = items[0]?.inspection?.sheets ?? [];
    sheets.replaceChildren(sheets.querySelector('legend')!);
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

  function placeBar(position: number, label: string, waiting: boolean) {
    shown = Math.max(shown, position);
    progressFill.style.transform = `scaleX(${shown})`;
    progressBar.classList.toggle('waiting', waiting);
    const percent = Math.round(shown * 100);
    progressBar.setAttribute('aria-valuenow', String(percent));
    progressText.textContent = jobCount > 1 ? `${batchIndex + 1}/${jobCount} · ${percent}%${label}` : `${percent}%${label}`;
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

    let left = '';
    if ((stage === 'encoding' || stage === 'converting') && fraction) {
      encodeStart ||= performance.now();
      const elapsed = performance.now() - encodeStart;
      if (elapsed > ETA_AFTER_MS && fraction > 0.02 && fraction < 1) {
        left = ` · ${formatLeft(Math.ceil((elapsed / fraction - elapsed) / 1000))}`;
      }
    }
    placeBar(position, left, fraction === null);
  }

  function uniqueName(name: string, taken: Set<string>) {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    for (let n = 2; taken.has(candidate); n++) candidate = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
    taken.add(candidate);
    return candidate;
  }

  async function run() {
    const source = first();
    if (!source || state !== 'file' || blocker()) return;
    const merging = canMerge(sources(), target);
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
    progressFill.style.transform = 'scaleX(0)';
    progressText.textContent = batch ? `1/${items.length} · 0%` : '0%';
    progressBar.classList.add('waiting');
    transition('converting', () => setMeta(selectedLabel()));
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
        for (const [index, { source: item }] of items.entries()) {
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
            for (const part of result.parts ?? [{ blob: result.blob, name: outputName(item.file.name, info.extension) }]) {
              // A file with parts keeps them together in its own folder inside a batch.
              const name = batch && result.parts ? `${stem}/${part.name}` : part.name;
              results.push({ blob: part.blob, name: uniqueName(name, names) });
            }
          } catch (error) {
            if (!batch || controller.signal.aborted) throw error;
            firstFailure ??= error;
            failed.push(item.file.name);
          }
        }
      }
      if (!results.length) throw firstFailure;

      if (batch || results.length > 1) {
        const name = batch ? ZIP_NAME : outputName(source.file.name, 'zip');
        const blob = await buildZip(results, name, destination, (fraction) => {
          placeBar(1 - ZIP_SHARE + ZIP_SHARE * (fraction ?? 0), '', fraction === null);
        }, controller.signal);
        output = { blob, name };
        zipped = true;
      } else {
        output = results[0]!;
      }

      sink = chooseSink(output, destination);
      await sink.deliver(output);
      progressFill.style.transform = 'scaleX(1)';
      const finished = output;
      transition('done', () => {
        const was = batch ? `${items.length - failed.length} of ${items.length} files`
          : merging ? `${items.length} pages`
          : `was ${formatBytes(source.file.size)}`;
        const separator = batch || merging ? ' · ' : ', ';
        const failure = failed.length ? ` Failed: ${failed.join(', ')}.` : '';
        const note = notes.length ? ` ${[...new Set(notes)].join(' ')}` : '';
        setMeta(`${finished.name} · ${formatBytes(finished.blob.size)}${separator}${was}${failure}${note}`, failed.length > 0);
        meta.dataset.path = lastPath;
      });
      announce(`Done. ${finished.name} saved.`);
    } catch (error) {
      await discardDestination(destination);
      await clearSpool();
      if (controller.signal.aborted) {
        transition('file', () => syncReadiness());
        announce('Cancelled.');
        return;
      }
      console.error(error);
      const code = error instanceof RebakeError ? error.code : 'crashed';
      const message = ERRORS[code] ?? (error instanceof Error ? error.message : ERRORS.crashed!);
      transition('file', () => setMeta(message, true));
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
    trimStart.value = '';
    trimEnd.value = '';
    pages.value = '';
    delete meta.dataset.path;
    primary.disabled = false;
    zipped = false;
    transition('empty', () => setMeta(link ? linkLine(link) : ''));
    void clearSpool();
  }

  function toggleDrawer() {
    flip(() => {
      drawer.setOpen(!drawer.isOpen());
      drawer.save();
    });
  }

  primary.addEventListener('click', () => {
    if (state === 'empty') picker.click();
    else if (state === 'file') run();
    else if (state === 'done') reset();
  });

  secondary.addEventListener('click', () => {
    if (state === 'converting') job?.abort();
    else if (state === 'done' && output) sink?.deliver(output);
  });

  more.addEventListener('click', toggleDrawer);

  picker.addEventListener('change', () => {
    open([...(picker.files ?? [])]);
  });

  targets.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'target') return;
    pickTarget(input.value as FormatId);
    remember(target);
  });

  quality.addEventListener('input', () => { qualityValue.textContent = quality.value; });
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
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

  addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth++;
    body.classList.add('dragging');
  });
  addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  });
  addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) body.classList.remove('dragging');
  });
  addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    body.classList.remove('dragging');
    open([...(event.dataTransfer?.files ?? [])]);
  });

  addEventListener('paste', (event) => {
    open([...(event.clipboardData?.files ?? [])]);
  });

  render('empty');
  if (link) setMeta(linkLine(link));
  title.classList.add('ready');
}
