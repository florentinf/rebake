// Regenerates the PNG icons and the social card from public/icon.svg and the
// bundled font (`npm run brand`). Uses Playwright's Chromium.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const ICONS = [['icon-32', 32], ['apple-touch-icon', 180], ['icon-192', 192], ['icon-512', 512], ['icon-maskable', 512]];

const CARD_STYLE = `
  @font-face { font-family: h; src: url(data:font/woff2;base64,__FONT__); }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f9f8f6; color: #292724; font-family: h, sans-serif; padding: 64px 80px; }
  header { font-size: 36px; font-weight: 600; }
  h1 { font-size: 84px; letter-spacing: -2.5px; line-height: 1.08; font-weight: 600; margin: 76px 0 24px; }
  p { font-size: 32px; color: #6b665f; margin: 0; }
  svg { position: absolute; width: 112px; height: 112px; right: 80px; top: 64px; }`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const mark = await readFile('public/icon.svg', 'utf8');

for (const [name, size] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  // A maskable icon fills its square and keeps the mark inside the safe zone.
  const svg = name === 'icon-maskable' ? mark.replace('rx="7"', 'rx="0"').replace('<path', '<path transform="translate(4 4) scale(.75)"') : mark;
  await page.setContent(`<style>body{margin:0}svg{width:100vw;height:100vh;display:block}</style>${svg}`);
  await page.screenshot({ path: `public/${name}.png` });
}

const font = (await readFile('src/assets/fonts/hanken-grotesk.woff2')).toString('base64');
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<style>${CARD_STYLE.replace('__FONT__', font)}</style><header>rebake</header>${mark}<h1>Convert files without<br>sending them anywhere.</h1><p>Free and open source.</p>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'public/social.png' });
await browser.close();
