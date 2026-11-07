import engines from 'virtual:engines';
import { platform } from '../../core/capabilities';
import type { ConvertOptions, ConvertResult, Engine, Inspection, OnProgress, SourceFile } from '../../core/engine';
import { uncachedBytes } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { spoolTab } from '../../core/output';
import { WorkerHost } from '../../core/worker-host';
import { encodesNatively } from './encoder-probe';
import type { ConvertReply, ConvertRequest, EncoderPackage, InspectReply, InspectRequest } from './protocol';

const host = new WorkerHost(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rebake-media' }),
);

/** Everything this engine can write. Routes and each file's inspection narrow it. */
const TARGETS: FormatId[] = ['mp4', 'mov', 'webm', 'mkv', 'gif', 'mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav'];

const encoderFile = (pkg: EncoderPackage) => engines[pkg].files[`${pkg}-encoder.mjs`]!;

async function encodersFor(target: FormatId): Promise<EncoderPackage[]> {
  if (target === 'mp3') return ['mp3'];
  if (target === 'flac') return ['flac'];
  const wantsAac = target === 'm4a' || target === 'mp4' || target === 'mov' || target === 'mkv';
  return wantsAac && !(await encodesNatively('aac')) ? ['aac'] : [];
}

export const mediaEngine: Engine = {
  id: 'media',

  // WebCodecs isn't required here: remuxing and extracting work without it, and
  // each file's own inspection decides what's on offer.
  async probe() {
    if (!platform.wasm) return { available: false, reason: "This browser can't run WebAssembly." };
    return { available: true };
  },

  targets() {
    return TARGETS;
  },

  inspect({ file, format }: SourceFile): Promise<Inspection> {
    const request: InspectRequest = { file, input: format, targets: this.targets(format) };
    return host.call<InspectReply>('inspect', request);
  },

  async downloadSize(_input, target) {
    return uncachedBytes((await encodersFor(target)).map(encoderFile));
  },

  async convert(source: SourceFile, target: FormatId, options: ConvertOptions, onProgress: OnProgress, signal: AbortSignal): Promise<ConvertResult> {
    const request: ConvertRequest = {
      file: source.file,
      input: source.format,
      target,
      options,
      tab: spoolTab,
      encoders: { mp3: encoderFile('mp3').url, aac: encoderFile('aac').url, flac: encoderFile('flac').url },
    };
    try {
      const reply = await host.call<ConvertReply>('convert', request, { onProgress, signal });
      const blob = reply.output instanceof Blob
        ? reply.output
        : new Blob([reply.output], { type: FORMATS[target].mime });
      return { blob, path: reply.path };
    } catch (error) {
      // A failed job can leave a file open in the worker. Dropping the worker closes it.
      host.discard();
      throw error;
    }
  },
};
