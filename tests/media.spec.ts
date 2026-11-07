import { expect, test, type Page } from '@playwright/test';
import { captureSaves, convertAndRead, hasFixture, open } from './lib/harness';
import { gapFor } from './lib/media-gaps';
import { inspectBytes } from './lib/probe';

/** What ffprobe must report. `video` lists every codec that target may legitimately hold. */
const CONTAINER: Record<string, { name: RegExp; video: string[]; audio: string[] }> = {
  mp4: { name: /mp4/, video: ['h264', 'hevc', 'av1'], audio: ['aac', 'mp3'] },
  mov: { name: /mov/, video: ['h264', 'hevc'], audio: ['aac', 'mp3'] },
  webm: { name: /webm/, video: ['vp9', 'av1', 'vp8'], audio: ['opus', 'vorbis'] },
  mkv: { name: /matroska/, video: ['h264', 'hevc', 'vp9', 'av1'], audio: ['aac', 'opus', 'mp3'] },
};
const AUDIO: Record<string, { name: RegExp; audio: string[] }> = {
  mp3: { name: /^mp3$/, audio: ['mp3'] },
  m4a: { name: /m4a/, audio: ['aac'] },
  opus: { name: /^ogg$/, audio: ['opus'] },
  ogg: { name: /^ogg$/, audio: ['opus', 'vorbis'] },
  flac: { name: /^flac$/, audio: ['flac'] },
  wav: { name: /^wav$/, audio: ['pcm_s16le', 'pcm_s24le'] },
};

const VIDEOS = [
  'h264-aac.mp4', 'h264-aac.mov', 'h264-aac.mkv',
  'hevc-aac.mp4', 'hevc-aac.mov', 'hevc-aac.mkv',
  'vp9-aac.mp4', 'vp9-opus.webm', 'vp9-opus.mkv',
  'av1-aac.mp4', 'av1-opus.webm', 'av1-opus.mkv',
];
const SOUNDS = ['sample.mp3', 'sample.m4a', 'sample.aac', 'sample.opus', 'opus-in.ogg', 'vorbis.ogg', 'sample.flac', 'sample.wav'];

const extension = (name: string) => name.split('.').pop()!;

async function setup(page: Page) {
  await captureSaves(page);
  await page.goto('/');
}

/**
 * Listed gaps must really be gaps: the target has to be missing, or this fails.
 * That way a browser update can't leave a stale entry hiding something that works.
 */
async function skipIfGap(page: Page, browser: string, input: string, target: string) {
  const reason = gapFor(browser, input, target);
  if (!reason) return false;
  await expect(page.locator(`input[name=target][value=${target}]`)).toHaveCount(0);
  test.info().annotations.push({ type: 'browser gap', description: reason });
  return true;
}

test.describe('video', () => {
  test.describe.configure({ retries: 1 });
  for (const input of VIDEOS) {
    for (const target of Object.keys(CONTAINER)) {
      if (target === extension(input)) continue;
      test(`${input} → ${target}`, async ({ page }, info) => {
        await setup(page);
        await open(page, input);
        if (await skipIfGap(page, info.project.name, input, target)) return;
        const { bytes, name } = await convertAndRead(page, target);
        expect(name.endsWith(`.${target}`)).toBe(true);
        const media = inspectBytes(bytes, name);
        const expected = CONTAINER[target]!;
        expect(media.container).toMatch(expected.name);
        expect(expected.video).toContain(media.video);
        expect(expected.audio).toContain(media.audio);
        expect([media.width, media.height]).toEqual([640, 360]);
        expect(media.duration).toBeGreaterThan(1.8);
        expect(media.duration).toBeLessThan(2.4);
      });
    }
  }

  for (const input of ['h264-aac.mp4', 'hevc-aac.mov', 'vp9-opus.webm', 'av1-opus.mkv']) {
    test(`${input} → gif`, async ({ page }, info) => {
      await setup(page);
      await open(page, input);
      if (await skipIfGap(page, info.project.name, input, 'gif')) return;
      const { bytes, name } = await convertAndRead(page, 'gif');
      const media = inspectBytes(bytes, name);
      expect(media.container).toBe('gif');
      expect(media.video).toBe('gif');
      expect([media.width, media.height]).toEqual([480, 270]);
    });
  }
});

test.describe('extract audio', () => {
  for (const input of ['h264-aac.mp4', 'vp9-opus.webm']) {
    for (const target of Object.keys(AUDIO)) {
      test(`${input} → ${target}`, async ({ page }, info) => {
        await setup(page);
        await open(page, input);
        if (await skipIfGap(page, info.project.name, input, target)) return;
        const { bytes, name } = await convertAndRead(page, target);
        const media = inspectBytes(bytes, name);
        expect(media.container).toMatch(AUDIO[target]!.name);
        expect(AUDIO[target]!.audio).toContain(media.audio);
        expect(media.video).toBeUndefined();
      });
    }
  }
});

test.describe('audio', () => {
  for (const input of SOUNDS) {
    for (const target of Object.keys(AUDIO)) {
      if (target === extension(input) || (target === 'm4a' && input === 'sample.m4a')) continue;
      test(`${input} → ${target}`, async ({ page }, info) => {
        test.skip(!hasFixture(input), 'needs ffmpeg fixtures');
        await setup(page);
        await open(page, input);
        if (await skipIfGap(page, info.project.name, input, target)) return;
        const { bytes, name } = await convertAndRead(page, target);
        const media = inspectBytes(bytes, name);
        expect(media.container).toMatch(AUDIO[target]!.name);
        expect(AUDIO[target]!.audio).toContain(media.audio);
        expect(media.duration).toBeGreaterThan(2.7);
        expect(media.duration).toBeLessThan(3.3);
      });
    }
  }
});
