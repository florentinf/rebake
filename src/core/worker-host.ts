import type { Progress } from './engine';
import { RebakeError, type ErrorCode } from './errors';

export interface CallOptions {
  transfer?: Transferable[];
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
}

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  onProgress?: (progress: Progress) => void;
}

type WorkerMessage =
  | { id: number; kind: 'progress'; progress: Progress }
  | { id: number; kind: 'result'; result: unknown }
  | { id: number; kind: 'error'; code: ErrorCode; message: string; fatal: boolean };

/**
 * Owns one engine's Worker. A worker that dies, or is killed to cancel a job,
 * rejects what was in flight and is replaced lazily on the next call, so the
 * page never goes down with it. `generation` lets engines notice the restart.
 */
export class WorkerHost {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  /** Bumps whenever a worker is lost, so engines know their loaded state went with it. */
  generation = 0;

  constructor(private spawn: () => Worker) {}

  call<T>(method: string, payload: unknown, options: CallOptions = {}): Promise<T> {
    const { transfer = [], onProgress, signal } = options;
    if (signal?.aborted) return Promise.reject(new RebakeError('cancelled', 'Cancelled.'));
    const worker = this.ensure();
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        // WASM can't be interrupted mid-call. Killing the worker always works.
        this.discard(new RebakeError('cancelled', 'Cancelled.'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const done = () => signal?.removeEventListener('abort', onAbort);
      this.pending.set(id, {
        resolve: (value) => { done(); resolve(value as T); },
        reject: (reason) => { done(); reject(reason); },
        onProgress,
      });
      worker.postMessage({ id, method, payload }, transfer);
    });
  }

  /** Replaces the worker on the next call. In-flight calls reject with `reason`. */
  discard(reason = new RebakeError('crashed', 'Engine restarted.')) {
    if (this.worker) this.generation++;
    this.worker?.terminate();
    this.worker = null;
    const inFlight = [...this.pending.values()];
    this.pending.clear();
    for (const call of inFlight) call.reject(reason);
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = this.spawn();
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.receive(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      if (worker === this.worker) this.discard(new RebakeError('crashed', event.message || 'Worker crashed.'));
    };
    worker.onmessageerror = () => {
      if (worker === this.worker) this.discard(new RebakeError('crashed', 'Worker sent an unreadable message.'));
    };
    this.worker = worker;
    return worker;
  }

  private receive(message: WorkerMessage) {
    const call = this.pending.get(message.id);
    if (!call) return;
    if (message.kind === 'progress') {
      call.onProgress?.(message.progress);
      return;
    }
    this.pending.delete(message.id);
    if (message.kind === 'result') {
      call.resolve(message.result);
    } else {
      call.reject(new RebakeError(message.code, message.message));
      if (message.fatal) this.discard();
    }
  }
}
