import { expect, test } from '@playwright/test';
import { captureSaves, convertAndRead, open } from './lib/harness';

const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'; form-action 'none'";

const EVERY_CATEGORY = [
  ['sample.png', 'avif'], ['h264-aac.mov', 'mp4'], ['sample.wav', 'mp3'],
  ['sample.docx', 'pdf'], ['sample.pdf', 'png'], ['sample.png', 'pdf'], ['sample.xlsx', 'csv'], ['sample.json', 'yaml'],
] as const;

test('no request leaves the origin in any category', async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const requests: { url: string; method: string }[] = [];
  context.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  await captureSaves(page);
  await page.goto('/');
  const before = requests.length;
  for (const [file, target] of EVERY_CATEGORY) {
    await open(page, file);
    await convertAndRead(page, target, 100_000);
    await page.click('#primary');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'empty');
  }

  for (const { url, method } of requests) {
    if (url.startsWith('blob:') || url.startsWith('data:')) continue;
    expect(new URL(url).origin).toBe(origin);
    expect(method).toBe('GET');
  }
  // Conversions may fetch engine files, and the service worker may still be precaching the shell.
  for (const { url } of requests.slice(before)) {
    if (url.startsWith('blob:')) continue;
    expect(new URL(url).pathname).toMatch(/^\/((engines|assets)\/.*|icon\.svg|manifest\.webmanifest|sw\.js|privacy)?$/);
  }
});

test('the CSP blocks outbound connections', async ({ page }) => {
  await page.goto('/');
  const outcome = await page.evaluate(() => fetch('https://example.com/').then(() => 'sent', () => 'blocked'));
  expect(outcome).toBe('blocked');
});

test('the server sends the headers from the spec', async ({ page, request }) => {
  await page.goto('/');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const home = await request.get('/');
  expect(home.headers()['content-security-policy']).toBe(CSP);
  expect(home.headers()['cross-origin-opener-policy']).toBe('same-origin');
  expect(home.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(home.headers()['cache-control']).toBe('no-cache');
});

test('no cookies, and storage holds only the last target', async ({ page, context }) => {
  await captureSaves(page);
  await page.goto('/');
  await open(page, 'sample.png');
  await convertAndRead(page, 'webp');
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['rebake.target']);
});
