// A same-origin take on pandoc's own wasm/pandoc.js (MIT, Tweag I/O and John
// MacFarlane). That file imports its WASI shim from a CDN and runs at import
// time; this one compiles once and gives every job a fresh instance, so one bad
// document can't leave state behind. It also measures the options in UTF-8 bytes.
import { File as WasiFile, OpenFile, PreopenDirectory, ConsoleStdout, WASI } from '@bjorn3/browser_wasi_shim';

export interface PandocWarning {
  type: string;
  [key: string]: unknown;
}

export interface PandocResult {
  stderr: string;
  warnings: PandocWarning[];
  files: Record<string, Uint8Array>;
}

interface PandocExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  __wasm_call_ctors(): void;
  hs_init_with_rtsopts(argc: number, argv: number): void;
  convert(options: number, length: number): void;
}

const ARGS = ['pandoc.wasm', '+RTS', '-H64m', '-RTS'];

function writeBytes(exports: PandocExports, bytes: Uint8Array) {
  const pointer = exports.malloc(bytes.length + 1);
  const memory = new Uint8Array(exports.memory.buffer);
  memory.set(bytes, pointer);
  memory[pointer + bytes.length] = 0;
  return pointer;
}

function boot(exports: PandocExports) {
  exports.__wasm_call_ctors();
  const encoder = new TextEncoder();
  const argv = exports.malloc(4 * (ARGS.length + 1));
  ARGS.forEach((arg, i) => {
    const pointer = writeBytes(exports, encoder.encode(arg));
    new DataView(exports.memory.buffer).setUint32(argv + 4 * i, pointer, true);
  });
  const view = () => new DataView(exports.memory.buffer);
  view().setUint32(argv + 4 * ARGS.length, 0, true);
  const argcPointer = exports.malloc(4);
  view().setUint32(argcPointer, ARGS.length, true);
  const argvPointer = exports.malloc(4);
  view().setUint32(argvPointer, argv, true);
  exports.hs_init_with_rtsopts(argcPointer, argvPointer);
}

/** Runs pandoc once. `outputs` names files it should find empty and may fill. */
export async function runPandoc(
  module: WebAssembly.Module,
  options: Record<string, unknown>,
  inputs: Record<string, Uint8Array>,
  outputs: string[],
): Promise<PandocResult> {
  const fileSystem = new Map<string, WasiFile>();
  for (const name of ['stdin', 'stdout', 'stderr', 'warnings']) {
    fileSystem.set(name, new WasiFile(new Uint8Array(), { readonly: name === 'stdin' }));
  }
  for (const [name, bytes] of Object.entries(inputs)) fileSystem.set(name, new WasiFile(bytes, { readonly: true }));
  for (const name of outputs) fileSystem.set(name, new WasiFile(new Uint8Array(), { readonly: false }));

  const silent = ConsoleStdout.lineBuffered(() => {});
  const wasi = new WASI(ARGS, [], [
    new OpenFile(new WasiFile(new Uint8Array(), { readonly: true })),
    silent,
    silent,
    new PreopenDirectory('/', fileSystem as never),
  ], { debug: false });

  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport as WebAssembly.ModuleImports });
  wasi.initialize(instance as never);
  const exports = instance.exports as unknown as PandocExports;
  boot(exports);

  const encoded = new TextEncoder().encode(JSON.stringify(options));
  exports.convert(writeBytes(exports, encoded), encoded.length);

  const text = (name: string) => new TextDecoder().decode(fileSystem.get(name)!.data);
  const warnings = text('warnings');
  return {
    stderr: text('stderr'),
    warnings: warnings ? (JSON.parse(warnings) as PandocWarning[]) : [],
    files: Object.fromEntries(outputs.map((name) => [name, (fileSystem.get(name) as WasiFile).data])),
  };
}
