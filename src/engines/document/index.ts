import engines from 'virtual:engines';
import { platform } from '../../core/capabilities';
import type { ConvertOptions, ConvertResult, Engine, OnProgress, OutputPart, SourceFile } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import { uncachedBytes } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { WorkerHost } from '../../core/worker-host';
import { imageEngine } from '../image';
import { fileStem } from '../../core/output';
import { UNUSABLE_IMAGE, type ConvertReply, type ConvertRequest, type FinishPdfRequest, type TiffReply } from './protocol';

const host = new WorkerHost(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rebake-document' }),
);

const TARGETS: FormatId[] = ['md', 'html', 'docx', 'odt', 'epub', 'rtf', 'tex', 'pdf'];
const pandocFile = () => engines.pandoc.files['pandoc.wasm']!;
const fontFiles = () => Object.values(engines.fonts.files);

async function tiffsToPng(tiffs: TiffReply['tiffs'], onProgress: OnProgress, signal: AbortSignal) {
  const loading: OnProgress = (progress) => { if (progress.stage === 'loading') onProgress(progress); };
  const pngs: FinishPdfRequest['pngs'] = {};
  for (const [name, bytes] of Object.entries(tiffs)) {
    const file = new File([bytes], name.split('/').pop()!, { type: 'image/tiff' });
    try {
      const { blob } = await imageEngine.convert({ file, format: 'tiff' }, 'png', { quality: 100, stripMetadata: true }, loading, signal);
      pngs[name] = new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      if (error instanceof RebakeError && ['cancelled', 'offline', 'download', 'updated'].includes(error.code)) throw error;
      throw new RebakeError('unsupported', UNUSABLE_IMAGE);
    }
  }
  return pngs;
}

export const documentEngine: Engine = {
  id: 'document',

  async probe() {
    return platform.wasm ? { available: true } : { available: false, reason: "This browser can't run WebAssembly." };
  },

  targets(input) {
    return TARGETS.filter((target) => target !== input);
  },

  async downloadSize(_input, target) {
    const files = [pandocFile()];
    if (target === 'pdf') files.push(...Object.values(engines.typst.files), ...fontFiles());
    return uncachedBytes(files);
  },

  async convert(source: SourceFile, target: FormatId, options: ConvertOptions, onProgress: OnProgress, signal: AbortSignal): Promise<ConvertResult> {
    const request: ConvertRequest = {
      file: source.file,
      input: source.format,
      target,
      pageSize: options.pageSize ?? 'a4',
      pandoc: pandocFile(),
      typst: {
        glue: engines.typst.files['typst.mjs']!.url,
        wasm: engines.typst.files['typst.wasm']!,
        fonts: fontFiles(),
      },
    };
    const first = await host.call<ConvertReply | TiffReply>('convert', request, { onProgress, signal });
    const reply = 'tiffs' in first
      ? await host.call<ConvertReply>('finishPdf', { pngs: await tiffsToPng(first.tiffs, onProgress, signal) } satisfies FinishPdfRequest, { onProgress, signal })
      : first;
    const blob = reply.output.slice(0, reply.output.size, FORMATS[target].mime);
    const parts: OutputPart[] | undefined = reply.media?.length
      ? [{ name: `${fileStem(source.file.name)}.${FORMATS[target].extension}`, blob }, ...reply.media]
      : undefined;
    const note = reply.lost ? `${reply.lost} ${reply.lost === 1 ? 'image or link' : 'images or links'} couldn't be carried over.` : undefined;
    return { blob, path: reply.path, ...(parts ? { parts } : {}), ...(note ? { note } : {}) };
  },
};
