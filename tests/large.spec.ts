import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fixture, hasFixture, open, pick } from './lib/harness';
import { inspectPath } from './lib/probe';

// `npm run fixtures:large`, then `REBAKE_LARGE=1 npx playwright test tests/large.spec.ts --workers=1`.
// One worker on purpose: the memory numbers read every Playwright browser process.
const LARGE = 'large.mov';
test.skip(!process.env.REBAKE_LARGE || !hasFixture(LARGE), 'needs REBAKE_LARGE=1 and the 1 GB fixture');
test.describe.configure({ mode: 'serial', timeout: 1_800_000 });

/**
 * Physical footprint across every Playwright browser process, from `top`. RSS would
 * count clean file-backed pages. macOS only, which is where this suite runs.
 */
function browserMemory() {
  const table = execFileSync('ps', ['-A', '-o', 'pid=,command='], { maxBuffer: 1e8 }).toString();
  const pids = table.split('\n').filter((line) => line.includes('ms-playwright') && !line.includes(' ps ')).map((line) => line.trim().split(/\s+/)[0]!);
  const out = execFileSync('top', ['-l', '1', '-stats', 'pid,mem', ...pids.flatMap((pid) => ['-pid', pid])], { maxBuffer: 1e8 }).toString();
  let bytes = 0;
  for (const line of out.split('\n')) {
    const match = /^(\d+)\s+(\d+(?:\.\d+)?)([KMG])/.exec(line.trim());
    if (match && pids.includes(match[1]!)) bytes += Number(match[2]) * { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[match[3] as 'K' | 'M' | 'G'];
  }
  return bytes;
}

/** Takes the baseline first, then starts the job. A remux is over in seconds. */
async function peakDuring<T>(start: () => Promise<T>) {
  const baseline = browserMemory();
  const finished = start();
  let peak = baseline;
  let running = true;
  const sampler = (async () => {
    while (running) {
      peak = Math.max(peak, browserMemory());
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })();
  const result = await finished;
  running = false;
  await sampler;
  return { baseline, peak, growth: peak - baseline, result };
}

const MB = 1e6;

/**
 * Peak growth allowed. A 3.9 GB file peaked no higher than this 1.3 GB one when
 * measured by hand, so these are ceilings, not a share of the file. Firefox runs
 * highest because its worker collects garbage late, in a sawtooth under 2 GB.
 */
const CEILING: Record<string, number> = { chromium: 1200 * MB, firefox: 2200 * MB, webkit: 1000 * MB };

/**
 * A persistent profile, because a default Playwright context is ephemeral. There,
 * as in an incognito window, Chromium keeps the private file system in memory.
 */
let context: BrowserContext;
let page: Page;

test.beforeEach(async ({ playwright, browserName }) => {
  context = await playwright[browserName].launchPersistentContext(mkdtempSync(join(tmpdir(), 'rebake-large-')), { acceptDownloads: true });
  page = await context.newPage();
});

test.afterEach(async () => {
  await context.close();
});

/** Stands in for the native dialog: a private file, written through the same `createWritable`. */
async function stubPicker(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { showSaveFilePicker(): Promise<FileSystemFileHandle> }).showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('picked.bin', { create: true });
      (window as unknown as { __picked: FileSystemFileHandle }).__picked = handle;
      return handle;
    };
  });
}

/** Walks the top-level boxes of the file written to disk: `mdat` must span the real payload. */
const pickedBoxes = (page: Page) => page.evaluate(async () => {
  const handle = (window as unknown as { __picked: FileSystemFileHandle }).__picked;
  const file = await handle.getFile();
  const boxes: string[] = [];
  let at = 0;
  while (at < file.size) {
    const head = new DataView(await file.slice(at, at + 16).arrayBuffer());
    const small = head.getUint32(0);
    const name = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    const size = small === 1 ? Number(head.getBigUint64(8)) : small;
    if (!size) break;
    boxes.push(name);
    at += size;
  }
  return { boxes, size: file.size, ended: at === file.size };
});

test('1 GB MOV → MP4 remux streams to the chosen file with flat memory', async ({ browserName }, info) => {
  test.skip(browserName !== 'chromium', 'File System Access is Chromium-only');
  await stubPicker(page);
  await page.goto('/');
  await open(page, LARGE);
  const memory = await peakDuring(async () => {
    await page.click('#primary');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'done', { timeout: 900_000 });
  });
  info.annotations.push({ type: 'memory', description: `+${Math.round(memory.growth / MB)} MB` });
  expect(memory.growth).toBeLessThan(CEILING[browserName]!);
  const { boxes, size, ended } = await pickedBoxes(page);
  expect(ended).toBe(true);
  expect(boxes).toEqual(expect.arrayContaining(['ftyp', 'mdat', 'moov']));
  expect(size).toBeGreaterThan(statSync(fixture(LARGE)).size * 0.98);
});

test('1 GB MOV → MP4 without a picker warns first, then downloads with flat memory', async ({ browserName }, info) => {
  await page.addInitScript(() => { delete (window as unknown as Record<string, unknown>).showSaveFilePicker; });
  await page.goto('/');
  await open(page, LARGE);
  if (browserName !== 'chromium') await expect(page.locator('#meta')).toContainText('Large: needs free disk space');
  const memory = await peakDuring(async () => {
    const started = page.waitForEvent('download', { timeout: 900_000 });
    await page.click('#primary');
    return started;
  });
  const download = memory.result;
  info.annotations.push({ type: 'memory', description: `+${Math.round(memory.growth / MB)} MB` });
  expect(memory.growth).toBeLessThan(CEILING[browserName]!);
  const path = info.outputPath('large.mp4');
  await download.saveAs(path);
  const media = inspectPath(path, { decode: false });
  expect(media).toMatchObject({ video: 'h264', audio: 'aac', width: 1920, height: 1080 });
  expect(media.duration).toBeGreaterThan(75);
});

test('1 GB re-encode keeps memory flat', async ({ browserName }, info) => {
  await page.addInitScript(() => { delete (window as unknown as Record<string, unknown>).showSaveFilePicker; });
  await page.goto('/');
  await open(page, LARGE);
  await pick(page, 'mkv');
  await page.click('#more');
  await page.locator('label:has(input[name=preset][value=small])').click();
  await page.locator('label:has(input[name=resolution][value="480"])').click();
  const memory = await peakDuring(async () => {
    const started = page.waitForEvent('download', { timeout: 1_500_000 });
    await page.click('#primary');
    return started;
  });
  const download = memory.result;
  info.annotations.push({ type: 'memory', description: `+${Math.round(memory.growth / MB)} MB` });
  expect(memory.growth).toBeLessThan(CEILING[browserName]!);
  const path = info.outputPath('large.mkv');
  await download.saveAs(path);
  expect(inspectPath(path, { decode: false })).toMatchObject({ video: 'h264', height: 480 });
});

test('cancelling a big job leaves no temp file behind', async () => {
  await page.addInitScript(() => { delete (window as unknown as Record<string, unknown>).showSaveFilePicker; });
  await page.goto('/');
  await open(page, LARGE);
  await page.click('#primary');
  await expect.poll(async () => Number((await page.textContent('#progress-text'))?.match(/\d+/)?.[0] ?? 0), { timeout: 120_000 }).toBeGreaterThan(5);
  await page.click('#secondary');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'file');
  await expect.poll(() => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const spool = await root.getDirectoryHandle('rebake-spool', { create: true });
    let count = 0;
    for await (const _ of (spool as unknown as { keys(): AsyncIterable<string> }).keys()) count++;
    return count;
  })).toBe(0);
});
