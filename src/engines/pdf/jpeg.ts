const SOS = 0xda;
const APP1 = 0xe1;
const APP2_ICC = 0xe2;
const APP14_ADOBE = 0xee;

interface Segment {
  marker: number;
  at: number;
  length: number;
}

/** Walks the header segments up to the image data. Empty when this isn't a JPEG we can read. */
function segments(b: Uint8Array): Segment[] {
  const found: Segment[] = [];
  let at = 2;
  while (at + 4 <= b.length && b[at] === 0xff) {
    const marker = b[at + 1]!;
    if (marker === SOS) break;
    const length = (b[at + 2]! << 8) | b[at + 3]!;
    found.push({ marker, at, length: length + 2 });
    at += length + 2;
  }
  return found;
}

/** The EXIF orientation tag. 1 means the pixels are already upright. */
export function jpegOrientation(b: Uint8Array): number {
  const exif = segments(b).find(({ marker, at }) =>
    marker === APP1 && String.fromCharCode(...b.subarray(at + 4, at + 8)) === 'Exif');
  if (!exif) return 1;
  const tiff = exif.at + 10;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const little = view.getUint16(tiff) === 0x4949;
  const entries = tiff + view.getUint32(tiff + 4, little);
  const count = view.getUint16(entries, little);
  for (let i = 0; i < count; i++) {
    const entry = entries + 2 + i * 12;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return 1;
}

/** Removes EXIF, GPS, XMP and comments without touching the image data. */
export function stripJpeg(b: Uint8Array): Uint8Array<ArrayBuffer> {
  const dropped = segments(b).filter(({ marker }) =>
    (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef)) && marker !== APP2_ICC && marker !== APP14_ADOBE);
  const kept: Uint8Array[] = [];
  let at = 0;
  for (const segment of dropped) {
    kept.push(b.subarray(at, segment.at));
    at = segment.at + segment.length;
  }
  kept.push(b.subarray(at));
  const output = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of kept) {
    output.set(part, position);
    position += part.length;
  }
  return output;
}
