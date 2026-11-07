import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { captureSaves, fixture, pick } from './lib/harness';
import { inspectPath, withFile } from './lib/probe';

test.describe.configure({ retries: 1 });

const finished = async (page: import('@playwright/test').Page) => {
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done', { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => window.__saved?.length ?? 0)).toBeGreaterThan(0);
  return page.evaluate(() => window.__saved!.at(-1)!);
};

function unzip(base64: string, name: string, use: (dir: string) => void) {
  withFile(Buffer.from(base64, 'base64'), name, (path) => {
    const dir = `${path}.out`;
    execFileSync('unzip', ['-q', path, '-d', dir]);
    use(dir);
  });
}

test.beforeEach(async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
});

test('a long batch of phone photos all converts', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine, so one browser');
  const buffer = readFileSync(fixture('flat-24mp.jpg'));
  const files = Array.from({ length: 30 }, (_, i) => ({ name: `photo-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer }));
  await page.setInputFiles('#picker', files);
  await expect(page.locator('#from')).toHaveText('30 JPG');
  await pick(page, 'png');
  await page.click('#primary');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'done', { timeout: 50_000 });
  await expect(page.locator('#meta.error')).toHaveCount(0);
  await expect(page.locator('.row.ok')).toHaveCount(30);
});

test('several videos come back as one ZIP', async ({ page }) => {
  await page.setInputFiles('#picker', ['h264-aac.mov', 'vp9-opus.webm', 'h264-aac.mkv'].map(fixture));
  await expect(page.locator('#from')).toHaveText('3 files');
  await pick(page, 'mp4');
  await page.click('#primary');
  const saved = await finished(page);
  expect(saved.name).toBe('rebake.zip');
  unzip(saved.base64, saved.name, (dir) => {
    expect(execFileSync('ls', [dir]).toString().trim().split('\n').sort()).toEqual(['h264-aac (2).mp4', 'h264-aac.mp4', 'vp9-opus.mp4']);
    expect(inspectPath(`${dir}/vp9-opus.mp4`).video).toBe('h264');
  });
  await expect(page.locator('#to')).toHaveText('ZIP');
});

test('a batch of images works too', async ({ page }) => {
  await page.setInputFiles('#picker', ['sample.png', 'sample.jpg'].map(fixture));
  await pick(page, 'webp');
  await page.click('#primary');
  const saved = await finished(page);
  unzip(saved.base64, saved.name, (dir) => {
    expect(execFileSync('ls', [dir]).toString().trim().split('\n').sort()).toEqual(['sample (2).webp', 'sample.webp']);
  });
});

test('files with nothing in common are refused', async ({ page }) => {
  await page.setInputFiles('#picker', ['sample.png', 'sample.mp3'].map(fixture));
  await expect(page.locator('#meta.error')).toHaveText('These files have no format in common.');
});

test('audio and video share only audio targets', async ({ page }) => {
  await page.setInputFiles('#picker', ['h264-aac.mp4', 'sample.wav'].map(fixture));
  await expect(page.locator('input[name=target][value=webm]')).toHaveCount(0);
  await expect(page.locator('input[name=target][value=mp3]')).toHaveCount(1);
});

test('an unreadable file in a batch is skipped and said so', async ({ page }) => {
  await page.setInputFiles('#picker', ['sample.png', 'sample.jpg', 'notes.txt'].map(fixture));
  await expect(page.locator('#meta')).toContainText('1 skipped');
});

test('cancel works during a batch, and the page stays usable', async ({ page }) => {
  await page.setInputFiles('#picker', ['long.mp4', 'h264-aac.mov'].map(fixture));
  await expect(page.locator('input[name=target][value=mkv]')).toHaveCount(1);
  test.skip(await page.locator('input[name=target][value=webm]').count() === 0, 'this browser cannot write WebM');
  await pick(page, 'webm');
  await page.click('#primary');
  await expect(page.locator('#progress-text')).toContainText('1 of 2');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
  await pick(page, 'mkv');
  await page.click('#primary');
  const saved = await finished(page);
  expect(saved.name).toBe('rebake.zip');
});

test('a batch with a GIF-sized limit loses the target instead of failing later', async ({ page }) => {
  await page.setInputFiles('#picker', ['long.mp4', 'h264-aac.mov'].map(fixture));
  await expect(page.locator('input[name=target][value=gif]')).toHaveCount(0);
});
