import engines from 'virtual:engines';
import { platform, probeEngine } from '../../core/capabilities';
import type { ConvertOptions, ConvertResult, Engine, OnProgress, OutputPart, SourceFile } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import { uncachedBytes } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { parsePages } from '../../core/pages';
import { WorkerHost } from '../../core/worker-host';
import { imageEngine } from '../image';
import { fileStem } from '../../core/output';
import { DEFAULT_PDF_DPI } from '../../core/rendering';
import type { AddRequest, FinishReply, RenderReply, RenderRequest, StartRequest } from './protocol';

const host = new WorkerHost(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rebake-pdf' }),
);

const IMAGES: ReadonlySet<FormatId> = new Set(['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heic', 'jxl', 'svg', 'ico']);

const pdfjsFiles = () => Object.values(engines.pdfjs.files);

/** What goes on the page, as bytes pdf-lib can embed without touching the pixels. */
async function pageImage(source: SourceFile, options: ConvertOptions, onProgress: OnProgress, signal: AbortSignal): Promise<AddRequest> {
  const policy = options.pdfImageCompression ?? 'preserve';
  if (source.format === 'jpg' && policy === 'preserve' && !options.maxWidth && !options.maxHeight && options.colorSpace !== 'srgb') {
    const bytes = await source.file.arrayBuffer();
    const upright = await host.call<ArrayBuffer | null>('uprightJpeg', { bytes, strip: options.stripMetadata }, { transfer: [bytes], signal });
    if (upright) return { bytes: upright, kind: 'jpg' };
  }
  const kind = policy === 'lossy' ? 'jpg' : 'png';
  const loading: OnProgress = (progress) => { if (progress.stage === 'loading') onProgress(progress); };
  const { blob } = await imageEngine.convert(source, kind, { ...options, animation: 'first', recompress: policy === 'lossy' }, loading, signal);
  return { bytes: await blob.arrayBuffer(), kind };
}

function pageName(stem: string, page: number, total: number, extension: string) {
  return `${stem}-${String(page).padStart(String(total).length, '0')}.${extension}`;
}

async function render(source: SourceFile, target: FormatId, options: ConvertOptions, onProgress: OnProgress, signal: AbortSignal): Promise<ConvertResult> {
  const pages = options.pages?.trim() ? parsePages(options.pages) : undefined;
  if (pages === null) throw new RebakeError('unsupported', 'Use pages like 1-3, 5.');
  const files = engines.pdfjs.files;
  const request: RenderRequest = {
    file: source.file,
    type: target === 'png' ? 'image/png' : 'image/jpeg',
    quality: options.quality / 100,
    dpi: options.pdfDpi ?? DEFAULT_PDF_DPI,
    background: options.background ?? '#ffffff',
    transparent: target === 'png' && options.transparency !== 'flatten',
    ...(pages ? { pages } : {}),
    pdfjs: {
      library: files['pdf.mjs']!.url,
      worker: files['pdf.worker.mjs']!.url,
      wasm: {
        'openjpeg.wasm': files['openjpeg.wasm']!.url,
        'jbig2.wasm': files['jbig2.wasm']!.url,
        'qcms_bg.wasm': files['qcms_bg.wasm']!.url,
      },
      data: files['data.pack']!,
      files: pdfjsFiles(),
    },
  };
  const reply = await host.call<RenderReply>('render', request, { onProgress, signal });
  const stem = fileStem(source.file.name);
  const extension = FORMATS[target].extension;
  const parts: OutputPart[] = reply.pages.map(({ page, blob }) => ({ name: pageName(stem, page, reply.total, extension), blob }));
  const first = reply.pages[0]!;
  return { blob: first.blob, path: `pdfjs:${reply.pages.length}`, ...(parts.length > 1 ? { parts } : {}), ...(reply.note ? { note: reply.note } : {}) };
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

  async downloadSize(input) {
    if (input === 'pdf') return uncachedBytes(pdfjsFiles());
    const library = await uncachedBytes([engines.pdflib.files['pdf-lib.mjs']!]);
    return library + await imageEngine.downloadSize(input, 'png');
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
    const start: StartRequest = { library: engines.pdflib.files['pdf-lib.mjs']!, pageSize: options.pageSize ?? 'a4', background: options.background ?? '#ffffff' };
    await host.call('start', start, { onProgress, signal });
    for (const [index, source] of sources.entries()) {
      const { bytes, kind } = await pageImage(source, options, onProgress, signal);
      await host.call('add', { bytes, kind } satisfies AddRequest, { transfer: [bytes], signal });
      onProgress({ stage: 'converting', fraction: (index + 1) / sources.length });
    }
    const { output } = await host.call<FinishReply>('finish', null, { signal });
    return { blob: new Blob([output], { type: 'application/pdf' }), path: `pdf-lib:${sources.length}` };
  },
};

