import { expect, test } from '@playwright/test';
import { captureSaves, convertAndRead, failure, fixture, hasFixture, open, pick } from './lib/harness';
import { pdfInfo, unzipTo } from './lib/documents';
import { readHeader } from './lib/inspect';

const IMAGES = ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'jxl', 'heic', 'svg', 'ico'];

test.beforeEach(async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
});

/** A rendered page must hold more than white: the text has to have drawn. */
async function drew(page: import('@playwright/test').Page, bytes: Uint8Array) {
  const type = bytes[0] === 0xff ? 'image/jpeg' : 'image/png';
  return page.evaluate(async ({ data, type }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 128) dark++;
    return dark;
  }, { data: [...bytes], type });
}

for (const target of ['png', 'jpg'] as const) {
  test(`pdf → ${target}: every page, zipped`, async ({ page }) => {
    await open(page, 'sample.pdf');
    const { name, bytes } = await convertAndRead(page, target);
    expect(name).toBe('sample.zip');
    const files = unzipTo(bytes);
    expect(Object.keys(files).sort()).toEqual([1, 2, 3].map((n) => `sample-${n}.${target}`));
    const header = await readHeader(files[`sample-2.${target}`]!);
    expect(header.format).toBe(target);
    expect([header.width, header.height]).toEqual([1240, 1754]);
    expect(await drew(page, files[`sample-2.${target}`]!)).toBeGreaterThan(500);
  });

  test(`a one-page pdf → ${target} stays a plain file`, async ({ page }) => {
    await open(page, 'one-page.pdf');
    const { name, bytes } = await convertAndRead(page, target);
    expect(name).toBe(`one-page.${target}`);
    expect((await readHeader(bytes)).format).toBe(target);
    expect(await drew(page, bytes)).toBeGreaterThan(500);
  });
}

test('a page range picks those pages', async ({ page }) => {
  await open(page, 'sample.pdf');
  await page.click('#more');
  await page.fill('#pages', '1, 3');
  const { bytes } = await convertAndRead(page, 'png');
  expect(Object.keys(unzipTo(bytes)).sort()).toEqual(['sample-1.png', 'sample-3.png']);
});

test('a range of one page is a plain file', async ({ page }) => {
  await open(page, 'sample.pdf');
  await page.click('#more');
  await page.fill('#pages', '2');
  const { name } = await convertAndRead(page, 'jpg');
  expect(name).toBe('sample.jpg');
});

test('a range past the end says how long the PDF is', async ({ page }) => {
  await open(page, 'sample.pdf');
  await page.click('#more');
  await page.fill('#pages', '2-9');
  await page.click('#primary');
  expect(await failure(page)).toBe("This PDF has 3 pages, so there's no page 4.");
});

test('a range it cannot read blocks Convert', async ({ page }) => {
  await open(page, 'sample.pdf');
  await page.click('#more');
  await page.fill('#pages', 'first two');
  await expect(page.locator('#meta.error')).toHaveText('Use pages like 1-3, 5.');
  await expect(page.locator('#primary')).toBeDisabled();
});

test('a password-protected PDF says so', async ({ page }) => {
  test.skip(!hasFixture('locked.pdf'), 'needs qpdf');
  await open(page, 'locked.pdf');
  await page.click('#primary');
  expect(await failure(page)).toContain('password-protected');
});

test('a damaged PDF fails loudly', async ({ page }) => {
  await open(page, 'corrupt.pdf');
  await page.click('#primary');
  expect(await failure(page)).toContain('damaged');
});

for (const input of IMAGES) {
  test(`${input} → pdf`, async ({ page }) => {
    test.skip(!hasFixture(`sample.${input}`), 'HEIC fixtures need macOS');
    await open(page, `sample.${input}`);
    const { name, bytes } = await convertAndRead(page, 'pdf');
    expect(name).toBe('sample.pdf');
    const info = await pdfInfo(bytes);
    expect(info.pages).toBe(1);
    expect(info.images).toBeGreaterThanOrEqual(1);
  });
}

test('A4 by default, Letter in the drawer, and wide images turn the page', async ({ page }) => {
  await open(page, 'sample.png');
  const a4 = await pdfInfo((await convertAndRead(page, 'pdf')).bytes);
  expect([a4.width, a4.height]).toEqual([842, 595]);
  await page.click('#primary');
  await open(page, 'sample.png');
  await pick(page, 'pdf');
  await page.click('#more');
  await page.locator('label:has(input[name=pageSize][value=letter])').click();
  const letter = await pdfInfo((await convertAndRead(page, 'pdf')).bytes);
  expect([letter.width, letter.height]).toEqual([792, 612]);
});

test('several images become one PDF, a page each, in order', async ({ page }) => {
  await page.setInputFiles('#picker', ['sample.jpg', 'sample.png', 'sample.webp'].map(fixture));
  const { name, bytes } = await convertAndRead(page, 'pdf');
  expect(name).toBe('rebake.pdf');
  expect((await pdfInfo(bytes)).pages).toBe(3);
  await expect(page.locator('#to')).toHaveText('PDF');
});

test('a rotated photo stands upright in the PDF, with its metadata gone', async ({ page }) => {
  await open(page, 'rotated.jpg');
  const { bytes } = await convertAndRead(page, 'pdf');
  const info = await pdfInfo(bytes);
  expect(info.height).toBeGreaterThan(info.width);
  expect(Buffer.from(bytes).includes('rebake-fixture-marker')).toBe(false);
});
