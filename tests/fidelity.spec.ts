import { expect, test, type Page } from '@playwright/test';
import Vips from 'wasm-vips';
import Papa from 'papaparse';
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { captureSaves, convertAndRead, failure, open, pick } from './lib/harness';
import { readHeader } from './lib/inspect';
import { stripJpeg } from '../src/core/jpeg';
import { commitDestination } from '../src/core/destination';
import { DEFAULT_OPTIONS } from '../src/core/engine';
import { pdfSize, svgSize, validateOptions } from '../src/core/rendering';

let engine: Promise<Awaited<ReturnType<typeof Vips>>> | undefined;
async function vips() {
  const v = await (engine ??= Vips({ dynamicLibraries: ['vips-heif.wasm', 'vips-jxl.wasm'], print: () => {}, printErr: () => {} }));
  v.concurrency(1);
  return v;
}
async function pattern() {
  const v = await vips();
  const pixels = new Uint8Array(32 * 24 * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 31 + (i >> 4) * 19) % 256;
  const image = v.Image.newFromMemory(pixels, 32, 24, 4, v.BandFormat.uchar).copy({ interpretation: 'srgb' });
  return { pixels, png: image.writeToBuffer('.png', { keep: 'none' }) };
}
const upload = (page: Page, name: string, text: string | Uint8Array, mimeType: string) =>
  page.setInputFiles('#picker', { name, mimeType, buffer: Buffer.from(text) });
const choose = (page: Page, name: string, value: string) => page.locator(`label:has(input[name="${name}"][value="${value}"])`).click();
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="100" height="100" fill="red"/></svg>';

test.beforeEach(async ({ page }) => { await captureSaves(page); await page.goto('/'); });

for (const target of ['webp', 'avif', 'jxl']) {
  test(`explicit lossless ${target} preserves all RGBA pixels`, async ({ page }) => {
    const { png, pixels } = await pattern();
    await upload(page, 'pattern.png', png, 'image/png');
    await pick(page, target);
    await page.click('#more');
    await choose(page, 'compression', 'lossless');
    await expect(page.locator('#quality')).toBeHidden();
    await expect(page.locator('#summary')).toContainText('Lossless compression');
    const { bytes } = await convertAndRead(page, target);
    const v = await vips();
    const decoded = v.Image.newFromBuffer(bytes);
    expect(decoded.bands).toBe(4);
    expect(Buffer.from(decoded.writeToMemory())).toEqual(Buffer.from(pixels));
  });
}

test('compression choice is limited to supported outputs and restores quality on lossy', async ({ page }) => {
  await open(page, 'sample.png');
  await page.click('#more');
  for (const target of ['png', 'jpg', 'tiff', 'gif', 'ico']) {
    await pick(page, target);
    await expect(page.locator('input[name=compression]').first()).toBeHidden();
  }
  await pick(page, 'webp');
  await choose(page, 'compression', 'lossless');
  await expect(page.locator('#quality')).toBeHidden();
  await choose(page, 'compression', 'lossy');
  await expect(page.locator('#quality')).toBeVisible();
  await pick(page, 'pdf');
  await expect(page.locator('input[name=compression]').first()).toBeHidden();
});

test('SVG custom rendering can enlarge and fits a box without changing aspect', async ({ page }) => {
  await upload(page, 'drawing.svg', svg, 'image/svg+xml');
  await expect(page.locator('#summary')).toContainText('1024 × 512 px');
  await page.click('#more');
  await expect(page.locator('#max-width')).toBeHidden();
  await page.fill('#svg-width', '3000');
  await page.fill('#svg-height', '1000');
  await expect(page.locator('#summary')).toContainText('2000 × 1000 px');
  const { bytes } = await convertAndRead(page, 'png');
  expect(await readHeader(bytes)).toMatchObject({ width: 2000, height: 1000 });
});

