import { expect, test } from '@playwright/test';
import { captureSaves, convertAndRead, hasFixture, open } from './lib/harness';
import { readHeader } from './lib/inspect';

const WRITABLE = ['jpg', 'png', 'webp', 'avif', 'jxl', 'tiff', 'gif', 'ico'] as const;
const INPUTS: [string, string, [number, number]][] = [
  ['sample.jpg', 'jpg', [240, 160]],
  ['sample.png', 'png', [240, 160]],
  ['sample.webp', 'webp', [240, 160]],
  ['sample.avif', 'avif', [240, 160]],
  ['sample.gif', 'gif', [240, 160]],
  ['sample.tiff', 'tiff', [240, 160]],
  ['sample.jxl', 'jxl', [240, 160]],
  ['sample.heic', 'heic', [240, 160]],
  ['sample.svg', 'svg', [1024, 683]],
  ['sample.ico', 'ico', [48, 48]],
];

test.beforeEach(async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
});

for (const [file, input, [width, height]] of INPUTS) {
  for (const target of WRITABLE) {
    if (target === input) continue;
    test(`${input} → ${target}`, async ({ page }) => {
      test.skip(!hasFixture(file), `${file} not generated (HEIC fixtures need macOS)`);
      await open(page, file);
      const { name, bytes } = await convertAndRead(page, target);
      const header = await readHeader(bytes);

      expect(header.format).toBe(target);
      expect(name.endsWith(`.${target}`)).toBe(true);
      if (target === 'ico') {
        expect(header.entries).toContain(Math.min(256, Math.max(...(header.entries ?? []))));
        expect(Math.max(...header.entries!)).toBeLessThanOrEqual(Math.max(width, height));
      } else {
        expect([header.width, header.height]).toEqual([width, height]);
      }
    });
  }
}

test('EXIF rotation is applied, then metadata is stripped', async ({ page }) => {
  await open(page, 'rotated.jpg');
  const { bytes } = await convertAndRead(page, 'png');
  const header = await readHeader(bytes);
  expect([header.width, header.height]).toEqual([160, 240]);
  expect(Buffer.from(bytes).includes('rebake-fixture-marker')).toBe(false);
});

test('metadata stays when stripping is turned off', async ({ page }) => {
  await open(page, 'rotated.jpg');
  await page.click('#more');
  await page.locator('#strip').uncheck();
  const { bytes } = await convertAndRead(page, 'webp');
  expect(Buffer.from(bytes).includes('rebake-fixture-marker')).toBe(true);
});

test('max width resizes and keeps aspect', async ({ page }) => {
  await open(page, 'sample.png');
  await page.click('#more');
  await page.fill('#max-width', '120');
  const { bytes } = await convertAndRead(page, 'jpg');
  const header = await readHeader(bytes);
  expect([header.width, header.height]).toEqual([120, 80]);
});

test('animation survives GIF → WebP', async ({ page }) => {
  await open(page, 'animated.gif');
  const { bytes } = await convertAndRead(page, 'webp');
  const header = await readHeader(bytes);
  expect(header.pages).toBe(2);
  expect(header.height).toBe(160);
});

test('animated GIF → JPG takes the first frame', async ({ page }) => {
  await open(page, 'animated.gif');
  const { bytes } = await convertAndRead(page, 'jpg');
  const header = await readHeader(bytes);
  expect([header.width, header.height]).toEqual([240, 160]);
});

test('real iPhone HEIC → JPG', async ({ page }, info) => {
  test.skip(!hasFixture('real/IMG_8565.HEIC'), 'needs a real iPhone photo');
  test.setTimeout(120_000);
  await open(page, 'real/IMG_8565.HEIC');
  const { bytes } = await convertAndRead(page, 'jpg', 90_000);
  const header = await readHeader(bytes);
  expect(header.format).toBe('jpg');
  expect([header.width, header.height].sort()).toEqual([3024, 4032].sort());
  expect(header.orientation).toBe(1);
  expect(Buffer.from(bytes).includes('iPhone')).toBe(false);
  await info.attach('decoder', { body: (await page.getAttribute('#meta', 'data-path')) ?? '' });
});

test('real 48 MP iPhone HEIC → JPG', async ({ page }) => {
  test.skip(!hasFixture('real/IMG_7151.HEIC'), 'needs a real iPhone photo');
  test.setTimeout(150_000);
  await open(page, 'real/IMG_7151.HEIC');
  const { bytes } = await convertAndRead(page, 'jpg', 120_000);
  const header = await readHeader(bytes);
  expect([header.width, header.height].sort()).toEqual([6048, 8064].sort());
});
