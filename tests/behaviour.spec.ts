import { expect, test } from '@playwright/test';
import { captureSaves, convertAndRead, fixture, hasFixture, open, pick } from './lib/harness';

test('a real download arrives under the right name', async ({ page }) => {
  await page.goto('/');
  await open(page, 'sample.png');
  await pick(page, 'jpg');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#primary')]);
  expect(download.suggestedFilename()).toBe('sample.jpg');
  expect(await download.failure()).toBeNull();
});

test('the smart default is preselected', async ({ page }) => {
  test.skip(!hasFixture('sample.heic'), 'HEIC fixtures need macOS');
  await page.goto('/');
  await open(page, 'sample.heic');
  await expect(page.locator('input[name=target]:checked')).toHaveValue('jpg');
  await expect(page.locator('#from')).toHaveText('HEIC');
  await expect(page.locator('#to')).toHaveText('JPG');
});

test('HEIC is never offered as a target', async ({ page }) => {
  await page.goto('/');
  await open(page, 'sample.png');
  await expect(page.locator('input[name=target][value=heic]')).toHaveCount(0);
  await expect(page.locator('input[name=target][value=svg]')).toHaveCount(0);
});

test('the last-used target is remembered', async ({ page }) => {
  await page.goto('/');
  await open(page, 'sample.png');
  await pick(page, 'webp');
  await page.reload();
  await open(page, 'sample.jpg');
  await expect(page.locator('input[name=target]:checked')).toHaveValue('webp');
});

test('a file that is not an image is refused plainly', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#picker', fixture('notes.txt'));
  await expect(page.locator('#meta')).toHaveText("rebake can't open notes.txt.");
  await expect(page.locator('body')).toHaveAttribute('data-state', 'empty');
});

test('a damaged file fails loudly and leaves the page usable', async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
  await open(page, 'corrupt.png');
  await page.click('#primary');
  await expect(page.locator('#meta.error')).toHaveText("This file looks damaged and couldn't be read.");
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
  await open(page, 'sample.png');
  await convertAndRead(page, 'jpg');
});

test('dropping a file on the window opens it, with the zone reacting during drag', async ({ page }) => {
  await page.goto('/');
  const transfer = await page.evaluateHandle(async () => {
    const data = new DataTransfer();
    data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'], 'dot.svg', { type: 'image/svg+xml' }));
    return data;
  });
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
  await expect(page.locator('body')).toHaveClass(/dragging/);
  await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });
  await expect(page.locator('body')).not.toHaveClass(/dragging/);
  await expect(page.locator('#from')).toHaveText('SVG');
});

test('cancel stops a running job at once and the next job works', async ({ page }) => {
  test.skip(!hasFixture('real/IMG_7151.HEIC'), 'needs a real iPhone photo');
  await captureSaves(page);
  await page.goto('/');
  await open(page, 'real/IMG_7151.HEIC');
  await pick(page, 'avif');
  await page.click('#primary');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'converting');
  await expect(page.locator('#secondary')).toHaveText('Cancel');
  await page.click('#secondary');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file', { timeout: 2000 });
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
  await page.keyboard.press('Escape');
  await open(page, 'sample.png');
  await convertAndRead(page, 'jpg');
});

test('a crashed worker is replaced and the page survives', async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
  await open(page, 'sample.png');
  await convertAndRead(page, 'jpg');
  const worker = page.workers().find((w) => /worker-/.test(w.url()));
  expect(worker).toBeTruthy();
  await worker!.evaluate(() => { setTimeout(() => { throw new Error('boom'); }); });
  await page.waitForTimeout(200);
  await page.click('#primary');
  await open(page, 'sample.png');
  await page.evaluate(() => { window.__saved = []; });
  await convertAndRead(page, 'webp');
});

test.describe('keyboard and pointer access', () => {
  test('the whole flow works from the keyboard', async ({ page, browserName }) => {
    await captureSaves(page);
    await page.goto('/');
    await page.setInputFiles('#picker', fixture('sample.png'));
    await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
    await expect(page.locator('#primary')).toBeFocused();
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await expect(page.locator('input[name=target]:focus')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#to')).not.toHaveText('');
    await page.locator('#primary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
    await expect(page.locator('#primary')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'empty');
  });

  test('every control is at least 44 px tall on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/');
    await open(page, 'sample.png');
    await page.click('#more');
    const boxes = await page.locator('button:visible, .target span:visible, input[type=number]:visible, input[type=range]:visible, .check:visible').all();
    expect(boxes.length).toBeGreaterThan(8);
    for (const box of boxes) {
      const size = await box.boundingBox();
      expect(Math.round(size!.height * 10) / 10).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
  });

  test('reduced motion removes the layout animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await open(page, 'sample.png');
    const animations = await page.evaluate(() => document.getAnimations().filter((a) => a.id === 'flip').length);
    expect(animations).toBe(0);
  });
});
