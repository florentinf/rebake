import { cpus } from 'node:os';

/**
 * Known browser gaps. A listed conversion must really be unavailable: `media.spec.ts`
 * checks that the target isn't offered, so a browser update can't leave a stale
 * entry hiding something that works. Checked on macOS, November 2026. Linux WebKit has no entries, because it isn't Safari: its media tests run on macOS.
 */
interface Gap {
  browsers: string[];
  inputs: RegExp;
  targets: string[];
  reason: string;
}

/** M1 and M2 have no AV1 decoder, and WebKit has no software one. The macOS CI runner is an M1. */
const NO_AV1_HARDWARE = /Apple M[12]\b/.test(cpus()[0]?.model ?? '');

const NO_HEVC = 'no HEVC decoder here, so it can be copied but not re-encoded';

export const GAPS: Gap[] = [
  ...(NO_AV1_HARDWARE ? [{ browsers: ['webkit'], inputs: /^av1/, targets: ['mov', 'gif'], reason: 'No AV1 decoder on this chip, so it can be copied but not re-encoded' }] : []),
  { browsers: ['firefox'], inputs: /^(hevc|hdr)/, targets: ['webm', 'gif'], reason: `Firefox 159: ${NO_HEVC}` },
  { browsers: ['chromium'], inputs: /^(hevc|hdr)/, targets: ['webm', 'gif'], reason: `Playwright's Chromium build: ${NO_HEVC}. Real Chrome has it and runs as the "chrome" project` },
];

export function gapFor(browser: string, input: string, target: string): string | null {
  const gap = GAPS.find((entry) => entry.browsers.includes(browser) && entry.inputs.test(input) && entry.targets.includes(target));
  return gap?.reason ?? null;
}
