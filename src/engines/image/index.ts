import engines from 'virtual:engines';
import { platform } from '../../core/capabilities';
import type { ConvertOptions, ConvertResult, Engine, OnProgress, SourceFile } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import { uncachedBytes } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { WorkerHost } from '../../core/worker-host';
import { imageInfo } from '../../core/image-info';
import type { ConvertReply, ConvertRequest, InitRequest, VipsModule } from './protocol';

const host = new WorkerHost(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rebake-image' }),
);

/** HEIC needs an encoder only x265 provides (GPL), and SVG can't be derived from pixels. */
const WRITABLE: FormatId[] = ['jpg', 'png', 'webp', 'avif', 'jxl', 'tiff', 'gif', 'ico'];

/**
 * A job's pixels are freed when the GC reaches its vips handles, and a busy batch
 * never gives it a reason to, because it can't see WebAssembly memory. A new worker
 * is how that memory comes back, well before the heap runs out at around 1.4 GB.
 */
const MAX_HELD_BYTES = 256 * 1024 ** 2;

let loaded: { generation: number; modules: Set<VipsModule> } | null = null;

/** vips side-modules are fixed at startup, so each job loads only what it touches. */
function modulesFor(input: FormatId, target: FormatId): VipsModule[] {
  const modules: VipsModule[] = [];
  if (input === 'avif' || target === 'avif') modules.push('vips-heif.wasm');
  if (input === 'jxl' || target === 'jxl') modules.push('vips-jxl.wasm');
  if (input === 'svg') modules.push('vips-resvg.wasm');
  return modules;
}

const vipsFile = (name: string) => engines.vips.files[name]!;
const libheifFile = () => engines.libheif.files['libheif-bundle.mjs']!;

async function ensureLoaded(needed: VipsModule[], onProgress: OnProgress, signal: AbortSignal) {
  const fresh = loaded?.generation === host.generation;
  if (fresh && needed.every((module) => loaded!.modules.has(module))) return;

  // Keep what this worker already had: a restart shouldn't lose it for the next job.
  const modules = new Set<VipsModule>(fresh ? loaded!.modules : []);
  for (const module of needed) modules.add(module);
  if (fresh) host.discard();

  const list = [...modules];
  const names = ['vips-es6.js', 'vips.wasm', ...list];
  const request: InitRequest = {
    vipsUrl: vipsFile('vips-es6.js').url,
    files: names.map(vipsFile),
    locate: Object.fromEntries(names.map((name) => [name, vipsFile(name).url])),
    modules: list,
  };
  await host.call('init', request, { onProgress, signal });
  loaded = { generation: host.generation, modules };
}

export const imageEngine: Engine = {
  id: 'image',

  async probe() {
    if (!platform.wasm) return { available: false, reason: "This browser can't run WebAssembly." };
    if (!platform.threads) return { available: false, reason: "This browser can't run the converter: no shared memory." };
    return { available: true };
  },

  targets() {
    return WRITABLE;
  },

  async inspect(source) {
    return { targets: [...WRITABLE, 'pdf'], image: await imageInfo(source) };
  },

  downloadSize(input, target) {
    const files = ['vips-es6.js', 'vips.wasm', ...modulesFor(input, target)].map(vipsFile);
    return uncachedBytes(input === 'heic' ? [...files, libheifFile()] : files);
  },

  async convert(source: SourceFile, target: FormatId, options: ConvertOptions, onProgress: OnProgress, signal: AbortSignal): Promise<ConvertResult> {
    await ensureLoaded(modulesFor(source.format, target), onProgress, signal);
    const buffer = await source.file.arrayBuffer();
    const request: ConvertRequest = {
      buffer,
      input: source.format,
      target,
      options,
      libheif: libheifFile(),
    };
    let reply: ConvertReply;
    try {
      reply = await host.call<ConvertReply>('convert', request, { transfer: [buffer], onProgress, signal });
    } catch (error) {
      // vips reports running out of memory the same way as a bad file, and a worker
      // in that state fails every job after it, so the next one starts clean.
      host.discard();
      throw error;
    }
    if (reply.held > MAX_HELD_BYTES) host.discard();
    if (!reply.output.byteLength) throw new RebakeError('mismatch', 'The result was empty, so it was discarded.');
    return { blob: new Blob([reply.output], { type: FORMATS[target].mime }), path: reply.path, ...(reply.note ? { note: reply.note } : {}) };
  },
};
