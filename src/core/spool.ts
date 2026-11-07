/**
 * Where a long job writes its output, so memory stays flat. Runs in workers.
 * The origin-private file system stages the bytes, including when the visitor
 * chose a destination: only a verified result is committed to that destination.
 * The `File` these return is backed by disk, so passing it around copies nothing.
 */

/** Above this, an output goes straight to disk where the browser allows it. */
export const LARGE_FILE_BYTES = 100e6;

export interface SpoolChunk {
  type: 'write';
  data: Uint8Array<ArrayBuffer>;
  position: number;
}

/** In workers only, so it's missing from the DOM types. */
interface SyncAccess {
  write(data: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}

type SpoolHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccess> };

export interface SpoolFile {
  writable: WritableStream<SpoolChunk>;
  /** Call after `writable` has closed. */
  finish(): Promise<File>;
}

/** The temp files of all tabs. See `core/output.ts` for clearing it. */
export const spoolRoot = async () => {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('rebake-spool', { create: true });
};

/** Null when private storage is unavailable, and the caller holds the output in memory. */
export async function openSpool(tab: string, name: string): Promise<SpoolFile | null> {
  try {
    const folder = await (await spoolRoot()).getDirectoryHandle(tab, { create: true });
    const handle = await folder.getFileHandle(`${crypto.randomUUID()}-${name}`, { create: true }) as SpoolHandle;
    const access = await handle.createSyncAccessHandle();
    const writable = new WritableStream<SpoolChunk>({
      write({ data, position }) {
        let offset = 0;
        while (offset < data.byteLength) {
          const written = access.write(data.subarray(offset), { at: position + offset });
          if (written <= 0) throw new DOMException('The temporary file could not be written.', 'QuotaExceededError');
          offset += written;
        }
      },
      close() { try { access.flush(); } finally { access.close(); } },
      abort() { access.close(); },
    });
    return { writable, finish: () => handle.getFile() };
  } catch {
    return null;
  }
}
