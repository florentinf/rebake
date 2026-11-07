const SOS = 0xda;
const APP1 = 0xe1;
const APP2_ICC = 0xe2;
const APP14_ADOBE = 0xee;

interface Segment {
  marker: number;
  at: number;
  length: number;
}

/** Walks the header segments up to the image data. Null when this isn't a JPEG we can read. */
function segments(b: Uint8Array): Segment[] | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const found: Segment[] = [];
  let at = 2;
  while (at + 4 <= b.length && b[at] === 0xff) {
    while (b[at + 1] === 0xff) at++;
    const marker = b[at + 1]!;
    if (marker === SOS) break;
    if (marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = (b[at + 2]! << 8) | b[at + 3]!;
    if (length < 2 || at + length + 2 > b.length) return null;
    found.push({ marker, at, length: length + 2 });
    at += length + 2;
  }
  return found;
}

/** The EXIF orientation tag. 1 means the pixels are already upright. */
export function jpegOrientation(b: Uint8Array): number {
  const header = segments(b);
  if (!header) return 0;
  const exif = header.find(({ marker, at }) =>
    marker === APP1 && String.fromCharCode(...b.subarray(at + 4, at + 8)) === 'Exif');
  if (!exif) return 1;
  // Unknown/broken orientation opts out of copying. The decoder can still recover the picture.
  try {
    const tiff = exif.at + 10;
    const end = exif.at + exif.length;
    if (tiff + 8 > end) return 0;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const order = view.getUint16(tiff);
    if (order !== 0x4949 && order !== 0x4d4d) return 0;
    const little = order === 0x4949;
    if (view.getUint16(tiff + 2, little) !== 42) return 0;
    const entries = tiff + view.getUint32(tiff + 4, little);
    if (entries < tiff + 8 || entries + 2 > end) return 0;
    const count = view.getUint16(entries, little);
    if (entries + 2 + count * 12 > end) return 0;
    for (let i = 0; i < count; i++) {
      const entry = entries + 2 + i * 12;
      if (view.getUint16(entry, little) === 0x0112) {
        if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) return 0;
        const orientation = view.getUint16(entry + 8, little);
        return orientation >= 1 && orientation <= 8 ? orientation : 0;
      }
    }
    return 1;
  } catch { return 0; }
}

/** Removes EXIF, GPS, XMP and comments without touching the image data. */
export function stripJpeg(b: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = segments(b);
  if (!header) throw new Error('The JPEG header is damaged.');
  const dropped = header.filter(({ marker }) =>
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
