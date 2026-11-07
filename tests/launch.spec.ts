import { test, expect } from '@playwright/test';

test('metadata and crawlable links exist before JavaScript runs', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  for (const path of ['/', '/heic-to-jpg', '/support']) {
    await page.goto(path);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `https://rebake.app${path}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `https://rebake.app${path}`);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', await page.title());
  }
  await page.goto('/');
  expect(await page.locator('#index a[href]').count()).toBeGreaterThan(30);
  await expect(page.locator('.noscript')).toContainText('Enable JavaScript');
  await context.close();
});

test('support is voluntary, private and does not replace the conversion tab', async ({ page, context }) => {
  await page.goto('/');
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Report a problem' }).click();
  const support = await popup;
  await support.waitForLoadState();
  await expect(page).toHaveURL(/\/$/);
  await expect(support.locator('main')).toContainText('Nothing is sent automatically');
  const href = await support.getByRole('link', { name: 'Write an email' }).getAttribute('href');
  expect(href).toContain('mailto:contact@florentinf.dev?');
  expect(decodeURIComponent(href!)).toContain('remove personal details');
  expect(await support.locator('script, form, input').count()).toBe(0);
});

test('installation icons and share image are real PNGs with declared dimensions', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.id).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true);
  for (const [path, width, height] of [['/icon-192.png',192,192], ['/icon-512.png',512,512], ['/icon-maskable.png',512,512], ['/apple-touch-icon.png',180,180], ['/social.png',1200,630]] as const) {
    const response = await request.get(path);
    expect(response.headers()['content-type']).toBe('image/png');
    const bytes = await response.body();
    expect(bytes.subarray(1,4).toString()).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(width);
    expect(bytes.readUInt32BE(20)).toBe(height);
  }
});
