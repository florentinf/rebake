/**
 * Where a long job writes its output, so memory stays flat. Runs in workers.
 * A chosen file on disk wins. Otherwise the origin-private file system holds
 * the bytes, which also works where the File System Access picker doesn't.
 * The `File` these return is backed by disk: passing it around copies nothing.
 */
export interface OutputChunk {
  type: 'write';
  data: Uint8Array<ArrayBuffer>;
  position: number;
}

export interface OutputFile {
  writable: WritableStream<OutputChunk>;
  /** Call after `writable` has closed. */
  finish(): Promise<File>;
}

interface SyncAccess {
  write(data: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}

type SpoolHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccess> };

const SPOOL_ROOT = 'rebake-spool';

/** The app's temp files live under one per-tab folder. See `core/output.ts` for clearing it. */
export async function spoolFolder(tab: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const spool = await root.getDirectoryHandle(SPOOL_ROOT, { create: true });
  return spool.getDirectoryHandle(tab, { create: true });
}

export const spoolRoot = async () => {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(SPOOL_ROOT, { create: true });
};

async function openSpool(tab: string, name: string): Promise<OutputFile> {
  const folder = await spoolFolder(tab);
  const handle = await folder.getFileHandle(`${crypto.randomUUID()}-${name}`, { create: true }) as SpoolHandle;
  const access = await handle.createSyncAccessHandle();
  const writable = new WritableStream<OutputChunk>({
    write({ data, position }) { access.write(data, { at: position }); },
    close() { access.flush(); access.close(); },
    abort() { access.close(); },
  });
  return { writable, finish: () => handle.getFile() };
}

async function openDestination(handle: FileSystemFileHandle): Promise<OutputFile> {
  const writable = await handle.createWritable() as unknown as WritableStream<OutputChunk>;
  return { writable, finish: () => handle.getFile() };
}

/** Null means neither is available here, and the caller holds the output in memory. */
export async function openOutput(
  destination: FileSystemFileHandle | undefined,
  tab: string,
  name: string,
): Promise<OutputFile | null> {
  if (destination) return openDestination(destination);
  try {
    return await openSpool(tab, name);
  } catch {
    return null;
  }
}
