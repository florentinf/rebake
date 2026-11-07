// Serves dist/ the way Cloudflare's static assets do, with headers read from the real
// _headers file, so tests run against the production configuration.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 4319);
const ROOT = 'dist';

/** [path pattern, [[name, value | null], ...]], where null detaches a header set by an earlier rule. */
const RULES = [];
for (const line of readFileSync('public/_headers', 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  if (!/^\s/.test(line)) RULES.push([line.trim(), []]);
  else if (line.trim().startsWith('! ')) RULES.at(-1)[1].push([line.trim().slice(2), null]);
  else RULES.at(-1)[1].push([line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]);
}

function headersFor(pathname) {
  const headers = new Map();
  for (const [pattern, entries] of RULES) {
    const applies = pattern.endsWith('/*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
    if (!pattern.startsWith('/') || !applies) continue;
    for (const [name, value] of entries) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
  }
  return headers;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
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
  let pathname;
  try {
    pathname = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  } catch {
    res.writeHead(400).end();
    return;
  }
  // Cloudflare drops .html from URLs with a redirect, and serves the file at the short path.
  if (pathname.endsWith('.html')) {
    res.writeHead(308, { Location: pathname.slice(0, -5).replace(/\/index$/, '/') });
    res.end();
    return;
  }
  let path = join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!existsSync(path) && existsSync(`${path}.html`)) path = `${path}.html`;
  for (const [name, value] of headersFor(pathname)) res.setHeader(name, value);
  if (!existsSync(path) || statSync(path).isDirectory()) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'no-cache');
    path = join(ROOT, '404.html');
  }
  res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
  res.setHeader('Content-Length', statSync(path).size);
  createReadStream(path).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`rebake on http://127.0.0.1:${PORT}`));
