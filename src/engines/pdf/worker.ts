import { RebakeError } from '../../core/errors';
import { fetchAssets } from '../../core/fetch-asset';
import { serve, Transfer, type HandlerContext } from '../../core/worker-runtime';
import { jpegOrientation, stripJpeg } from '../../core/jpeg';
import { backgroundRgb, pdfSize } from '../../core/rendering';
import type { AddRequest, FinishReply, RenderReply, RenderRequest, RenderedPage, StartRequest } from './protocol';

type Pdfjs = typeof import('pdfjs-dist');
type PdfLib = typeof import('pdf-lib');

const PAGE_POINTS = { a4: [595.28, 841.89], letter: [612, 792] } as const;

let pdfjs: Pdfjs | undefined;
let pack: { index: Record<string, [number, number]>; bytes: Uint8Array<ArrayBuffer>; start: number } | undefined;
let wasmUrls: Record<string, string> = {};

/** One file holds pdf.js's CMaps and fonts, and the wasm keeps its own URLs. */
class PackedData {
  async fetch({ kind, filename }: { kind: 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'; filename: string }) {
    if (kind === 'wasmUrl') {
      const response = await fetch(wasmUrls[filename]!);
      return new Uint8Array(await response.arrayBuffer());
    }
    const folder = kind === 'cMapUrl' ? 'cmaps' : 'standard_fonts';
    const entry = pack!.index[`${folder}/${filename}`];
    if (!entry) throw new Error(`pdf.js asked for ${filename}, which isn't packed`);
    return pack!.bytes.slice(pack!.start + entry[0], pack!.start + entry[0] + entry[1]);
  }
}

class OffscreenFactory {
  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext('2d')! };
  }
  reset(entry: { canvas: OffscreenCanvas }, width: number, height: number) {
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  getNoAlphaContext(canvas: OffscreenCanvas) {
    return canvas.getContext('2d', { alpha: false });
  }
  destroy(entry: { canvas: OffscreenCanvas }) {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
  }
}

async function loadPdfjs({ pdfjs: files }: RenderRequest, context: HandlerContext) {
  if (pdfjs) return pdfjs;
  // Every file is fetched now, so the service worker holds all of it from here on.
  const fetched = await fetchAssets(files.files, context.progress);
  const bytes = fetched[files.files.findIndex(({ url }) => url === files.data.url)]!;
  const length = new DataView(bytes.buffer).getUint32(0, true);
  const index = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as NonNullable<typeof pack>['index'];
  pack = { index, bytes, start: 4 + length };
  wasmUrls = files.wasm;
  // pdf.js's "worker" runs in this thread: this already is the worker.
  (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = await import(/* @vite-ignore */ files.worker);
  pdfjs = (await import(/* @vite-ignore */ files.library)) as Pdfjs;
  return pdfjs;
}

function loadError(error: unknown): RebakeError {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'PasswordException') return new RebakeError('locked', 'password');
  return new RebakeError('corrupt', error instanceof Error ? error.message : String(error));
}

async function render(request: RenderRequest, context: HandlerContext) {
  const library = await loadPdfjs(request, context);
  const data = new Uint8Array(await request.file.arrayBuffer());
  const task = library.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableWorkerRendering: true,
    BinaryDataFactory: PackedData,
    CanvasFactory: OffscreenFactory,
    cMapPacked: true,
    verbosity: 0,
  } as unknown as Parameters<Pdfjs['getDocument']>[0]);
  try {
    const document = await task.promise.catch((error: unknown) => { throw loadError(error); });
    const total = document.numPages;
    const wanted = request.pages ?? Array.from({ length: total }, (_, i) => i + 1);
    const past = wanted.find((page) => page > total);
    if (past) {
      throw new RebakeError('unsupported', `This PDF has ${total} ${total === 1 ? 'page' : 'pages'}, so there's no page ${past}.`);
    }

    const pages: RenderedPage[] = [];
    let capped = 0;
    for (const [index, number] of wanted.entries()) {
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const size = pdfSize(base.width, base.height, request.dpi);
      if (size.capped) capped++;
      const viewport = page.getViewport({ scale: size.scale });
      const canvas = new OffscreenCanvas(size.width, size.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: request.transparent ? 'rgba(0, 0, 0, 0)' : request.background } as Parameters<typeof page.render>[0]).promise;
      pages.push({ page: number, blob: await canvas.convertToBlob({ type: request.type, quality: request.quality }) });
      page.cleanup();
      context.progress({ stage: 'converting', fraction: (index + 1) / wanted.length });
    }
    return { pages, total, ...(capped ? { note: `${capped} ${capped === 1 ? 'page was' : 'pages were'} rendered below ${request.dpi} DPI to stay within the 16-million-pixel limit.` } : {}) } satisfies RenderReply;
  } finally { await task.destroy(); }
}

let builder: { document: Awaited<ReturnType<PdfLib['PDFDocument']['create']>>; size: readonly [number, number]; background: string; rgb: PdfLib['rgb'] } | undefined;

async function start({ library, pageSize, background }: StartRequest, context: HandlerContext) {
  await fetchAssets([library], context.progress);
  const { PDFDocument, rgb } = (await import(/* @vite-ignore */ library.url)) as PdfLib;
  const document = await PDFDocument.create();
  document.setCreator('rebake');
  document.setProducer('rebake');
  builder = { document, size: PAGE_POINTS[pageSize], background, rgb };
}

/** The JPEG minus its metadata, or null when it needs rotating and has to be re-encoded. */
function uprightJpeg({ bytes: buffer, strip }: { bytes: ArrayBuffer; strip: boolean }) {
  const bytes = new Uint8Array(buffer);
  if (jpegOrientation(bytes) !== 1) return null;
  const output = strip ? stripJpeg(bytes).buffer : buffer;
  return new Transfer(output, [output]);
}

async function add({ bytes, kind }: AddRequest) {
  const { document, size } = builder!;
  const image = kind === 'jpg' ? await document.embedJpg(bytes) : await document.embedPng(bytes);
  // The page turns to suit the image, then the image fills it edge to edge where it can.
  const wide = image.width > image.height;
  const [width, height] = wide ? [size[1], size[0]] : size;
  const scale = Math.min(width / image.width, height / image.height);
  const drawn = { width: image.width * scale, height: image.height * scale };
  const page = document.addPage([width, height]);
  const [r, g, b] = backgroundRgb(builder!.background).map((v) => v / 255);
  page.drawRectangle({ x: 0, y: 0, width, height, color: builder!.rgb(r!, g!, b!) });
  page.drawImage(image, {
    x: (width - drawn.width) / 2,
    y: (height - drawn.height) / 2,
    ...drawn,
  });
}

async function finish() {
  const saved = await builder!.document.save();
  builder = undefined;
  const output = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;
  return new Transfer<FinishReply>({ output }, [output]);
}

serve({ render, start, uprightJpeg, add, finish });
