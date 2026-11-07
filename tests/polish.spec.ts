import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { captureSaves, convertAndRead, fixture, open } from './lib/harness';

/** The drawer's controls can't take focus until it has finished opening. */
const settled = (page: Page) => page.waitForFunction(() => document.getElementById('options')!.getAnimations({ subtree: true }).length === 0 && document.getElementById('options')!.getBoundingClientRect().height > 44);

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test.describe('at 360 px', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  for (const path of ['/', '/markdown-to-docx', '/privacy', '/nope']) {
    test(`${path} has no side scroll`, async ({ page }) => {
      await page.goto(path);
      expect(await noSideScroll(page)).toBe(true);
    });
  }

  test('format chips stay on one line and 44 px tall', async ({ page }) => {
    await page.goto('/');
    await open(page, 'sample.docx');
    expect(await noSideScroll(page)).toBe(true);
    const heights = await page.locator('#targets .target span').evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().height));
    expect(heights.every((height) => height === 44)).toBe(true);
  });

  test('the open drawer has no side scroll', async ({ page }) => {
    await page.goto('/');
    await open(page, 'sample.xlsx');
    await page.click('#more');
    expect(await noSideScroll(page)).toBe(true);
  });
});

test('every control is at least 44 px tall', async ({ page }) => {
  await page.goto('/');
  await open(page, 'sample.pdf');
  await page.click('#more');
  await settled(page);
  for (const selector of ['#primary', '#more', '.mark a', '.promise a >> nth=0', '#pages', '.add', '.row-remove']) {
    const box = await page.locator(selector).boundingBox();
    expect(Math.round(box!.height), selector).toBeGreaterThanOrEqual(44);
  }
});

test('keyboard order runs from the mark through the job to the footer', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', "WebKit skips links on Tab by default");
  await page.goto('/');
  await open(page, 'sample.pdf');
  await page.click('#more');
  await settled(page);
  await page.locator('.mark a').focus();
  const order: string[] = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLInputElement;
      return element.id || element.name || element.textContent || '';
    }));
  }
  expect(order).toEqual(['', 'Add files', 'target', 'more', 'dpi', 'transparency', 'pages', 'primary', 'Free and open source', 'Privacy']);
});

test('focus lands on the next action after each state change', async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
  await open(page, 'sample.csv');
  await expect(page.locator('#primary')).toBeFocused();
  await convertAndRead(page, 'json');
  await expect(page.locator('#primary')).toBeFocused();
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' } as never);

  test('nothing animates across a state change', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await captureSaves(page);
    await page.goto('/');
    await open(page, 'sample.csv');
    const long = await page.evaluate(() => document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return Number(timing?.duration ?? 0) > 1 && timing?.iterations !== 0;
    }).length);
    expect(long).toBe(0);
  });
});

/** Clicks something inside the page and reads a box on every frame for half a second. */
const framesAfterClick = (page: Page, click: string, read: string, edge: 'left' | 'height') => page.evaluate(async ([click, read, edge]) => {
  (document.querySelector(click) as HTMLElement).click();
  const seen: number[] = [];
  const end = performance.now() + 500;
  while (performance.now() < end) {
    await new Promise(requestAnimationFrame);
    seen.push(Math.round(document.querySelector(read)!.getBoundingClientRect()[edge as 'left' | 'height']));
  }
  return seen;
}, [click, read, edge]);

/** More than a start and an end: something was on screen in between. */
const inBetween = (seen: number[]) => new Set(seen.slice(1, -1).filter((value) => value !== seen[0] && value !== seen.at(-1))).size;

