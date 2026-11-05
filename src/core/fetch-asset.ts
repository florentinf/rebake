import type { Progress } from './engine';
import { RebakeError } from './errors';

export interface AssetFile {
  url: string;
  bytes: number;
}

/** Fetches engine files, reporting bytes received across all of them. */
export async function fetchAssets(files: AssetFile[], progress: (progress: Progress) => void): Promise<Uint8Array<ArrayBuffer>[]> {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  let received = 0;
  return Promise.all(files.map(async ({ url, bytes }) => {
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new RebakeError('offline', 'engine not cached');
    }
    if (!response.ok || !response.body) throw new RebakeError('offline', 'engine not cached');
    const reader = response.body.getReader();
    const output = new Uint8Array(bytes);
    let position = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      output.set(value, position);
      position += value.length;
      received += value.length;
      progress({ stage: 'loading', fraction: Math.min(received / total, 1) });
    }
    return output;
  }));
}

/** Bytes of `files` still to come over the network. */
export async function uncachedBytes(files: { url: string; brotli: number }[]): Promise<number> {
  let total = 0;
  for (const file of files) if (!(await caches.match(file.url))) total += file.brotli;
  return total;
}