test('invalid dimensions block conversion and Reset options repairs restored invalid state', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('rebake.more.image', JSON.stringify({ values: { maxWidth: '-1' } })));
  await open(page, 'sample.png');
  await expect(page.locator('#primary')).toBeDisabled();
  await page.click('#more');
  await page.click('#reset-options');
  await expect(page.locator('#primary')).toBeEnabled();
  for (const value of ['-1', '0', '0.5', '32769']) {
    await page.fill('#max-width', value);
    await expect(page.locator('#primary')).toBeDisabled();
  }
  await page.fill('#max-width', '120');
  await expect(page.locator('#primary')).toBeEnabled();
  await pick(page, 'pdf');
  await expect(page.locator('#max-width')).toHaveValue('');
  await expect(page.locator('#primary')).toBeEnabled();
});

test('selected background really replaces transparency', async ({ page }) => {
  await upload(page, 'drawing.svg', svg, 'image/svg+xml');
  await page.click('#more');
  await choose(page, 'transparency', 'flatten');
  await page.locator('#background').fill('#00ff00');
  const { bytes } = await convertAndRead(page, 'png');
  const v = await vips();
  const image = v.Image.newFromBuffer(bytes);
  expect(image.hasAlpha()).toBe(false);
  expect(image.getpoint(image.width - 1, image.height - 1)).toEqual([0, 255, 0]);
});

test('PDF DPI, background and batch page range all affect the output', async ({ page }) => {
  const pdf = await PDFDocument.create();
  pdf.addPage([72, 36]); pdf.addPage([72, 36]);
  const bytes = await pdf.save();
  await upload(page, 'one.pdf', bytes, 'application/pdf');
  await page.click('#more');
  await choose(page, 'dpi', '300');
  await choose(page, 'transparency', 'flatten');
  await page.locator('#background').fill('#123456');
  await page.fill('#pages', '2');
  const rendered = await convertAndRead(page, 'png');
  expect(await readHeader(rendered.bytes)).toMatchObject({ width: 300, height: 150 });
  const v = await vips();
  expect(v.Image.newFromBuffer(rendered.bytes).getpoint(0, 0).slice(0, 3)).toEqual([18, 52, 86]);
  await page.click('#primary');
  await page.setInputFiles('#picker', ['one.pdf', 'two.pdf'].map((name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) })));
  if (await page.locator('#more').getAttribute('aria-expanded') !== 'true') await page.click('#more');
  await page.fill('#pages', '2');
  const batch = await convertAndRead(page, 'png');
  expect(Object.keys(unzipSync(batch.bytes)).sort()).toEqual(['one.png', 'two.png']);
});

test('PDF custom DPI validates, and image/PDF settings are independently remembered', async ({ page }) => {
  await open(page, 'one-page.pdf');
  await page.click('#more');
  await choose(page, 'dpi', 'custom');
  for (const value of ['', '0', '35', '601', '72.5']) {
    await page.fill('#pdf-dpi', value);
    await expect(page.locator('#primary')).toBeDisabled();
  }
  await page.fill('#pdf-dpi', '72');
  await expect(page.locator('#primary')).toBeEnabled();
  await page.keyboard.press('Escape');
  await open(page, 'sample.png');
  await pick(page, 'pdf');
  await page.click('#more');
  await expect(page.locator('#pdf-dpi')).toBeHidden();
  await choose(page, 'pdfCompression', 'lossy');
  await expect(page.locator('#quality')).toBeVisible();
  await expect(page.locator('#quality')).toHaveValue('92');
});