test.describe('motion', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });

  test('a choice in Options slides like the format picker', async ({ page }) => {
    await open(page, 'sample.mp3');
    await page.click('#more');
    await settled(page);
    expect(inBetween(await framesAfterClick(page, 'input[name=channels][value="2"]', '.seg:has(input[name=channels]) .seg-mark', 'left'))).toBeGreaterThan(3);
  });

  test('rows that come and go glide, both ways', async ({ page }) => {
    await open(page, 'sample.png');
    await page.locator('label:has(input[name=target][value=webp])').click();
    await page.click('#more');
    await settled(page);
    expect(inBetween(await framesAfterClick(page, 'input[name=compression][value=lossless]', '#quality-field', 'height'))).toBeGreaterThan(3);
    await expect(page.locator('#quality-field')).toBeHidden();
    expect(inBetween(await framesAfterClick(page, 'input[name=compression][value=lossy]', '#quality-field', 'height'))).toBeGreaterThan(3);
    await expect(page.locator('#quality-field')).toBeVisible();
  });

  test('Reset options arrives on the same glide, and reads as a button', async ({ page }) => {
    await open(page, 'sample.mp3');
    await page.click('#more');
    await settled(page);
    expect(inBetween(await framesAfterClick(page, 'input[name=channels][value="2"]', '#reset-options', 'height'))).toBeGreaterThan(3);
    const box = await page.locator('#reset-options').boundingBox();
    expect(Math.round(box!.height)).toBe(44);
    const background = await page.locator('#reset-options').evaluate((button) => getComputedStyle(button).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('a note and a removed file leave smoothly too', async ({ page }) => {
    await open(page, 'sample.gif');
    await page.locator('label:has(input[name=target][value=jpg])').click();
    await expect(page.locator('#plan-note')).toContainText('still image');
    await page.waitForTimeout(500);
    expect(inBetween(await framesAfterClick(page, 'input[name=target][value=webp]', '#plan-note', 'height'))).toBeGreaterThan(3);
    await page.keyboard.press('Escape');
    await page.setInputFiles('#picker', ['sample.png', 'sample.jpg'].map(fixture));
    await expect(page.locator('.row')).toHaveCount(2);
    await page.waitForTimeout(500);
    expect(inBetween(await framesAfterClick(page, '.row-remove', '.row', 'height'))).toBeGreaterThan(3);
    await expect(page.locator('.row')).toHaveCount(1);
  });
});

/** A snap: one frame moving much further than the frames before it, as a layout correction does. */
function snaps(seen: number[]) {
  const steps = seen.slice(1).map((value, index) => value - seen[index]!);
  return steps.flatMap((step, index) => {
    const before = Math.max(Math.abs(steps[index - 1] ?? 0), Math.abs(steps[index - 2] ?? 0));
    return index > 2 && Math.abs(step) >= 2 && Math.abs(step) > before * 2.2 ? [`frame ${index}: ${step}px after ${before}px`] : [];
  });
}

/** Everything below the job moves with what changes, so this watches Convert for 1.4 s. */
const convertFrames = (page: Page, click: string) => page.evaluate(async (click) => {
  (document.querySelector(click) as HTMLElement).click();
  const seen: number[] = [];
  const end = performance.now() + 1400;
  while (performance.now() < end) {
    await new Promise(requestAnimationFrame);
    seen.push(Math.round(document.getElementById('primary')!.getBoundingClientRect().top));
  }
  return seen;
}, click);

test.describe('nothing corrects itself after it has finished moving', () => {
  // Frames can drop on a busy machine, and a dropped frame reads as a large step.
  test.describe.configure({ retries: 1 });
  // Tall enough that Convert never sticks: leaving the bottom edge starts at full speed, which isn't a snap.
  test.use({ viewport: { width: 1280, height: 1100 } });
  test.beforeEach(async ({ page }) => { await page.goto('/'); });
  const target = (format: string) => `input[name=target][value=${format}]`;

  test('switching formats with Options open', async ({ page }) => {
    await open(page, 'sample.png');
    await page.click('#more');
    await settled(page);
    for (const format of ['webp', 'png', 'jpg', 'gif', 'pdf', 'webp']) {
      expect(snaps(await convertFrames(page, target(format))), format).toEqual([]);
    }
  });

  test('rows and Reset options', async ({ page }) => {
    await open(page, 'sample.pdf');
    await page.click('#more');
    await settled(page);
    expect(snaps(await convertFrames(page, 'input[name=dpi][value=custom]'))).toEqual([]);
    expect(snaps(await convertFrames(page, 'input[name=dpi][value="150"]'))).toEqual([]);
    await page.fill('#pages', '1');
    await page.waitForTimeout(1200);
    expect(snaps(await convertFrames(page, '#reset-options'))).toEqual([]);
  });

  test('a video moving to GIF and back keeps Options open', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit' && process.platform === 'linux', "WebKit's GStreamer codecs on Linux aren't Safari's, so GIF isn't offered there");
    await open(page, 'long.mp4');
    await page.click('#more');
    await settled(page);
    for (const format of ['gif', 'webm', 'gif', 'mp4']) {
      expect(snaps(await convertFrames(page, target(format))), format).toEqual([]);
      await expect(page.locator('#more')).toHaveAttribute('aria-expanded', 'true');
    }
  });
});

test('nothing sits on top of the finished job\'s buttons', async ({ page }) => {
  await captureSaves(page);
  await page.goto('/');
  await open(page, 'sample.csv');
  await convertAndRead(page, 'json');
  for (const id of ['download-again', 'change-format']) {
    const edge = await page.locator(`#${id}`).evaluate((button) => {
      const box = button.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + 1) === button;
    });
    expect(edge, id).toBe(true);
  }
});

test('hovering the drop zone barely changes its tone, in either theme', async ({ page }) => {
  const paint = () => page.locator('#zone').evaluate((zone) => {
    const context = new OffscreenCanvas(1, 1).getContext('2d')!;
    context.fillStyle = getComputedStyle(zone).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[0]!;
  });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const rest = await paint();
    await page.locator('#zone-title').hover();
    await page.waitForTimeout(300);
    expect(Math.abs(await paint() - rest), colorScheme).toBeLessThan(8);
  }
});

test('dark mode is a real theme on every kind of page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['/', '/privacy', '/nope']) {
    await page.goto(path);
    // Browsers report oklch() in different notations, so read the colour as paint.
    const red = await page.evaluate(() => {
      const context = new OffscreenCanvas(1, 1).getContext('2d')!;
      context.fillStyle = getComputedStyle(document.body).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[0]!;
    });
    expect(red, path).toBeLessThan(32);
  }
});

test('the third-party notice names every engine and every runtime library', async () => {
  const notice = readFileSync('docs/THIRD_PARTY.md', 'utf8').toLowerCase();
  const manifest = JSON.parse(readFileSync('vendor/manifest.json', 'utf8')) as Record<string, { version: string }>;
  const names: Record<string, string> = {
    vips: 'wasm-vips', libheif: 'libheif-js', mp3: '@mediabunny/mp3-encoder', aac: '@mediabunny/aac-encoder',
    flac: '@mediabunny/flac-encoder', typst: 'typst.ts', fonts: 'typst-assets', pandoc: 'pandoc', pdfjs: 'pdf.js', pdflib: 'pdf-lib', xlsx: 'sheetjs',
  };
  for (const [pkg, { version }] of Object.entries(manifest)) {
    expect(names[pkg], `${pkg} needs a name here`).toBeTruthy();
    expect(notice, pkg).toContain(names[pkg]!);
    expect(notice, `${pkg} version`).toContain(version.toLowerCase());
  }
  for (const library of ['mediabunny', 'client-zip', 'gifenc', 'papa parse', 'yaml', 'browser_wasi_shim', 'fflate', 'hanken grotesk']) {
    expect(notice, library).toContain(library);
  }
});
