import { createServer, request as forward, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

interface Faults {
  /** Bytes per second for engine files. */
  rate?: number;
  /** Drops the connection after 1 MB, this many times. */
  cut?: { path: RegExp; times: number };
  /** Answers with this status instead of the file. */
  block?: { path: RegExp; status: number };
  /** Added to the top of worker scripts. */
  workerPrelude?: string;
  /** Added to the top of sw.js, which makes it a new version. */
  serviceWorkerPrelude?: string;
}

/** Sits in front of the local server and misbehaves on request, service worker included. */
export async function faultyProxy(target: string) {
  const faults: Faults = {};
  const { hostname, port } = new URL(target);

  const relay = (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url!.split('?')[0]!;
    if (faults.block?.path.test(path)) {
      res.writeHead(faults.block.status);
      res.end();
      return;
    }
    const upstream = forward({ hostname, port, path: req.url, method: req.method, headers: req.headers }, (answer) => {
      const prelude = path === '/sw.js' ? faults.serviceWorkerPrelude
        : /^\/assets\/worker-.*\.js$/.test(path) ? faults.workerPrelude : undefined;
      const headers = { ...answer.headers };
      if (prelude) delete headers['content-length'];
      res.writeHead(answer.statusCode!, headers);
      if (prelude) res.write(`${prelude}\n`);
      let sent = 0;
      answer.on('data', (chunk: Buffer) => {
        sent += chunk.length;
        if (faults.cut?.path.test(path) && faults.cut.times > 0 && sent > 1e6) {
          faults.cut.times--;
          res.destroy();
          answer.destroy();
          return;
        }
        res.write(chunk);
        if (faults.rate && path.startsWith('/engines/')) {
          answer.pause();
          setTimeout(() => answer.resume(), (chunk.length / faults.rate) * 1000);
        }
      });
      answer.on('end', () => res.end());
    });
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  };

  const server = createServer(relay);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    faults,
    close: () => { server.closeAllConnections(); server.close(); },
  };
}
