import { expect, test } from '@playwright/test';
import { captureSaves, convertAndRead, open } from './lib/harness';

/**
 * Principle 3: a chip is a promise. `isConfigSupported` can say yes to an encoder
 * that then writes a broken stream, so this runs everywhere the suite runs, on
 * whichever encoders each browser really has, Linux WebKit included.
 */
for (const input of ['h264-aac.mp4', 'sample.mp3', 'sample.m4a']) {
  test(`every target offered for ${input} converts`, async ({ page }) => {
    test.setTimeout(180_000);
    await captureSaves(page);
    await page.goto('/');
    await open(page, input);
    const targets = await page.locator('input[name=target]').evaluateAll((inputs) => inputs.map((chip) => (chip as HTMLInputElement).value));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      await test.step(target, async () => {
        await page.goto('/');
        await open(page, input);
        const { name, bytes } = await convertAndRead(page, target);
        expect(name.endsWith(`.${target}`)).toBe(true);
        expect(bytes.length).toBeGreaterThan(0);
      });
    }
  });
}
