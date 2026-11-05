// Writes a .br next to every compressible file in dist/ for Caddy's `precompressed br`.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const COMPRESSIBLE = /\.(html|js|mjs|css|svg|wasm|json|webmanifest|txt|xml|otf|ttf|pack)$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

let saved = 0;
for (const path of walk('dist')) {
  if (!COMPRESSIBLE.test(path)) continue;
  const input = readFileSync(path);
  const output = brotliCompressSync(input, {
    params: { [constants.BROTLI_PARAM_QUALITY]: input.length > 4e6 ? 9 : 11 },
  });
  writeFileSync(`${path}.br`, output);
  saved += input.length - output.length;
}
console.log(`brotli: saved ${(saved / 1e6).toFixed(1)} MB`);
