# Deploying

`.github/workflows/ci.yml` deploys `dist/` to Cloudflare as static assets after the tests pass on `main`, using the exact build they ran against. There's no Worker script, so no rebake code runs on Cloudflare. `npm run deploy` does the same by hand. Both need `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Headers live in `public/_headers`, and `scripts/serve.mjs` reads the same file, so the tests run against production headers.

## After a deploy

1. Run `REBAKE_URL=https://rebake.app npx playwright test`.
2. Confirm the site sets no cookies and injects no scripts. On the Cloudflare zone, keep analytics, Bot Fight Mode, rate limits and email obfuscation off: they'd add cookies or scripts, and per-IP limits can't tell a school class from one abuser.
3. Check the public URLs and the social preview.
4. Run the real device check below before announcing home-screen installation.

## Generated pages

The production build renders page-specific search and social metadata, canonical URLs, a crawlable format index, `sitemap.xml` and `robots.txt`. `/support` is a static, script-free page: reporting opens a user-editable email with nothing collected automatically. It's available offline once the service worker installs.

To be listed, verify ownership in Google Search Console and Bing Webmaster Tools and submit `/sitemap.xml`.

## Regenerating assets

`npm run brand` rebuilds the PNG icons and social card from `public/icon.svg`. `npm run font` rebuilds the subset interface font, and needs fonttools and brotli in `.venv`.

## Real device check

Run once on an iPhone (Safari) and once on an Android phone (Chrome), on https://rebake.app. Automated tests can't cover this.

**Prepare on the phone:** a HEIC or JPG photo, a camera video, a voice memo, a real DOCX with images in it, a PDF and a CSV. Save them to the device, not a cloud folder. Clear rebake's site data so the first load is real.

**1. Online, first visit.** Drop each file and read the meta line before tapping Convert. The size must appear before anything downloads.

| Category | Job | Shown first | Works | Offline |
| --- | --- | --- | --- | --- |
| Images | Photo → PNG | ~2 MB (HEIC or JPG) | ☐ | ☐ |
| Video | Video → MP4 | Nothing | ☐ | ☐ |
| Audio | Voice memo → MP3 | ~110 KB | ☐ | ☐ |
| Documents | DOCX → PDF | 29 MB | ☐ | ☐ |
| PDF | PDF → JPG | 1.5 MB | ☐ | ☐ |
| Data | CSV → JSON | Nothing | ☐ | ☐ |

Size shown correctly: ☐ iPhone ☐ Android

**2. Offline.** Turn on airplane mode, and make sure Wi-Fi and Bluetooth are off too. Fully close the browser, reopen rebake, and repeat all six jobs.

**Each output must open** in the phone's own app. In the DOCX → PDF, the images must be there. Any job that fails: note the phone, OS version, file and exact message.
