import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const FIXTURES = resolve(process.env.REBAKE_FIXTURES ?? '../rebake-fixtures');
export const fixture = (name: string) => resolve(FIXTURES, name);
export const hasFixture = (name: string) => existsSync(fixture(name));

declare global {
  interface Window { __saved?: { name: string; base64: string }[]; __realDownloads?: boolean }
}

const logged = new WeakMap<Page, string[]>();
const errors = (page: Page) => {
  if (!logged.has(page)) logged.set(page, []);
  return logged.get(page)!;
};

/**
 * Records what the app hands to the download anchor. Playwright's Firefox loses
 * .webp/.avif/.jxl blob downloads on any page, so the conversion matrix reads
 * bytes here; real downloads have their own test in each browser.
 */
export async function captureSaves(page: Page) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors(page).push(message.text().slice(0, 300));
  });
  await page.addInitScript(() => {
    window.__saved = [];
    // The app's own CSP blocks fetch(blob:), so keep the Blob itself.
    const blobs = new Map<string, Blob>();
    const createObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = createObjectURL(blob);
      blobs.set(url, blob as Blob);
      return url;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      if (!blob || !this.download || window.__realDownloads) return click.call(this);
      const name = this.download;
      void blob.arrayBuffer().then((buffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        window.__saved!.push({ name, base64: btoa(binary) });
      });
    };
  });
}

/** Waits for the app to report a failure, and returns its text. */
export async function failure(page: Page) {
  await expect(page.locator('#meta.error')).toBeVisible({ timeout: 45_000 });
  return page.locator('#meta').textContent();
}

export async function open(page: Page, file: string) {
  await page.setInputFiles('#picker', fixture(file));
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
}

export const pick = (page: Page, target: string) =>
  page.locator(`label:has(input[name=target][value=${target}])`).click();

/** Converts and returns the bytes handed to the sink. */
export async function convertAndRead(page: Page, target: string, timeout = process.env.CI ? 100_000 : 45_000) {
  await pick(page, target);
  await page.click('#primary');
  // A failed job reports the app's own words and the console, not just a state that never came.
  await expect.poll(async () => {
    const failed = await page.locator('#meta.error').count();
    if (failed) return `${await page.locator('#meta').textContent()} ${errors(page).join(' | ')}`;
    return page.locator('body').getAttribute('data-state');
  }, { timeout }).toBe('done');
  await expect.poll(() => page.evaluate(() => window.__saved?.length ?? 0)).toBeGreaterThan(0);
  const saved = await page.evaluate(() => window.__saved!.at(-1)!);
  return { name: saved.name, bytes: new Uint8Array(Buffer.from(saved.base64, 'base64')) };
}
