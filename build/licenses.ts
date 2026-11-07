import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** What's bundled into the app's own JavaScript or CSS rather than served from `vendor/`. */
const BUNDLED: [name: string, path: string][] = [
  ['@bjorn3/browser_wasi_shim', 'node_modules/@bjorn3/browser_wasi_shim/LICENSE-MIT'],
  ['client-zip', 'node_modules/client-zip/LICENSE.txt'],
  ['fflate', 'node_modules/fflate/LICENSE'],
  ['gifenc', 'node_modules/gifenc/LICENSE.md'],
  ['Hanken Grotesk', 'src/assets/fonts/OFL.txt'],
  ['Mediabunny', 'node_modules/mediabunny/LICENSE'],
  ['Papa Parse', 'node_modules/papaparse/LICENSE'],
  ['yaml', 'node_modules/yaml/LICENSE'],
];

const NOTICE = /^(LICENSE|COPYING|COPYRIGHT|NOTICE|THIRD-PARTY-NOTICES)/;

/** Every licence text in `vendor/`, by package. A new engine's are picked up by name. */
function vendored(): [string, string][] {
  return readdirSync('vendor', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap(({ name: pkg }) => readdirSync(join('vendor', pkg))
      .filter((file) => NOTICE.test(file))
      .map((file): [string, string] => [`${pkg}: ${file}`, join('vendor', pkg, file)]));
}

/** The licences that travel with the files, as a plain text page on the site itself. */
export function licenses(): Plugin {
  return {
    name: 'rebake-licenses',
    apply: 'build',
    generateBundle() {
      const sections = [...BUNDLED, ...vendored()].map(([name, path]) => `${'='.repeat(78)}\n${name}\n${'='.repeat(78)}\n\n${readFileSync(path, 'utf8').trim()}\n`);
      const source = `Third-party software in rebake. See docs/THIRD_PARTY.md in the source for versions and links.\n\n${sections.join('\n')}`;
      this.emitFile({ type: 'asset', fileName: 'third-party-licenses.txt', source });
    },
  };
}
