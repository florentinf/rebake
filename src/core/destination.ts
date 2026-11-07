import { RebakeError } from './errors';

/** Commit a verified result. Failed/cancelled writes never delete an existing destination. */
export async function commitDestination(handle: FileSystemFileHandle, blob: Blob, signal: AbortSignal, onProgress: (fraction: number) => void) {
  signal.throwIfAborted();
  let stream: FileSystemWritableFileStream | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  let committing = false;
  const abort = () => { if (!committing) void stream?.abort().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    stream = await handle.createWritable();
    reader = blob.stream().getReader();
    let written = 0;
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      await stream.write(value);
      written += value.byteLength;
      onProgress(blob.size ? written / blob.size : 1);
    }
    signal.throwIfAborted();
    // close() is the atomic commit. Cancellation after this point must not delete it.
    committing = true;
    await stream.close();
  } catch (error) {
    await stream?.abort().catch(() => {});
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new RebakeError('space', 'Not enough free disk space for this file.');
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new RebakeError('unsupported', 'The destination is no longer writable. Choose another location, then try again.');
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

