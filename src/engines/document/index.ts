import engines from 'virtual:engines';
import { platform } from '../../core/capabilities';
import type { ConvertOptions, ConvertResult, Engine, OnProgress, OutputPart, SourceFile } from '../../core/engine';
import { uncachedBytes } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { WorkerHost } from '../../core/worker-host';
import type { ConvertReply, ConvertRequest } from './protocol';

const host = new WorkerHost(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rebake-document' }),
);

const TARGETS: FormatId[] = ['md', 'html', 'docx', 'odt', 'epub', 'rtf', 'tex', 'pdf'];
const pandocFile = () => engines.pandoc.files['pandoc.wasm']!;
const fontFiles = () => Object.values(engines.fonts.files);
const asset = (file: { url: string; bytes: number }) => ({ url: file.url, bytes: file.bytes });

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
      pandoc: asset(pandocFile()),
      typst: {
        glue: engines.typst.files['typst.mjs']!.url,
        wasm: asset(engines.typst.files['typst.wasm']!),
        fonts: fontFiles().map(asset),
      },
    };
    const reply = await host.call<ConvertReply>('convert', request, { onProgress, signal });
    const blob = reply.output.slice(0, reply.output.size, FORMATS[target].mime);
    const stem = source.file.name.replace(/\.[^.]+$/, '') || 'file';
    const parts: OutputPart[] | undefined = reply.media?.length
      ? [{ name: `${stem}.${FORMATS[target].extension}`, blob }, ...reply.media]
      : undefined;
    const note = reply.lost ? `${reply.lost} ${reply.lost === 1 ? 'image or link' : 'images or links'} couldn't be carried over.` : undefined;
    return { blob, path: reply.path, ...(parts ? { parts } : {}), ...(note ? { note } : {}) };
  },
};
