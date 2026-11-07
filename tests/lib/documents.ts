import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';

/** Writes bytes to a temp file for the callback, then removes it. */
export function withTemp<T>(bytes: Uint8Array, name: string, use: (path: string, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'rebake-'));
  try {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return use(path, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const READER: Record<string, string> = { md: 'gfm', tex: 'latex', html: 'html', docx: 'docx', odt: 'odt', epub: 'epub', rtf: 'rtf' };

/** An independent pandoc reads the output back as plain text. */
export function documentText(bytes: Uint8Array, format: string): string {
  return withTemp(bytes, `out.${format}`, (path) =>
    execFileSync('pandoc', ['-f', READER[format]!, '-t', 'plain', path], { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
}

export function unzipTo(bytes: Uint8Array): Record<string, Uint8Array> {
  return withTemp(bytes, 'out.zip', (path, dir) => {
    const out = join(dir, 'x');
    execFileSync('unzip', ['-q', path, '-d', out]);
    const walk = (at: string): string[] => readdirSync(at).flatMap((name) => {
      const full = join(at, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
    return Object.fromEntries(walk(out).map((file) => [relative(out, file), new Uint8Array(readFileSync(file))]));
  });
}

export async function pdfInfo(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  const size = document.getPage(0).getSize();
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  const reader = await task.promise;
  let text = '';
  for (let i = 1; i <= reader.numPages; i++) {
    const content = await (await reader.getPage(i)).getTextContent();
    text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
  }
  await task.destroy();
  const images = withTemp(bytes, 'out.pdf', (path) => {
    const { pages } = JSON.parse(execFileSync('qpdf', ['--json', '--json-key=pages', path]).toString()) as { pages: { images: unknown[] }[] };
    return pages.reduce((sum, page) => sum + page.images.length, 0);
  });
  return { pages: document.getPageCount(), width: Math.round(size.width), height: Math.round(size.height), text, images };
}