test('adjust and change-format keep original files and never reuse a lossy result', async ({ page }) => {
  await open(page, 'sample.png');
  await page.click('#more');
  await page.fill('#max-width', '120');
  await convertAndRead(page, 'jpg');
  await page.click('#adjust-settings');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
  await expect(page.locator('#from')).toHaveText('PNG');
  await expect(page.locator('input[name=target]:checked')).toHaveValue('jpg');
  await expect(page.locator('#more')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#max-width')).toHaveValue('120');
  await page.fill('#max-width', '240');
  expect(await readHeader((await convertAndRead(page, 'jpg')).bytes)).toMatchObject({ width: 240, height: 160 });
  await page.click('#change-format');
  await expect(page.locator('input[name=target]:checked')).toBeFocused();
  await expect(page.locator('#sheet')).toContainText('sample.png');
  const final = await convertAndRead(page, 'png');
  expect(await readHeader(final.bytes)).toMatchObject({ width: 240, height: 160 });
});

test('same-format JPG removes metadata without recompression, with explicit recompress opt-in', async ({ page }) => {
  const v = await vips();
  const { png } = await pattern();
  const jpg = v.Image.newFromBuffer(png).flatten({ background: [255, 255, 255] }).writeToBuffer('.jpg', { Q: 95, keep: 'none' });
  await upload(page, 'picture.jpg', jpg, 'image/jpeg');
  const copy = await convertAndRead(page, 'jpg');
  expect(Buffer.from(copy.bytes)).toEqual(Buffer.from(stripJpeg(jpg)));
  await page.click('#adjust-settings');
  await page.locator('#quality').fill('10');
  await expect(page.locator('#recompress')).toBeChecked();
  const changed = await convertAndRead(page, 'jpg');
  expect(Buffer.from(changed.bytes)).not.toEqual(Buffer.from(copy.bytes));
  await page.click('#adjust-settings');
  await page.locator('#recompress').uncheck();
  expect(Buffer.from((await convertAndRead(page, 'jpg')).bytes)).toEqual(Buffer.from(copy.bytes));
});

test('mixed JPG/PNG batches can target JPG, keeping existing JPG picture data', async ({ page }) => {
  const v = await vips();
  const { png } = await pattern();
  const jpg = v.Image.newFromBuffer(png).flatten({ background: [255, 255, 255] }).writeToBuffer('.jpg', { Q: 95, keep: 'none' });
  await page.setInputFiles('#picker', [
    { name: 'existing.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) },
    { name: 'drawing.png', mimeType: 'image/png', buffer: Buffer.from(png) },
  ]);
  const files = unzipSync((await convertAndRead(page, 'jpg')).bytes);
  expect(Object.keys(files).sort()).toEqual(['drawing.jpg', 'existing.jpg']);
  expect(Buffer.from(files['existing.jpg']!)).toEqual(Buffer.from(stripJpeg(jpg)));
  expect(await readHeader(files['drawing.jpg']!)).toMatchObject({ format: 'jpg', width: 32, height: 24 });
});

test('images-to-PDF honors preserve, PNG and JPG policies without hidden re-encoding', async ({ page }) => {
  const v = await vips();
  const { png } = await pattern();
  const jpg = v.Image.newFromBuffer(png).flatten({ background: [255, 255, 255] }).writeToBuffer('.jpg', { Q: 95, keep: 'none' });
  await upload(page, 'photo.jpg', jpg, 'image/jpeg');
  const embeddedImage = async (bytes: Uint8Array) => {
    const pdf = await PDFDocument.load(bytes);
    const objects = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const image = objects.lookup(objects.keys()[0]!);
    if (!(image instanceof PDFRawStream)) throw new Error('PDF image is not a stream');
    return image;
  };
  const kept = await embeddedImage((await convertAndRead(page, 'pdf')).bytes);
  expect(kept.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
  expect(Buffer.from(kept.getContents())).toEqual(Buffer.from(stripJpeg(jpg)));
  await page.click('#adjust-settings');
  await choose(page, 'pdfCompression', 'lossless');
  const lossless = await embeddedImage((await convertAndRead(page, 'pdf')).bytes);
  expect(lossless.dict.get(PDFName.of('Filter'))?.toString()).toBe('/FlateDecode');
  await page.click('#adjust-settings');
  await choose(page, 'pdfCompression', 'lossy');
  await page.locator('#quality').fill('10');
  const recompressed = await embeddedImage((await convertAndRead(page, 'pdf')).bytes);
  expect(recompressed.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
  expect(Buffer.from(recompressed.getContents())).not.toEqual(Buffer.from(kept.getContents()));
});

test('keep-profile retains ICC when other metadata is stripped, and preserves 16-bit PNG data', async ({ page }) => {
  const v = await vips();
  const { png } = await pattern();
  const profiled = v.Image.newFromBuffer(png).writeToBuffer('.png', { profile: 'srgb', keep: 'all' });
  await upload(page, 'profile.png', profiled, 'image/png');
  await pick(page, 'png');
  await page.click('#more');
  await choose(page, 'colorSpace', 'preserve');
  const kept = v.Image.newFromBuffer((await convertAndRead(page, 'png')).bytes);
  expect(Buffer.from(kept.getBlob('icc-profile-data'))).toEqual(Buffer.from(v.Image.newFromBuffer(profiled).getBlob('icc-profile-data')));
  await page.click('#primary');
  const samples = new Uint16Array([0, 1, 65535, 12345, 54321, 32768]);
  const deep = v.Image.newFromMemory(samples, 2, 1, 3, v.BandFormat.ushort).copy({ interpretation: 'rgb16' });
  await upload(page, 'deep.png', deep.writeToBuffer('.png', { keep: 'none' }), 'image/png');
  const result = v.Image.newFromBuffer((await convertAndRead(page, 'png')).bytes);
  expect(result.format).toBe('ushort');
  const memory = result.writeToMemory();
  expect(Buffer.from(memory.buffer, memory.byteOffset, memory.byteLength)).toEqual(Buffer.from(samples.buffer));
});

test('animated resizing keeps frames, while first-frame mode creates a still', async ({ page }) => {
  await open(page, 'animated.gif');
  await pick(page, 'webp');
  await page.click('#more');
  await page.fill('#max-width', '120');
  expect(await readHeader((await convertAndRead(page, 'webp')).bytes)).toMatchObject({ width: 120, height: 80, pages: 2 });
  await page.click('#adjust-settings');
  await choose(page, 'animation', 'first');
  expect(await readHeader((await convertAndRead(page, 'webp')).bytes)).toMatchObject({ width: 120, height: 80, pages: 1 });
});

test('data conversion refuses ambiguous headers and preserves colliding paths and empty objects', async ({ page }) => {
  await upload(page, 'duplicate.csv', 'name,name\nAlice,Bob\n', 'text/csv');
  await pick(page, 'json'); await page.click('#primary');
  expect(await failure(page)).toContain('appears more than once');
  expect(await page.evaluate(() => window.__saved?.length)).toBe(0);
  await upload(page, 'blank.csv', ',name\nAlice,Bob\n', 'text/csv');
  await pick(page, 'json'); await page.click('#primary');
  expect(await failure(page)).toContain('no header');
  await upload(page, 'paths.json', '[{"a.b":1,"a":{"b":2},"empty":{},"slash\\\\key":3,"__proto__":"kept"}]', 'application/json');
  const { bytes } = await convertAndRead(page, 'csv');
  const rows = Papa.parse<string[]>(Buffer.from(bytes).toString().trim()).data;
  expect(rows).toEqual([['a\\.b', 'a.b', 'empty', 'slash\\\\key', '__proto__'], ['1', '2', '{}', '3', 'kept']]);
});

test('render bounds and programmatic option validation protect codecs', () => {
  for (const value of [-1, 0, 0.5, NaN, Infinity, 32769]) expect(() => validateOptions({ ...DEFAULT_OPTIONS, maxWidth: value })).toThrow();
  expect(() => svgSize(200, 100, { ...DEFAULT_OPTIONS, svgWidth: 32768 })).toThrow('16 million');
  for (const [w, h] of [[595, 842], [1e9, 1], [1, 1e9], [1e9, 1e9]]) {
    const size = pdfSize(w!, h!, 600);
    expect(size.width * size.height).toBeLessThanOrEqual(16_000_000);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(32768);
  }
});

test('chosen destinations commit atomically and existing files survive failure and cancellation', async () => {
  for (const mode of ['success', 'open-error', 'write-error', 'cancel', 'already-aborted']) {
    let original = 'existing file'; let staged = ''; let closed = false; let aborted = false; let opened = false; let removed = false;
    const controller = new AbortController();
    const handle = {
      remove: () => { removed = true; },
      createWritable: async () => {
        opened = true;
        if (mode === 'open-error') throw new DOMException('Permission denied', 'NotAllowedError');
        return {
          write: async (chunk: Uint8Array) => { staged += new TextDecoder().decode(chunk); if (mode === 'write-error') throw new Error('disk full'); },
          close: async () => { closed = true; original = staged; },
          abort: async () => { aborted = true; staged = ''; },
        };
      },
    } as unknown as FileSystemFileHandle;
    if (mode === 'already-aborted') controller.abort();
    const operation = commitDestination(handle, new Blob(['new output']), controller.signal, () => { if (mode === 'cancel') controller.abort(); });
    if (mode === 'success') { await operation; expect(original).toBe('new output'); expect(closed).toBe(true); }
    else {
      await expect(operation).rejects.toThrow();
      expect(original).toBe('existing file'); expect(closed).toBe(false);
      if (mode === 'already-aborted') expect(opened).toBe(false);
      else if (mode !== 'open-error') expect(aborted).toBe(true);
    }
    expect(removed).toBe(false);
  }
});

async function destinationMock(page: Page, hold: boolean) {
  await page.addInitScript(({ hold }) => {
    const state = { opened: 0, aborted: 0, removed: 0, contents: [1, 2, 3], hold };
    (window as unknown as { destinationState: typeof state }).destinationState = state;
    const size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
    Object.defineProperty(File.prototype, 'size', { get(this: File) { return ['a.csv', 'b.csv'].includes(this.name) ? 100_000_001 : size.call(this); } });
    (window as unknown as { showSaveFilePicker: () => Promise<unknown> }).showSaveFilePicker = async () => ({
      remove: async () => { state.removed++; state.contents = []; },
      createWritable: async () => {
        state.opened++;
        const staged: number[] = [];
        let release: (() => void) | undefined;
        return {
          write: async (chunk: Uint8Array) => { staged.push(...chunk); if (state.hold) await new Promise<void>((resolve) => { release = resolve; }); },
          close: async () => { state.contents = staged; },
          abort: async () => { state.aborted++; release?.(); },
        };
      },
    });
  }, { hold });
  await page.reload();
}

test('a failed conversion never opens or deletes the chosen destination', async ({ page }) => {
  await destinationMock(page, false);
  await page.setInputFiles('#picker', ['a.csv', 'b.csv'].map((name) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('name,name\nAlice,Bob\n') })));
  await pick(page, 'json'); await page.click('#primary');
  expect(await failure(page)).toContain('appears more than once');
  const state = await page.evaluate(() => (window as unknown as { destinationState: { opened: number; removed: number; contents: number[] } }).destinationState);
  expect(state).toMatchObject({ opened: 0, removed: 0, contents: [1, 2, 3] });
});

test('cancel during destination writing preserves the existing file and the next job commits', async ({ page }) => {
  await destinationMock(page, true);
  await page.setInputFiles('#picker', ['a.csv', 'b.csv'].map((name) => ({ name, mimeType: 'text/csv', buffer: Buffer.from('name\nAlice\n') })));
  await pick(page, 'json'); await page.click('#primary');
  await expect(page.locator('#progress-text')).toHaveText('Saving the file');
  await page.click('#secondary');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
  const cancelled = await page.evaluate(() => (window as unknown as { destinationState: { aborted: number; removed: number; contents: number[]; hold: boolean } }).destinationState);
  expect(cancelled.aborted).toBeGreaterThan(0);
  expect(cancelled).toMatchObject({ removed: 0, contents: [1, 2, 3] });
  await page.evaluate(() => { (window as unknown as { destinationState: { hold: boolean } }).destinationState.hold = false; });
  await page.click('#primary');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done');
  const finished = await page.evaluate(() => (window as unknown as { destinationState: { opened: number; removed: number; contents: number[] } }).destinationState);
  expect(finished.opened).toBe(2); expect(finished.removed).toBe(0);
  expect(finished.contents.slice(0, 4)).toEqual([0x50, 0x4b, 3, 4]);
});
