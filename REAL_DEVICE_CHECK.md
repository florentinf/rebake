# Real device check

Run once on an iPhone (Safari) and once on an Android phone (Chrome), on https://rebake.florentinf.dev. Automated tests can't cover this.

**Prepare on the phone:** a HEIC or JPG photo, a camera video, a song or voice memo, a real DOCX with images in it, a PDF and a CSV. Save them to the device, not a cloud folder. Clear rebake's site data so the first load is real.

**1. Online, first visit.** Drop each file and read the meta line before tapping Convert. The size must appear before anything downloads.

| Category | Job | Shown first | Works | Offline |
| --- | --- | --- | --- | --- |
| Images | Photo → PNG | ~2 MB (HEIC or JPG) | ☐ | ☐ |
| Video | Video → MP4 | Nothing | ☐ | ☐ |
| Audio | Song → MP3 | ~110 KB | ☐ | ☐ |
| Documents | DOCX → PDF | 23 MB | ☐ | ☐ |
| PDF | PDF → JPG | 1.5 MB | ☐ | ☐ |
| Data | CSV → JSON | Nothing | ☐ | ☐ |

Size shown correctly: ☐ iPhone ☐ Android

**2. Offline.** Turn on airplane mode, and make sure Wi-Fi and Bluetooth are off too. Fully close the browser, reopen rebake, and repeat all six jobs.

**Each output must open** in the phone's own app. In the DOCX → PDF, the images must be there. Any job that fails: note the phone, OS version, file and exact message.
