import type { Progress } from './engine';
import { RebakeError } from './errors';

export interface HandlerContext {
  progress(progress: Progress): void;
}

/** A handler may hand back `{ value, transfer }` to move buffers instead of copying. */
export class Transfer<T> {
  constructor(public value: T, public transfer: Transferable[]) {}
}

type Handler = (payload: never, context: HandlerContext) => unknown;

/** Worker-side counterpart of WorkerHost. */
export function serve(handlers: Record<string, Handler>) {
  const scope = self as unknown as {
    onmessage: (event: MessageEvent<{ id: number; method: string; payload: never }>) => void;
    postMessage(message: unknown, transfer?: Transferable[]): void;
  };

  scope.onmessage = async ({ data }) => {
    const { id, method, payload } = data;
    const context: HandlerContext = {
      progress: (progress) => scope.postMessage({ id, kind: 'progress', progress }),
    };
    try {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unknown method ${method}`);
      const result = await handler(payload, context);
      if (result instanceof Transfer) {
        scope.postMessage({ id, kind: 'result', result: result.value }, result.transfer);
      } else {
        scope.postMessage({ id, kind: 'result', result });
      }
    } catch (error) {
      scope.postMessage({ id, kind: 'error', ...describe(error) });
    }
  };
}

function describe(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (error instanceof RebakeError) return { code: error.code, message: text, fatal: false };
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return { code: 'space' as const, message: text, fatal: false };
  }
  if (/out of memory|cannot enlarge memory|allocation failed|memory access out of bounds/i.test(text)) {
    return { code: 'memory' as const, message: text, fatal: true };
  }
  // An aborted WASM instance can't be reused.
  if (error instanceof WebAssembly.RuntimeError) return { code: 'crashed' as const, message: text, fatal: true };
  return { code: 'corrupt' as const, message: text, fatal: false };
}
