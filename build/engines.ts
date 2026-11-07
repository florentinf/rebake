import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

interface VendorManifest {
  [pkg: string]: { files: Record<string, { sha256: string; bytes: number; brotli: number }> };
}

const VIRTUAL = 'virtual:engines';
const manifest: VendorManifest = JSON.parse(readFileSync('vendor/manifest.json', 'utf8'));

/** Cloudflare refuses any static file over this. */
const MAX_FILE_BYTES = 25 * 1024 ** 2;
const gzipped = new Map<string, Buffer>();

/** engines/<pkg>-<hash>/<file>, so URLs are immutable but the files keep their names. */
function engineDir(pkg: string) {
  const digest = createHash('sha256');
  for (const file of Object.values(manifest[pkg]!.files)) digest.update(file.sha256);
  return `engines/${pkg}-${digest.digest('hex').slice(0, 10)}`;
}

/** The URL prefix of every engine in this build, so the service worker can drop older ones. */
export const engineDirs = () => Object.keys(manifest).map((pkg) => `/${engineDir(pkg)}/`);

/** A file over the limit ships gzipped, and `core/fetch-asset.ts` unpacks it in the browser. */
function published(pkg: string, name: string) {
  const file = manifest[pkg]!.files[name]!;
  const path = join('vendor', pkg, name);
  if (file.bytes <= MAX_FILE_BYTES) return { name, wire: file.brotli, source: () => readFileSync(path) };
  if (!gzipped.has(path)) gzipped.set(path, gzipSync(readFileSync(path), { level: 9 }));
  const source = gzipped.get(path)!;
  return { name: `${name}.gz`, wire: source.length, source: () => source };
}

/** Serves `vendor/` under hashed URLs and tells the app what those URLs are. */
export function engines(): Plugin {
  const urls = Object.entries(manifest).map(([pkg, { files }]) => [
    pkg,
    {
      files: Object.fromEntries(Object.entries(files).map(([name, file]) => {
        const { name: servedAs, wire } = published(pkg, name);
        return [name, { url: `/${engineDir(pkg)}/${servedAs}`, bytes: file.bytes, wire }];
      })),
    },
  ]);

  return {
    name: 'rebake-engines',
    resolveId: (id) => (id === VIRTUAL ? `\0${VIRTUAL}` : null),
    load: (id) => (id === `\0${VIRTUAL}` ? `export default ${JSON.stringify(Object.fromEntries(urls))}` : null),

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        for (const pkg of Object.keys(manifest)) {
          const prefix = `/${engineDir(pkg)}/`;
          if (!req.url?.startsWith(prefix)) continue;
          const name = req.url.slice(prefix.length).split('?')[0]!;
          // This runs ahead of Vite's own headers, and vips's thread workers need these.
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
          if (name.endsWith('.gz')) {
            res.setHeader('Content-Type', 'application/gzip');
            res.end(published(pkg, name.slice(0, -3)).source());
            return;
          }
          res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
          createReadStream(join('vendor', pkg, name)).pipe(res);
          return;
        }
        next();
      });
    },

    generateBundle() {
      for (const [pkg, { files }] of Object.entries(manifest)) {
        for (const name of Object.keys(files)) {
          const { name: servedAs, source } = published(pkg, name);
          const bytes = source();
          if (bytes.length > MAX_FILE_BYTES) throw new Error(`engines: ${servedAs} is over Cloudflare's limit even gzipped`);
          this.emitFile({ type: 'asset', fileName: `${engineDir(pkg)}/${servedAs}`, source: bytes });
        }
      }
    },
  };
}
