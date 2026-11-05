import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { captureSaves, convertAndRead, open } from './lib/harness';

/** The drawer's controls can't take focus until it has finished opening. */
const settled = (page: Page) => page.waitForFunction(() => document.getElementById('options')!.getAnimations({ subtree: true }).length === 0 && document.getElementById('options')!.getBoundingClientRect().height > 44);

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe('at 360 px', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  for (const path of ['/', '/markdown-to-docx', '/privacy', '/nope']) {
    test(`${path} has no side scroll`, async ({ page }) => {
      await page.goto(path);
      expect(await noSideScroll(page)).toBe(true);
    });
  }

  test('format chips stay on one line and 44 px tall', async ({ page }) => {
    await page.goto('/');
    await open(page, 'sample.docx');
    expect(await noSideScroll(page)).toBe(true);
    const heights = await page.locator('#targets .target span').evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().height));
    expect(heights.every((height) => height === 44)).toBe(true);
  });

  test('the open drawer has no side scroll', async ({ page }) => {
    await page.goto('/');
    await open(page, 'sample.xlsx');
    await page.click('#more');
    expect(await noSideScroll(page)).toBe(true);
  });
});

test('every control is at least 44 px tall', async ({ page }) => {
  await page.goto('/');
  await open(page, 'sample.pdf');
  await page.click('#more');
  await settled(page);
  for (const selector of ['#primary', '#more', '.mark a', '.promise a', '#pages']) {
    const box = await page.locator(selector).boundingBox();
    expect(Math.round(box!.height), selector).toBeGreaterThanOrEqual(44);
  }
});

test('keyboard order runs from the mark through the job to the footer', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', "WebKit skips links on Tab by default");
  await page.goto('/');
  await open(page, 'sample.pdf');
  await page.click('#more');
  await settled(page);
  await page.locator('.mark a').focus();
  const order: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLInputElement;
      return element.id || element.name || element.textContent || '';
    }));
  }
  expect(order).toEqual(['target', 'more', 'pages', 'primary', 'Files never leave this device.']);
});

test('focus lands on the next action after each state change', async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
  await open(page, 'sample.csv');
  await expect(page.locator('#primary')).toBeFocused();
  await convertAndRead(page, 'json');
  await expect(page.locator('#primary')).toBeFocused();
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' } as never);

  test('nothing animates across a state change', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await captureSaves(page);
    await page.goto('/');
    await open(page, 'sample.csv');
    const long = await page.evaluate(() => document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return Number(timing?.duration ?? 0) > 1 && timing?.iterations !== 0;
    }).length);
    expect(long).toBe(0);
  });
});

test('dark mode is a real theme on every kind of page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['/', '/privacy', '/nope']) {
    await page.goto(path);
    // Browsers report oklch() in different notations, so read the colour as paint.
    const red = await page.evaluate(() => {
      const context = new OffscreenCanvas(1, 1).getContext('2d')!;
      context.fillStyle = getComputedStyle(document.body).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[0]!;
    });
    expect(red, path).toBeLessThan(32);
  }
});

test('THIRD_PARTY.md names every engine and every runtime library', async () => {
  const notice = readFileSync('THIRD_PARTY.md', 'utf8').toLowerCase();
  const manifest = JSON.parse(readFileSync('vendor/manifest.json', 'utf8')) as Record<string, { version: string }>;
  const names: Record<string, string> = {
    vips: 'wasm-vips', libheif: 'libheif-js', mp3: '@mediabunny/mp3-encoder', aac: '@mediabunny/aac-encoder',
    flac: '@mediabunny/flac-encoder', typst: 'typst.ts', fonts: 'typst-assets', pandoc: 'pandoc', pdfjs: 'pdf.js', pdflib: 'pdf-lib', xlsx: 'sheetjs',
  };
  for (const [pkg, { version }] of Object.entries(manifest)) {
    expect(names[pkg], `${pkg} needs a name here`).toBeTruthy();
    expect(notice, pkg).toContain(names[pkg]!);
    expect(notice, `${pkg} version`).toContain(version.toLowerCase());
  }
  for (const library of ['mediabunny', 'client-zip', 'gifenc', 'papa parse', 'yaml', 'browser_wasi_shim', 'fflate', 'schibsted grotesk']) {
    expect(notice, library).toContain(library);
  }
});
