import engines from 'virtual:engines';
import { platform, probeEngine } from '../../core/capabilities';
import type { ConvertOptions, ConvertResult, Engine, OnProgress, OutputPart, SourceFile } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import { uncachedBytes } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { parsePages } from '../../core/pages';
import { WorkerHost } from '../../core/worker-host';
import { imageEngine } from '../image';
import type { AddRequest, FinishReply, RenderReply, RenderRequest, StartRequest } from './protocol';

const host = new WorkerHost(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rebake-pdf' }),
);

const IMAGES: ReadonlySet<FormatId> = new Set(['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heic', 'jxl', 'svg', 'ico']);
/** Photos stay JPEG inside the PDF. Drawn images keep their sharp edges as PNG. */
const DRAWN: ReadonlySet<FormatId> = new Set(['png', 'gif', 'svg', 'ico']);
const PHOTO_QUALITY = 92;
/** Pixels are re-read through the image engine, so stripping follows its default. */
const IMAGE_OPTIONS: ConvertOptions = { quality: PHOTO_QUALITY, stripMetadata: true };

const pdfjsFiles = () => Object.values(engines.pdfjs.files);
const asset = (file: { url: string; bytes: number }) => ({ url: file.url, bytes: file.bytes });

/** What goes on the page, as bytes pdf-lib can embed without touching the pixels. */
async function pageImage(source: SourceFile, onProgress: OnProgress, signal: AbortSignal): Promise<AddRequest> {
  if (source.format === 'jpg') {
    const bytes = await source.file.arrayBuffer();
    const upright = await host.call<ArrayBuffer | null>('uprightJpeg', bytes, { transfer: [bytes], signal });
    if (upright) return { bytes: upright, kind: 'jpg' };
  }
  const kind = DRAWN.has(source.format) ? 'png' : 'jpg';
  const loading: OnProgress = (progress) => { if (progress.stage === 'loading') onProgress(progress); };
  const { blob } = await imageEngine.convert(source, kind, IMAGE_OPTIONS, loading, signal);
  return { bytes: await blob.arrayBuffer(), kind };
}

function pageName(stem: string, page: number, total: number, extension: string) {
  return `${stem}-${String(page).padStart(String(total).length, '0')}.${extension}`;
}

async function render(source: SourceFile, target: FormatId, options: ConvertOptions, onProgress: OnProgress, signal: AbortSignal): Promise<ConvertResult> {
  const pages = options.pages?.trim() ? parsePages(options.pages) ?? undefined : undefined;
  const files = engines.pdfjs.files;
  const request: RenderRequest = {
    file: source.file,
    type: target === 'png' ? 'image/png' : 'image/jpeg',
    quality: options.quality / 100,
    ...(pages ? { pages } : {}),
    pdfjs: {
      library: files['pdf.mjs']!.url,
      worker: files['pdf.worker.mjs']!.url,
      wasm: {
        'openjpeg.wasm': files['openjpeg.wasm']!.url,
        'jbig2.wasm': files['jbig2.wasm']!.url,
        'qcms_bg.wasm': files['qcms_bg.wasm']!.url,
      },
      data: asset(files['data.pack']!),
      files: pdfjsFiles().map(asset),
    },
  };
  const reply = await host.call<RenderReply>('render', request, { onProgress, signal });
  const stem = source.file.name.replace(/\.[^.]+$/, '') || 'file';
  const extension = FORMATS[target].extension;
  const parts: OutputPart[] = reply.pages.map(({ page, blob }) => ({ name: pageName(stem, page, reply.total, extension), blob }));
  const first = reply.pages[0]!;
  return { blob: first.blob, path: `pdfjs:${reply.pages.length}`, ...(parts.length > 1 ? { parts } : {}) };
}

export const pdfEngine: Engine = {
  id: 'pdf',

  async probe() {
    if (!platform.wasm) return { available: false, reason: "This browser can't run WebAssembly." };
    if (!platform.offscreenCanvas) return { available: false, reason: "This browser can't draw PDF pages off-screen. Update it, then try again." };
    return { available: true };
  },

  targets(input) {
    if (input === 'pdf') return ['png', 'jpg'];
    return IMAGES.has(input) ? ['pdf'] : [];
  },

  async downloadSize(input, target) {
    if (input === 'pdf') return uncachedBytes(pdfjsFiles());
    const library = await uncachedBytes([engines.pdflib.files['pdf-lib.mjs']!]);
    return library + (input === 'jpg' ? 0 : await imageEngine.downloadSize(input, DRAWN.has(input) ? 'png' : target === 'pdf' ? 'jpg' : target));
  },

  convert(source, target, options, onProgress, signal) {
    if (source.format === 'pdf') return render(source, target, options, onProgress, signal);
    return this.merge!([source], target, options, onProgress, signal);
  },

  /** Images in, one PDF out: a page per image, in the order they came. */
  async merge(sources, _target, options, onProgress, signal) {
    if (sources.some(({ format }) => format !== 'jpg')) {
      const probe = await probeEngine(imageEngine);
      if (!probe.available) throw new RebakeError('unsupported', probe.reason ?? "This browser can't read these images.");
    }
    const library = engines.pdflib.files['pdf-lib.mjs']!;
    const start: StartRequest = { library: asset(library), pageSize: options.pageSize ?? 'a4' };
    await host.call('start', start, { onProgress, signal });
    for (const [index, source] of sources.entries()) {
      const { bytes, kind } = await pageImage(source, onProgress, signal);
      await host.call('add', { bytes, kind } satisfies AddRequest, { transfer: [bytes], signal });
      onProgress({ stage: 'converting', fraction: (index + 1) / sources.length });
    }
    const { output } = await host.call<FinishReply>('finish', null, { signal });
    return { blob: new Blob([output], { type: 'application/pdf' }), path: `pdf-lib:${sources.length}` };
  },
};

