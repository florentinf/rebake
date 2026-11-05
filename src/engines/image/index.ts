import engines from 'virtual:engines';
import { platform } from '../../core/capabilities';
import type { ConvertOptions, ConvertResult, Engine, OnProgress, SourceFile } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import { FORMATS, type FormatId } from '../../core/formats';
import { WorkerHost } from '../../core/worker-host';
import type { ConvertReply, ConvertRequest, InitRequest, VipsModule } from './protocol';

const host = new WorkerHost(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rebake-image' }),
);

/** HEIC needs an encoder only x265 provides (GPL), and SVG can't be derived from pixels. */
const WRITABLE: FormatId[] = ['jpg', 'png', 'webp', 'avif', 'jxl', 'tiff', 'gif', 'ico'];

let loaded: { generation: number; modules: Set<VipsModule> } | null = null;

/** vips side-modules are fixed at startup, so each job loads only what it touches. */
function modulesFor(input: FormatId, target: FormatId): VipsModule[] {
  const modules: VipsModule[] = [];
  if (input === 'avif' || target === 'avif') modules.push('vips-heif.wasm');
  if (input === 'jxl' || target === 'jxl') modules.push('vips-jxl.wasm');
  if (input === 'svg') modules.push('vips-resvg.wasm');
  return modules;
}

function asset(pkg: 'vips' | 'libheif', name: string) {
  const file = engines[pkg].files[name]!;
  return { url: file.url, bytes: file.bytes };
}

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
    vipsUrl: engines.vips.files['vips-es6.js']!.url,
    files: names.map((name) => asset('vips', name)),
    locate: Object.fromEntries(names.map((name) => [name, engines.vips.files[name]!.url])),
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

  targets(input) {
    return WRITABLE.filter((format) => format !== input);
  },

  async downloadSize(input, target) {
    const files: ['vips' | 'libheif', string][] = ['vips-es6.js', 'vips.wasm', ...modulesFor(input, target)]
      .map((name) => ['vips', name]);
    if (input === 'heic') files.push(['libheif', 'libheif-bundle.mjs']);
    let total = 0;
    for (const [pkg, name] of files) {
      const file = engines[pkg].files[name]!;
      if (!(await caches.match(file.url))) total += file.brotli;
    }
    return total;
  },

  async convert(source: SourceFile, target: FormatId, options: ConvertOptions, onProgress: OnProgress, signal: AbortSignal): Promise<ConvertResult> {
    await ensureLoaded(modulesFor(source.format, target), onProgress, signal);
    const buffer = await source.file.arrayBuffer();
    const request: ConvertRequest = {
      buffer,
      input: source.format,
      target,
      options,
      libheif: asset('libheif', 'libheif-bundle.mjs'),
    };
    const reply = await host.call<ConvertReply>('convert', request, { transfer: [buffer], onProgress, signal });
    if (!reply.output.byteLength) throw new RebakeError('mismatch', 'The result was empty, so it was discarded.');
    return { blob: new Blob([reply.output], { type: FORMATS[target].mime }), path: reply.path };
  },
};
