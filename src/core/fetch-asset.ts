import type { Progress } from './engine';
import { RebakeError } from './errors';

export interface AssetFile {
  url: string;
  bytes: number;
}

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;

/** Cloudflare caps files at 25 MiB, so the largest engines ship gzipped. See `build/engines.ts`. */
async function unpacked(response: Response, url: string) {
  if (!url.endsWith('.gz')) return response.body!;
  if (typeof DecompressionStream === 'function') return response.body!.pipeThrough(new DecompressionStream('gzip'));
  // Safari before 16.4. No progress here, but the engine still loads.
  const { gunzipSync } = await import('fflate');
  return new Blob([gunzipSync(new Uint8Array(await response.arrayBuffer()))]).stream();
}

async function readOnce({ url, bytes }: AssetFile, onBytes: (count: number) => void) {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new RebakeError('offline', 'engine not cached');
  }
  if (response.status === 404) throw new RebakeError('updated', 'engine replaced by a newer deploy');
  if (!response.ok || !response.body) throw new RebakeError('download', `engine answered ${response.status}`);
  const output = new Uint8Array(bytes);
  let position = 0;
  try {
    const reader = (await unpacked(response, url)).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      output.set(value, position);
      position += value.length;
      onBytes(value.length);
    }
  } catch {
    throw new RebakeError('download', 'engine download interrupted');
  }
  if (position !== bytes) throw new RebakeError('download', 'engine download came up short');
  return output;
}

const worthRetrying = (error: RebakeError) =>
  error.code === 'download' || (error.code === 'offline' && navigator.onLine !== false);

/** A dropped connection starts this file over a moment later, rather than failing the job. */
async function download(file: AssetFile, onBytes: (count: number) => void) {
  for (let attempt = 1; ; attempt++) {
    let received = 0;
    try {
      return await readOnce(file, (count) => { received += count; onBytes(count); });
    } catch (error) {
      onBytes(-received);
      if (!(error instanceof RebakeError) || attempt === ATTEMPTS || !worthRetrying(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}

/** Fetches engine files, reporting bytes received across all of them. */
export async function fetchAssets(files: AssetFile[], progress: (progress: Progress) => void): Promise<Uint8Array<ArrayBuffer>[]> {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  let received = 0;
  let furthest = 0;
  return Promise.all(files.map((file) => download(file, (count) => {
    received += count;
    // A retry rewinds `received`. The bar holds still until the new attempt catches up.
    furthest = Math.max(furthest, Math.min(received / total, 1));
    progress({ stage: 'loading', fraction: furthest });
  })));
}

/** Bytes of `files` still to come over the network. */
export async function uncachedBytes(files: { url: string; wire: number }[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    // Firefox's private windows refuse CacheStorage. Nothing cached, then.
    const cached = await caches.match(file.url).catch(() => undefined);
    if (!cached) total += file.wire;
  }
  return total;
}
