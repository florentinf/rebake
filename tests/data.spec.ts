import { expect, test } from '@playwright/test';
import Papa from 'papaparse';
import { parse } from 'yaml';
import { captureSaves, convertAndRead, failure, fixture, open, pick } from './lib/harness';

const RECORDS = [{ id: '007', name: 'Zoë', note: 'has, a comma' }, { id: 42, name: 'Bob', note: 'says "hi"' }];
const ROWS = [['id', 'name', 'note'], ['007', 'Zoë', 'has, a comma'], ['42', 'Bob', 'says "hi"']];
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString();
const table = (bytes: Uint8Array, delimiter: string) => Papa.parse<string[]>(text(bytes).trim(), { delimiter }).data;
const FORMATS = ['csv', 'tsv', 'json', 'yaml'] as const;

test.beforeEach(async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
});

for (const input of FORMATS) {
  for (const target of FORMATS) {
    if (target === input) continue;
    test(`${input} → ${target}`, async ({ page }) => {
      await open(page, `sample.${input}`);
      const { name, bytes } = await convertAndRead(page, target);
      expect(name).toBe(`sample.${target}`);
      if (target === 'json') expect(JSON.parse(text(bytes))).toEqual(RECORDS);
      if (target === 'yaml') expect(parse(text(bytes))).toEqual(RECORDS);
      if (target === 'csv') expect(table(bytes, ',')).toEqual(ROWS);
      if (target === 'tsv') expect(table(bytes, '\t')).toEqual(ROWS);
    });
  }
}

test('xlsx → csv takes the first sheet', async ({ page }) => {
  await open(page, 'sample.xlsx');
  await expect(page.locator('input[name=target]')).toHaveCount(1);
  const { bytes } = await convertAndRead(page, 'csv');
  expect(table(bytes, ',').map((row) => row.join('|'))).toEqual(['id|name|note', '007|Zoë|has, a comma', '42|Bob|says "hi"']);
});

test('the drawer picks another sheet', async ({ page }) => {
  await open(page, 'sample.xlsx');
  await page.click('#more');
  await page.locator('label:has(input[name=sheet][value=Beta])').click();
  const { bytes } = await convertAndRead(page, 'csv');
  expect(text(bytes)).toContain('beta-marker');
  expect(text(bytes)).not.toContain('Zoë');
});

test('nested records become dotted columns, and long integers keep every digit', async ({ page }) => {
  await open(page, 'nested.json');
  const { bytes } = await convertAndRead(page, 'csv');
  expect(table(bytes, ',')).toEqual([['id', 'who.name', 'who.age', 'tags'], ['9007199254740993', 'A', '3', '["x","y"]']]);
});

test('long integers survive JSON to YAML', async ({ page }) => {
  await open(page, 'nested.json');
  const { bytes } = await convertAndRead(page, 'yaml');
  expect(text(bytes)).toContain('9007199254740993');
});

test('JSON that is not a table refuses CSV in plain words', async ({ page }) => {
  await open(page, 'scalar.json');
  await pick(page, 'csv');
  await page.click('#primary');
  expect(await failure(page)).toContain("isn't a list of records");
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
});

test('broken JSON names the line', async ({ page }) => {
  await open(page, 'bad.json');
  await pick(page, 'yaml');
  await page.click('#primary');
  expect(await failure(page)).toMatch(/^This JSON has a syntax error( on line \d)?\.$/);
});

test('a batch of data files comes back as one ZIP', async ({ page }) => {
  await page.setInputFiles('#picker', ['sample.csv', 'sample.tsv'].map(fixture));
  const { name } = await convertAndRead(page, 'json');
  expect(name).toBe('rebake.zip');
});

const LOCKED = 'This file is password-protected. Remove the password, then try again.';

test('a password-protected XLSX says so on open', async ({ page }) => {
  await page.setInputFiles('#picker', fixture('locked.xlsx'));
  await expect(page.locator('#meta.error')).toHaveText(LOCKED, { timeout: 45_000 });
  await expect(page.locator('input[name=target]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
});

test('a password-protected XLSX says so on convert', async ({ page }) => {
  // Opening reads the workbook first, so to reach convert this answers the sheet list in its place.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, message: { id: number; method: string }, ...rest: never[]) {
      if (message?.method !== 'sheets') return post.call(this, message, ...rest);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, kind: 'result', result: ['Sheet1'] } })));
    } as typeof post;
  });
  await page.goto('/');
  await open(page, 'locked.xlsx');
  await page.click('#primary');
  expect(await failure(page)).toBe(LOCKED);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
  expect(await page.evaluate(() => window.__saved!.length)).toBe(0);
});
