import { expect, test } from '@playwright/test';
import { allLinks, linkFromPath, pagePath } from '../src/core/links';
import { FORMATS } from '../src/core/formats';
import { captureSaves, convertAndRead, hasFixture, open } from './lib/harness';

test('every routing-table row has a static page with its title and target', async ({ request }) => {
  for (const link of allLinks()) {
    const path = pagePath(link);
    expect(linkFromPath(path)).toEqual(link);
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    const [from, to] = [FORMATS[link.from].label, FORMATS[link.to].label];
    expect(html).toContain(`<title>${from} to ${to} converter · rebake</title>`);
    expect(html).toContain(`Convert ${from} to ${to} in your browser.`);
    expect(html).toContain(`<link rel="canonical" href="https://rebake.florentinf.dev${path}" />`);
    expect(html).toContain(`<span id="to" class="to">${to}</span>`);
  }
});

test('the sitemap lists every page', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap.startsWith('<?xml')).toBe(true);
  expect(sitemap.match(/<loc>/g)).toHaveLength(allLinks().length + 2);
  expect(await (await request.get('/robots.txt')).text()).toContain('/sitemap.xml');
});

test('a deep link preselects its target, over the remembered one', async ({ page }) => {
  test.skip(!hasFixture('sample.heic'), 'HEIC fixtures need macOS');
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('rebake.target', 'png'));
  await page.goto('/heic-to-webp');
  await expect(page.locator('#from')).toHaveText('HEIC');
  await expect(page.locator('#to')).toHaveText('WebP');
  await expect(page.locator('#meta')).toHaveText('Convert HEIC to WebP in your browser.');
  await open(page, 'sample.heic');
  await expect(page.locator('input[name=target]:checked')).toHaveValue('webp');
  expect(await page.evaluate(() => localStorage.getItem('rebake.target'))).toBe('png');
});

test('a deep link ignores a target the dropped file does not have', async ({ page }) => {
  await page.goto('/docx-to-pdf');
  await open(page, 'sample.mp3');
  await expect(page.locator('input[name=target]:checked')).toHaveValue('m4a');
});

test('convert another returns to the deep link', async ({ page }) => {
  await captureSaves(page);
  await page.goto('/png-to-jpg');
  await open(page, 'sample.png');
  await convertAndRead(page, 'jpg');
  await page.click('#primary');
  await expect(page.locator('#from')).toHaveText('PNG');
  await expect(page.locator('#to')).toHaveText('JPG');
  await expect(page.locator('#meta')).toHaveText('Convert PNG to JPG in your browser.');
});

test('the privacy page says what it must', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Files never leave this device.' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  const text = await page.locator('main').innerText();
  for (const claim of ['no logs', 'no analytics', 'no cookies', 'airplane mode', 'github.com/florentinf/rebake', 'contact@florentinf.dev']) {
    expect(text).toContain(claim);
  }
  expect((await (await request.get('/privacy')).text()).includes('<script')).toBe(false);
});

test('an unknown path is a real 404', async ({ request }) => {
  const response = await request.get('/not-a-page');
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain('Not found');
});
