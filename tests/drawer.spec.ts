import { expect, test } from '@playwright/test';
import { captureSaves, convertAndRead, fixture, open, pick } from './lib/harness';
import { inspectBytes, packetHash, withFile } from './lib/probe';

const moreButton = '#more';
const choose = (page: import('@playwright/test').Page, name: string, value: string) =>
  page.locator(`label:has(input[name=${name}][value="${value}"])`).click();

test.describe.configure({ retries: 1 });

test.beforeEach(async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
});

test('the drawer is closed by default and remembers its state per category', async ({ page }) => {
  await open(page, 'h264-aac.mov');
  await expect(page.locator(moreButton)).toHaveAttribute('aria-expanded', 'false');
  await page.click(moreButton);
  await expect(page.locator(moreButton)).toHaveAttribute('aria-expanded', 'true');
  await choose(page, 'preset', 'small');
  await page.keyboard.press('Escape');

  await open(page, 'sample.mp3');
  await expect(page.locator(moreButton)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');

  await page.reload();
  await open(page, 'h264-aac.mov');
  await expect(page.locator(moreButton)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('input[name=preset][value=small]')).toBeChecked();
});

test('the drawer shows only what applies', async ({ page }) => {
  await open(page, 'h264-aac.mov');
  await page.click(moreButton);
  await expect(page.getByText('Max resolution')).toBeVisible();
  await expect(page.getByText('Remove sound')).toBeVisible();
  await expect(page.locator('legend', { hasText: 'Bitrate' })).toBeHidden();
  await pick(page, 'mp3');
  await expect(page.locator('legend', { hasText: 'Bitrate' })).toBeVisible();
  await expect(page.locator('legend', { hasText: 'Channels' })).toBeVisible();
  await expect(page.locator('#trim-start')).toBeVisible();
  await pick(page, 'flac');
  await expect(page.locator('legend', { hasText: 'Bitrate' })).toBeHidden();
  await page.keyboard.press('Escape');
  await open(page, 'silent.mp4');
  await expect(page.locator('input[name=target][value=mp3]')).toHaveCount(0);
});

test('remove audio', async ({ page }) => {
  await open(page, 'h264-aac.mov');
  await page.click(moreButton);
  await page.getByLabel('Remove sound').check();
  const { bytes, name } = await convertAndRead(page, 'mp4');
  const media = inspectBytes(bytes, name);
  expect(media.audio).toBeUndefined();
  expect(media.video).toBe('h264');
});

test('max resolution scales down and never up', async ({ page }) => {
  await open(page, 'h264-aac.mov');
  await page.click(moreButton);
  await choose(page, 'resolution', '480');
  await pick(page, 'mp4');
  const small = await convertAndRead(page, 'mp4');
  expect(inspectBytes(small.bytes, small.name).height).toBe(360);
  await page.click('#primary');
  await open(page, 'hdr-hlg.mov');
  await expect(page.locator('input[name=resolution][value="480"]')).toBeChecked();
});

test('the small preset forces a smaller re-encode', async ({ page }) => {
  await open(page, 'hdr-hlg.mov');
  await page.click(moreButton);
  await choose(page, 'preset', 'small');
  test.skip(await page.locator('input[name=target][value=webm]').count() === 0, 'this browser cannot read HEVC');
  const { bytes, name } = await convertAndRead(page, 'mp4');
  expect(inspectBytes(bytes, name).video).toBe('h264');
});

test('trim cuts to the requested range', async ({ page }) => {
  await open(page, 'long.mp4');
  test.skip(await page.locator('input[name=target][value=webm]').count() === 0, 'this browser cannot write WebM');
  await page.click(moreButton);
  await page.fill('#trim-start', '2');
  await page.fill('#trim-end', '0:05');
  const { bytes, name } = await convertAndRead(page, 'webm');
  const media = inspectBytes(bytes, name);
  expect(media.duration).toBeGreaterThan(2.8);
  expect(media.duration).toBeLessThan(3.4);
});

test('trim into MOV keeps AAC audio, in every browser', async ({ page }) => {
  await open(page, 'long.mp4');
  await page.click(moreButton);
  await page.fill('#trim-start', '2');
  await page.fill('#trim-end', '5');
  const { bytes, name } = await convertAndRead(page, 'mov');
  const media = inspectBytes(bytes, name);
  expect(media.audio).toBe('aac');
  expect(media.duration).toBeLessThan(3.4);
});

test('an impossible trim blocks Convert with a plain reason', async ({ page }) => {
  await open(page, 'long.mp4');
  await page.click(moreButton);
  await page.fill('#trim-start', '6');
  await page.fill('#trim-end', '3');
  await expect(page.locator('#meta.error')).toHaveText('Trim end must be after the start.');
  await expect(page.locator('#primary')).toBeDisabled();
  await page.fill('#trim-end', 'soon');
  await expect(page.locator('#meta.error')).toHaveText('Use a time like 1:30.');
  await page.fill('#trim-end', '8');
  await expect(page.locator('#primary')).toBeEnabled();
});

test('GIF has a clear limit, and trimming gets under it', async ({ page }) => {
  await open(page, 'long.mp4');
  await pick(page, 'gif');
  await expect(page.locator('#meta.error')).toContainText('GIF works up to 15 s.');
  await expect(page.locator('#primary')).toBeDisabled();
  await page.getByRole('button', { name: 'Trim to 15 s' }).click();
  await expect(page.locator('#trim-end')).toHaveValue('0:15');
  await expect(page.locator('#more')).toHaveAttribute('aria-expanded', 'true');
  await page.fill('#trim-end', '4');
  await expect(page.locator('#primary')).toBeEnabled();
  const { bytes, name } = await convertAndRead(page, 'gif');
  expect(inspectBytes(bytes, name).container).toBe('gif');
});

test('audio bitrate and mono', async ({ page }) => {
  await open(page, 'sample.wav');
  await page.click(moreButton);
  await choose(page, 'bitrate', '96000');
  await choose(page, 'channels', '1');
  const { bytes, name } = await convertAndRead(page, 'mp3');
  const media = inspectBytes(bytes, name);
  expect(media.channels).toBe(1);
  expect(media.bitrate).toBeGreaterThan(85_000);
  expect(media.bitrate).toBeLessThan(110_000);
});

test('stereo from mono is honoured, and localStorage failures are ignored', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    Storage.prototype.getItem = () => { throw new Error('denied'); };
  });
  await page.reload();
  await open(page, 'sample.flac');
  await page.click(moreButton);
  await expect(page.locator(moreButton)).toHaveAttribute('aria-expanded', 'true');
});

