import { platform } from './capabilities';
import { RebakeError } from './errors';
import { spoolRoot } from './spool';
import { WorkerHost } from './worker-host';
import type { ZipRequest } from './zip-worker';

/** Above this, an output goes straight to disk where the browser allows it. */
export const LARGE_FILE_BYTES = 100e6;

/**
 * Where a finished file goes. `BlobDownload` hands it to the browser. `SavedFile`
 * is for output already streamed to the file the visitor chose.
 */
export interface OutputFile {
  blob: Blob;
  name: string;
}

export interface OutputSink {
  /** Delivers the file. May be called again to re-save. */
  deliver(file: OutputFile): void | Promise<void>;
  /** Frees whatever the sink is holding. */
  dispose(): void;
}

export class BlobDownload implements OutputSink {
  private url: string | null = null;
  private blob: Blob | null = null;

  deliver({ blob, name }: OutputFile) {
    if (this.blob !== blob) {
      this.dispose();
      // A typed blob can open inline instead of saving (Firefox does this with AVIF).
      this.url = URL.createObjectURL(blob.slice(0, blob.size, 'application/octet-stream'));
      this.blob = blob;
    }
    const link = document.createElement('a');
    link.href = this.url!;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  }

  dispose() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.blob = null;
  }
}

/** The bytes are already on disk, so the first delivery is a no-op. "Save again" still works. */
export class SavedFile implements OutputSink {
  private delivered = false;
  private download = new BlobDownload();

  deliver(file: OutputFile) {
    if (this.delivered) this.download.deliver(file);
    this.delivered = true;
  }

  dispose() {
    this.download.dispose();
  }
}

export function chooseSink(_file: OutputFile, destination: FileSystemFileHandle | null): OutputSink {
  return destination ? new SavedFile() : new BlobDownload();
}

interface SavePickerWindow {
  showSaveFilePicker(options: {
    suggestedName: string;
    startIn?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle>;
}

/**
 * Asks where a large file should go. Must run inside the click that started the
 * job. Null means this browser can't stream to disk, and dismissing the dialog
 * rejects with `cancelled`.
 */
export async function pickDestination(name: string, mime: string, extension: string): Promise<FileSystemFileHandle | null> {
  if (!platform.streamToDisk) return null;
  try {
    return await (self as unknown as SavePickerWindow).showSaveFilePicker({
      suggestedName: name,
      startIn: 'downloads',
      types: [{ description: extension.toUpperCase(), accept: { [mime]: [`.${extension}`] } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new RebakeError('cancelled', 'Cancelled.');
    }
    return null;
  }
}

/** Removes a file the picker created for a job that then didn't finish. Best effort. */
export async function discardDestination(handle: FileSystemFileHandle | null) {
  try {
    await (handle as unknown as { remove?(): Promise<void> } | null)?.remove?.();
  } catch { /* the browser keeps an empty file; nothing was written to it */ }
}

/** One id per tab. A held Web Lock marks its spool folder as in use. */
export const spoolTab: string = crypto.randomUUID();
const LOCK_PREFIX = 'rebake-spool-';
let spoolLocked = false;

/** Clears this tab's temp files and anything a closed tab left behind. */
export async function clearSpool() {
  try {
    const root = await spoolRoot();
    if (!spoolLocked && navigator.locks) {
      spoolLocked = true;
      void navigator.locks.request(LOCK_PREFIX + spoolTab, () => new Promise(() => {}));
    }
    const held = await navigator.locks?.query();
    const live = new Set((held?.held ?? []).map((lock) => lock.name));
    const entries = (root as unknown as { keys(): AsyncIterable<string> }).keys();
    for await (const tab of entries) {
      if (tab === spoolTab || !live.has(LOCK_PREFIX + tab)) {
        await root.removeEntry(tab, { recursive: true }).catch(() => {});
      }
    }
  } catch { /* no private file system here, so nothing was spooled */ }
}

const zipHost = new WorkerHost(
  () => new Worker(new URL('./zip-worker.ts', import.meta.url), { type: 'module', name: 'rebake-zip' }),
);

/** Builds the batch's ZIP in a worker, so a big one neither blocks the page nor fills memory. */
export async function buildZip(
  files: OutputFile[],
  name: string,
  destination: FileSystemFileHandle | null,
  onProgress: (fraction: number | null) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const request: ZipRequest = { files, name, tab: spoolTab, destination: destination ?? undefined };
  const reply = await zipHost.call<{ blob: Blob }>('zip', request, {
    signal,
    onProgress: ({ fraction }) => onProgress(fraction),
  });
  return reply.blob;
}

export function outputName(inputName: string, extension: string): string {
  const stem = inputName.replace(/\.[^.]+$/, '') || 'file';
  return `${stem}.${extension}`;
}
