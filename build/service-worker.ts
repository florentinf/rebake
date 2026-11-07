import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { engineDirs } from './engines';

/** A converter page is index.html under another name: offline, the shell stands in for it. */
const PRECACHED_PAGES = new Set(['index.html', 'privacy.html', 'support.html']);
const NOT_PRECACHED = new Set(['sitemap.xml', 'robots.txt', 'third-party-licenses.txt']);

/** Emits the service worker with the list of shell files to precache. */
export function serviceWorker(): Plugin {
  return {
    name: 'rebake-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const shell = Object.keys(bundle)
        .filter((file) => !file.startsWith('engines/') && !file.endsWith('.map') && !NOT_PRECACHED.has(file))
        .filter((file) => !file.endsWith('.html') || PRECACHED_PAGES.has(file))
        .sort()
        .map((file) => (file === 'index.html' ? '/' : `/${file.replace(/\.html$/, '')}`));
      const digest = createHash('sha256').update(shell.join('\n'));
      for (const file of Object.values(bundle)) {
        if (file.fileName.endsWith('.html')) digest.update(file.type === 'asset' ? file.source : file.code);
      }
      const source = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', digest.digest('hex').slice(0, 12))
        .replace('__SHELL__', JSON.stringify(shell))
        .replace('__ENGINE_DIRS__', JSON.stringify(engineDirs()));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