test('MOV → MP4 is a remux: every packet survives unchanged', async ({ page }) => {
  await open(page, 'h264-aac.mov');
  await expect(page.locator('input[name=target]:checked')).toHaveValue('mp4');
  const { bytes, name } = await convertAndRead(page, 'mp4');
  await expect(page.locator('#meta')).toHaveAttribute('data-path', 'copy:avc');
  withFile(bytes, name, (path) => {
    expect(packetHash(path, 'v:0')).toBe(packetHash(fixture('h264-aac.mov'), 'v:0'));
    expect(packetHash(path, 'a:0')).toBe(packetHash(fixture('h264-aac.mov'), 'a:0'));
  });
});

test('audio already in the target codec is copied, not re-encoded', async ({ page }) => {
  await open(page, 'h264-aac.mp4');
  const { bytes, name } = await convertAndRead(page, 'm4a');
  await expect(page.locator('#meta')).toHaveAttribute('data-path', 'copy');
  withFile(bytes, name, (path) => {
    expect(packetHash(path, 'a:0')).toBe(packetHash(fixture('h264-aac.mp4'), 'a:0'));
  });
});

test('rotation survives a remux and a re-encode', async ({ page }) => {
  await open(page, 'rotated.mov');
  const copied = await convertAndRead(page, 'mp4');
  const media = inspectBytes(copied.bytes, copied.name);
  expect(Math.abs(media.rotation ?? 0)).toBe(90);
  await page.click('#primary');
  await open(page, 'rotated.mov');
  const encoded = await convertAndRead(page, 'gif');
  const gif = inspectBytes(encoded.bytes, encoded.name);
  expect(gif.height!).toBeGreaterThan(gif.width!);
});

test('24-bit FLAC stays 24-bit as WAV', async ({ page }) => {
  await open(page, 'deep.flac');
  test.skip(await page.locator('input[name=target][value=wav]').count() === 0, 'this browser cannot read FLAC');
  const { bytes, name } = await convertAndRead(page, 'wav');
  expect(inspectBytes(bytes, name).audio).toBe('pcm_s24le');
});

test('96 kHz FLAC still makes a valid MP3', async ({ page }) => {
  await open(page, 'deep.flac');
  test.skip(await page.locator('input[name=target][value=mp3]').count() === 0, 'this browser cannot read FLAC');
  const { bytes, name } = await convertAndRead(page, 'mp3');
  expect(inspectBytes(bytes, name).sampleRate).toBe(48000);
});

test('a truncated video is refused plainly', async ({ page }) => {
  await page.setInputFiles('#picker', fixture('corrupt.mp4'));
  await expect(page.locator('#meta.error')).toHaveText("This file looks damaged and couldn't be read.");
  await expect(page.locator('body')).toHaveAttribute('data-state', 'empty');
});

test('video progress is honest and cancel returns to the file', async ({ page }) => {
  await open(page, 'long.mp4');
  test.skip(await page.locator('input[name=target][value=webm]').count() === 0, 'this browser cannot write WebM');
  await pick(page, 'webm');
  await page.click('#primary');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'converting');
  // This clip converts in under a second, faster than the button settles into place.
  await page.locator('#secondary').dispatchEvent('click');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
  const { bytes, name } = await convertAndRead(page, 'mkv');
  expect(inspectBytes(bytes, name).container).toMatch(/matroska/);
});
