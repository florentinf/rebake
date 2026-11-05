import { expect, test } from '@playwright/test';
import { sniff } from '../src/core/detect';
import { sameFormat, type FormatId } from '../src/core/formats';
import { captureSaves, convertAndRead, failure, open, pick } from './lib/harness';
import { documentText, pdfInfo, unzipTo } from './lib/documents';

const MARKER = 'rebake-doc-marker';
const FORMATS = ['md', 'html', 'docx', 'odt', 'epub', 'rtf', 'tex'] as const;
const HAS_IMAGES = new Set(['html', 'docx', 'odt', 'epub']);

test.describe.configure({ retries: 1 });

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await captureSaves(page);
  await page.goto('/');
});

for (const input of FORMATS) {
  for (const target of [...FORMATS, 'pdf'] as const) {
    if (target === input) continue;
    test(`${input} → ${target}`, async ({ page }) => {
      await open(page, `sample.${input}`);
      const { name, bytes } = await convertAndRead(page, target, 100_000);
      if (target === 'pdf') {
        expect(sniff(bytes.subarray(0, 4096))).toBe('pdf');
        expect((await pdfInfo(bytes)).text).toContain(MARKER);
        return;
      }
      if (name.endsWith('.zip')) {
        expect(HAS_IMAGES.has(input) && (target === 'md' || target === 'tex')).toBe(true);
        const files = unzipTo(bytes);
        expect(documentText(files[`sample.${target}`]!, target)).toContain(MARKER);
        return;
      }
      expect(name).toBe(`sample.${target}`);
      if (target !== 'md' && target !== 'tex') expect(sameFormat(sniff(bytes.subarray(0, 4096)), target as FormatId)).toBe(true);
      expect(documentText(bytes, target)).toContain(MARKER);
    });
  }
}

const imagesIn = (files: Record<string, Uint8Array>) => Object.keys(files).filter((name) => /\.(png|jpe?g)$/i.test(name));

test('images in a DOCX survive into HTML', async ({ page }) => {
  await open(page, 'sample.docx');
  const { bytes } = await convertAndRead(page, 'html', 100_000);
  expect(Buffer.from(bytes).toString().match(/<img[^>]+src="data:image\/(png|jpeg)/g)).toHaveLength(2);
});

for (const target of ['odt', 'epub'] as const) {
  test(`images in a DOCX survive into ${target}`, async ({ page }) => {
    await open(page, 'sample.docx');
    const { bytes } = await convertAndRead(page, target, 100_000);
    expect(imagesIn(unzipTo(bytes))).toHaveLength(2);
  });
}

test('images in a DOCX survive into RTF', async ({ page }) => {
  await open(page, 'sample.docx');
  const { bytes } = await convertAndRead(page, 'rtf', 100_000);
  expect(Buffer.from(bytes).toString().match(/\\pict/g)).toHaveLength(2);
});

for (const target of ['md', 'tex'] as const) {
  test(`images in a DOCX come beside ${target} in a ZIP`, async ({ page }) => {
    await open(page, 'sample.docx');
    const { name, bytes } = await convertAndRead(page, target, 100_000);
    expect(name).toBe('sample.zip');
    const files = unzipTo(bytes);
    expect(imagesIn(files)).toHaveLength(2);
    const text = Buffer.from(files[`sample.${target}`]!).toString();
    for (const image of imagesIn(files)) expect(text).toContain(image);
    await expect(page.locator('#to')).toHaveText('ZIP');
  });
}

test('images in a DOCX survive into PDF', async ({ page }) => {
  await open(page, 'sample.docx');
  const { bytes } = await convertAndRead(page, 'pdf', 100_000);
  expect((await pdfInfo(bytes)).images).toBeGreaterThanOrEqual(2);
});

test('the drawer sets the PDF page size', async ({ page }) => {
  await open(page, 'sample.md');
  const size = await pdfInfo((await convertAndRead(page, 'pdf', 100_000)).bytes);
  expect([size.width, size.height]).toEqual([595, 842]);
  await page.click('#primary');
  await open(page, 'sample.md');
  await pick(page, 'pdf');
  await page.click('#more');
  await page.locator('label:has(input[name=pageSize][value=letter])').click();
  const letter = await pdfInfo((await convertAndRead(page, 'pdf', 100_000)).bytes);
  expect([letter.width, letter.height]).toEqual([612, 792]);
});

test('PDF refuses text it has no font for', async ({ page }) => {
  await open(page, 'japanese.md');
  await pick(page, 'pdf');
  await page.click('#primary');
  expect(await failure(page)).toContain('no font');
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
});

test('that text still converts to formats that carry no font', async ({ page }) => {
  await open(page, 'japanese.md');
  const { bytes } = await convertAndRead(page, 'docx', 100_000);
  expect(documentText(bytes, 'docx')).toContain('日本語');
});

test('a damaged DOCX fails loudly', async ({ page }) => {
  await open(page, 'corrupt.docx');
  await pick(page, 'html');
  await page.click('#primary');
  expect(await failure(page)).toContain('damaged');
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
});

test('PDF is never offered as a document input route', async ({ page }) => {
  await open(page, 'sample.pdf');
  await expect(page.locator('input[name=target]')).toHaveCount(2);
  await expect(page.locator('input[name=target][value=docx]')).toHaveCount(0);
});

test('cancelling a document conversion leaves the page usable', async ({ page }) => {
  await open(page, 'sample.docx');
  await pick(page, 'pdf');
  await page.click('#primary');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-state', /file|done/);
  if (await page.locator('body').getAttribute('data-state') === 'file') {
    const { bytes } = await convertAndRead(page, 'html', 100_000);
    expect(bytes.length).toBeGreaterThan(0);
  }
});

test('the size shows before the first load on a phone', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: browser.browserType().name() !== 'firefox', viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query) => (query === '(pointer: coarse)' ? { matches: true } as MediaQueryList : real(query));
  });
  await page.goto('/');
  await open(page, 'sample.docx');
  await expect(page.locator('#meta')).toContainText(/\d+ MB download/);
  await context.close();
});
