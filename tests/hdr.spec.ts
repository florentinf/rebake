import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureSaves, convertAndRead, fixture, hasFixture, open, pick } from './lib/harness';
import { frameStats, inspectPath, packetHash, withFile } from './lib/probe';

test.describe.configure({ retries: 1 });

/**
 * `flat` is the same frame with its HDR signal shown as if it were SDR, which is
 * what an encoder gets if nobody tone-maps it. A correct frame is more saturated.
 */
function expectToneMapped(got: { luma: number; chroma: number }, flat: { luma: number; chroma: number }) {
  expect(got.chroma).toBeGreaterThan(flat.chroma * 1.05);
  expect(got.luma).toBeGreaterThan(flat.luma * 0.6);
}

/** Big outputs go through a real download: pushing them through the page as base64 wouldn't fit. */
async function downloaded(page: Page, name: string, info: TestInfo) {
  await page.evaluate(() => { window.__realDownloads = true; });
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 300_000 }), page.click('#primary')]);
  const path = info.outputPath(name);
  await download.saveAs(path);
  return path;
}

const canReEncode = async (page: Page) => await page.locator('input[name=target][value=webm]').count() > 0;

test.beforeEach(async ({ page }) => {
  await captureSaves(page);
  // The clip is over 100 MB, and a native save dialog can't be driven from here.
  await page.addInitScript(() => { delete (window as unknown as Record<string, unknown>).showSaveFilePicker; });
  await page.goto('/');
});

for (const name of ['hdr-hlg.mov', 'hevc-aac.mov']) {
  test(`${name} → MP4 stays HEVC and copies every packet, in every browser`, async ({ page }) => {
    await open(page, name);
    const { bytes, name: output } = await convertAndRead(page, 'mp4');
    await expect(page.locator('#meta')).toHaveAttribute('data-path', 'copy:hevc');
    withFile(bytes, output, (path) => {
      expect(inspectPath(path).video).toBe('hevc');
      expect(packetHash(path, 'v:0')).toBe(packetHash(fixture(name), 'v:0'));
    });
  });
}

test('a browser without HEVC says why, and copying still works', async ({ page }) => {
  await open(page, 'hevc-aac.mov');
  test.skip(await canReEncode(page), 'this browser reads HEVC');
  await expect(page.locator('#meta')).toContainText("This browser can't read HEVC video.");
  await expect(page.locator('#meta')).toContainText('Use Safari or Chrome.');
  await expect(page.locator('#primary')).toBeEnabled();
});

test('a browser without HEVC refuses edits that need decoding', async ({ page }) => {
  await open(page, 'hevc-aac.mov');
  test.skip(await canReEncode(page), 'this browser reads HEVC');
  await page.click('#more');
  await page.locator('label:has(input[name=preset][value=small])').click();
  await page.click('#primary');
  await expect(page.locator('#meta.error')).toContainText("can't read HEVC video");
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
});

for (const [name, seconds] of [['hdr-hlg.mov', 1], ['hdr-pq.mp4', 1]] as const) {
  test(`${name} → WebM is tone-mapped to SDR, not left flat and grey`, async ({ page }) => {
    await open(page, name);
    test.skip(!(await canReEncode(page)), 'this browser cannot read HEVC');
    const { bytes, name: output } = await convertAndRead(page, 'webm');
    withFile(bytes, output, (path) => {
      const media = inspectPath(path);
      expect(media.video).toBe('vp9');
      expectToneMapped(frameStats(path, seconds), frameStats(fixture(name), seconds));
    });
  });
}

test.describe('real iPhone clip', () => {
  const clip = 'real/iphone-hevc-hdr.mov';
  test.skip(!hasFixture(clip), 'needs a real iPhone HDR clip');
  test.setTimeout(420_000);

  test('MOV → MP4 is instant and lossless', async ({ page }, info) => {
    await open(page, clip);
    await expect(page.locator('input[name=target]:checked')).toHaveValue('mp4');
    const path = await downloaded(page, 'clip.mp4', info);
    const media = inspectPath(path, { decode: false });
    expect(media).toMatchObject({ video: 'hevc', audio: 'aac', width: 3840, height: 2160 });
    expect(packetHash(path, 'v:0')).toBe(packetHash(fixture(clip), 'v:0'));
  });

  test('a short trim re-encodes to a clean SDR WebM', async ({ page }) => {
    await open(page, clip);
    test.skip(!(await canReEncode(page)), 'this browser cannot read HEVC');
    await page.click('#more');
    await page.fill('#trim-start', '1');
    await page.fill('#trim-end', '2');
    await page.locator('label:has(input[name=resolution][value="720"])').click();
    const { bytes, name } = await convertAndRead(page, 'webm', 300_000);
    withFile(bytes, name, (path) => {
      const media = inspectPath(path);
      expect(media.video).toBe('vp9');
      expect(Math.min(media.width!, media.height!)).toBe(720);
      expectToneMapped(frameStats(path, 0.5), frameStats(fixture(clip), 1.5));
    });
  });

  test('extracts the AAC track, ignoring the spatial track', async ({ page }, info) => {
    await open(page, clip);
    await pick(page, 'm4a');
    expect(inspectPath(await downloaded(page, 'clip.m4a', info), { decode: false }).audio).toBe('aac');
  });
});
