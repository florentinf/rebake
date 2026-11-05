import type { Engine, EngineProbe } from './engine';

/** Browser features shared across engines. Read once at startup. */
export const platform = {
  wasm: typeof WebAssembly === 'object',
  /** SharedArrayBuffer needs the COOP/COEP headers. */
  threads: typeof SharedArrayBuffer === 'function' && self.crossOriginIsolated === true,
  offscreenCanvas: typeof OffscreenCanvas === 'function',
  streamToDisk: 'showSaveFilePicker' in self,
};

const probes = new Map<string, Promise<EngineProbe>>();

/** First call per engine runs its probe; later calls reuse the answer. */
export function probeEngine(engine: Engine): Promise<EngineProbe> {
  let probe = probes.get(engine.id);
  if (!probe) {
    probe = engine.probe();
    probes.set(engine.id, probe);
  }
  return probe;
}

/** True where a download deserves a heads-up. iOS and Firefox don't report the connection, so a phone counts. */
export const onMobile = () => onMeteredConnection() || matchMedia('(pointer: coarse)').matches;

/** True on connections known to be slow or paid for. */
export function onMeteredConnection(): boolean {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; type?: string; effectiveType?: string };
  }).connection;
  if (!connection) return false;
  return connection.saveData === true || connection.type === 'cellular' || /2g|3g/.test(connection.effectiveType ?? '');
}
