// Serves dist/ the way Caddy does, with headers read from the real site block,
// so tests run against the production configuration rather than a copy of it.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 4319);
const ROOT = 'dist';
const caddy = readFileSync('deploy/rebake.florentinf.dev.caddy', 'utf8');
const block = caddy.match(/^\s*header \{\n([\s\S]*?)^\s*\}/m)[1];
const HEADERS = [...block.matchAll(/^\s*([A-Z][\w-]+) "(.*)"$/gm)].map((m) => [m[1], m[2]]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
};

createServer((req, res) => {
  const pathname = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let path = join(ROOT, pathname === '/' ? 'index.html' : pathname);
  // Caddy's `try_files {path} {path}.html`.
  if (!existsSync(path) && existsSync(`${path}.html`)) path = `${path}.html`;
  for (const [name, value] of HEADERS) res.setHeader(name, value);
  const hashed = pathname.startsWith('/assets/') || pathname.startsWith('/engines/');
  res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (!existsSync(path) || statSync(path).isDirectory()) {
    res.statusCode = 404;
    path = join(ROOT, '404.html');
  }
  res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
  res.setHeader('Vary', 'Accept-Encoding');
  if (/\bbr\b/.test(req.headers['accept-encoding'] ?? '') && existsSync(`${path}.br`)) {
    res.setHeader('Content-Encoding', 'br');
    path = `${path}.br`;
  }
  if (!res.statusCode) res.statusCode = 200;
  res.setHeader('Content-Length', statSync(path).size);
  createReadStream(path).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`rebake on http://127.0.0.1:${PORT}`));
