import { platform } from './capabilities';
import { RebakeError } from './errors';
import { spoolRoot } from './spool';
import { WorkerHost } from './worker-host';
import type { ZipRequest } from './zip-worker';

export interface OutputFile {
  blob: Blob;
  name: string;
}

/**
 * Where a finished file goes. `BlobDownload` hands it to the browser. `SavedFile`
 * is for output already streamed to the file the visitor chose.
 */
export interface OutputSink {
  /** Delivers the file. May be called again to re-save. */
  deliver(file: OutputFile): void;
  /** Frees whatever the sink is holding. */
  dispose(): void;
}

class BlobDownload implements OutputSink {
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
class SavedFile implements OutputSink {
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

export const chooseSink = (destination: FileSystemFileHandle | null): OutputSink =>
  destination ? new SavedFile() : new BlobDownload();

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
    for await (const tab of root.keys()) {
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
  onProgress: (fraction: number | null) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const request: ZipRequest = { files, name, tab: spoolTab };
  const reply = await zipHost.call<{ blob: Blob }>('zip', request, {
    signal,
    onProgress: ({ fraction }) => onProgress(fraction),
  });
  return reply.blob;
}

/** A file's name without its extension. */
export const fileStem = (name: string) => name.replace(/\.[^.]+$/, '') || 'file';

export const outputName = (inputName: string, extension: string) => `${fileStem(inputName)}.${extension}`;
