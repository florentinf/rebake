import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { allLinks, linkLine, pagePath } from './src/core/links';
import { FORMATS } from './src/core/formats';

interface VendorManifest {
  [pkg: string]: { files: Record<string, { sha256: string; bytes: number; brotli: number }> };
}

const VIRTUAL = 'virtual:engines';
const manifest: VendorManifest = JSON.parse(readFileSync('vendor/manifest.json', 'utf8'));

/** engines/<pkg>-<hash>/<file>, so URLs are immutable but the files keep their names. */
function engineDir(pkg: string) {
  const digest = createHash('sha256');
  for (const file of Object.values(manifest[pkg]!.files)) digest.update(file.sha256);
  return `engines/${pkg}-${digest.digest('hex').slice(0, 10)}`;
}

function engines(): Plugin {
  const urls = Object.entries(manifest).map(([pkg, { files }]) => [
    pkg,
    {
      files: Object.fromEntries(Object.entries(files).map(([name, file]) => [
        name,
        { url: `/${engineDir(pkg)}/${name}`, bytes: file.bytes, brotli: file.brotli },
      ])),
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
          if (req.url?.startsWith(prefix)) {
            const name = req.url.slice(prefix.length).split('?')[0]!;
            res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
            createReadStream(join('vendor', pkg, name)).pipe(res);
            return;
          }
        }
        next();
      });
    },

    generateBundle() {
      for (const [pkg, { files }] of Object.entries(manifest)) {
        for (const name of Object.keys(files)) {
          this.emitFile({
            type: 'asset',
            fileName: `${engineDir(pkg)}/${name}`,
            source: readFileSync(join('vendor', pkg, name)),
          });
        }
      }
    },
  };
}

const ORIGIN = 'https://rebake.florentinf.dev';
const PROMISE = 'Files never leave this device.';
const SOURCE = 'https://github.com/florentinf/rebake';

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const swap = (html: string, from: string | RegExp, to: string) => {
  if (!(typeof from === 'string' ? html.includes(from) : from.test(html))) throw new Error(`pages: ${from} not found in index.html`);
  return html.replace(from, () => to);
};

/** index.html with this page's title, description and URL. */
function withHead(html: string, title: string, description: string, path: string) {
  let page = swap(html, /<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  page = swap(page, /<meta name="description" content=".*?" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  return swap(page, '</title>', `</title>\n    <link rel="canonical" href="${ORIGIN}${path}" />`);
}

/** A page with no app in it: shares the stylesheet, loads no script. */
function textPage(html: string, title: string, description: string, path: string, body: string) {
  const head = withHead(html, title, description, path).replace(/\s*<script type="module".*?<\/script>/, '').replace(/\s*<link rel="modulepreload".*?>/g, '');
  return swap(head, /<body[^>]*>[\s\S]*<\/body>/, `<body>\n    <div class="page text-page">\n      <header class="mark"><a href="/">rebake</a></header>\n      <main class="prose">\n${body}\n      </main>\n    </div>\n  </body>`);
}

const PRIVACY = `        <h1>Privacy</h1>
        <p>rebake runs in your browser. The server sends the code once, then every file is read and written on your device, in this tab, and is never uploaded.</p>
        <p>There are no logs, no analytics and no cookies. The Content-Security-Policy stops the page from connecting to anything but this site, and nothing here accepts data. The only thing kept in your browser is your last format and the state of the More panel.</p>
        <p>Test it: open a converter once, turn on airplane mode, then convert a file of that type.</p>
        <p>The code is open: <a href="${SOURCE}">${SOURCE.replace('https://', '')}</a>.</p>
        <p>Contact: <a href="mailto:contact@florentinf.dev">contact@florentinf.dev</a></p>`;

const NOT_FOUND = `        <h1>Not found</h1>
        <p><a href="/">Back to rebake</a></p>`;

/** The static pages: one per routing-table row, then privacy, 404, sitemap and robots. */
function pages(): Plugin {
  return {
    name: 'rebake-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const index = bundle['index.html'];
      if (index?.type !== 'asset') throw new Error('pages: no index.html in the bundle');
      const html = String(index.source);
      const emit = (fileName: string, source: string) => this.emitFile({ type: 'asset', fileName, source });

      const paths = ['/', '/privacy'];
      for (const link of allLinks()) {
        const path = pagePath(link);
        const from = FORMATS[link.from].label;
        const to = FORMATS[link.to].label;
        const line = linkLine(link);
        let page = withHead(html, `${from} to ${to} converter · rebake`, `${line} ${PROMISE}`, path);
        page = swap(page, '<span id="from">Drop a file</span>', `<span id="from">${escapeHtml(from)}</span>`);
        page = swap(page, 'aria-hidden="true" hidden>', 'aria-hidden="true">');
        page = swap(page, 'class="vh" hidden>to', 'class="vh">to');
        page = swap(page, '<span id="to" class="to"></span>', `<span id="to" class="to">${escapeHtml(to)}</span>`);
        page = swap(page, '<p class="meta" id="meta" data-flip hidden></p>', `<p class="meta" id="meta" data-flip>${escapeHtml(line)}</p>`);
        emit(`${path.slice(1)}.html`, page);
        paths.push(path);
      }

      emit('privacy.html', textPage(html, 'Privacy · rebake', 'What runs where, and what rebake keeps: nothing.', '/privacy', PRIVACY));
      emit('404.html', textPage(html, 'Not found · rebake', 'This page does not exist.', '/404', NOT_FOUND).replace(/\s*<link rel="canonical".*?>/, ''));
      emit('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((path) => `  <url><loc>${ORIGIN}${path}</loc></url>`).join('\n')}\n</urlset>\n`);
      emit('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
    },
  };
}

/** Emits the service worker with the list of shell files to precache. */
function serviceWorker(): Plugin {
  return {
    name: 'rebake-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const shell = Object.keys(bundle)
        // A converter page is index.html under another name: offline, the shell stands in for it.
        .filter((file) => !file.startsWith('engines/') && !file.endsWith('.map'))
        .filter((file) => !file.endsWith('.html') || file === 'index.html' || file === 'privacy.html')
        .filter((file) => file !== 'sitemap.xml' && file !== 'robots.txt' && file !== '404.html')
        .sort()
        .map((file) => (file === 'index.html' ? '/' : `/${file.replace(/\.html$/, '')}`));
      const version = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__SHELL__', JSON.stringify(shell));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [engines(), pages(), serviceWorker()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    sourcemap: false,
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
