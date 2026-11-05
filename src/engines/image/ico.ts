/** ICO is the one format here libvips has no codec for, and it's small enough to do by hand. */

export interface RgbaImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export type IcoEntry = { kind: 'png'; bytes: Uint8Array } | ({ kind: 'rgba' } & RgbaImage);

/** Reads the largest image out of an ICO or CUR. */
export function readIco(buffer: ArrayBuffer): IcoEntry {
  const view = new DataView(buffer);
  const count = view.getUint16(4, true);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const width = view.getUint8(at) || 256;
    const height = view.getUint8(at + 1) || 256;
    const bits = view.getUint16(at + 6, true);
    const score = width * height * 64 + bits;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best < 0) throw new Error('ICO has no images');
  const entry = 6 + best * 16;
  const size = view.getUint32(entry + 8, true);
  const offset = view.getUint32(entry + 12, true);
  const bytes = new Uint8Array(buffer, offset, size);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { kind: 'png', bytes };
  return { kind: 'rgba', ...readDib(buffer, offset) };
}

function readDib(buffer: ArrayBuffer, offset: number): RgbaImage {
  const view = new DataView(buffer, offset);
  const headerSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const height = Math.abs(view.getInt32(8, true)) / 2; // doubled to include the AND mask
  const bits = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  if (compression !== 0 && compression !== 3) throw new Error('Unsupported ICO compression');
  const paletteSize = bits <= 8 ? (view.getUint32(32, true) || 1 << bits) : 0;
  const palette = headerSize;
  const pixels = palette + paletteSize * 4;
  const stride = Math.floor((width * bits + 31) / 32) * 4;
  const maskStride = Math.floor((width + 31) / 32) * 4;
  const mask = pixels + stride * height;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const row = pixels + (height - 1 - y) * stride;
    const maskRow = mask + (height - 1 - y) * maskStride;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let b: number, g: number, r: number, a = 255;
      if (bits === 32) {
        b = view.getUint8(row + x * 4);
        g = view.getUint8(row + x * 4 + 1);
        r = view.getUint8(row + x * 4 + 2);
        a = view.getUint8(row + x * 4 + 3);
      } else if (bits === 24) {
        b = view.getUint8(row + x * 3);
        g = view.getUint8(row + x * 3 + 1);
        r = view.getUint8(row + x * 3 + 2);
      } else if (bits === 8 || bits === 4 || bits === 1) {
        const bitOffset = x * bits;
        const byte = view.getUint8(row + (bitOffset >> 3));
        const index = (byte >> (8 - bits - (bitOffset & 7))) & ((1 << bits) - 1);
        b = view.getUint8(palette + index * 4);
        g = view.getUint8(palette + index * 4 + 1);
        r = view.getUint8(palette + index * 4 + 2);
      } else {
        throw new Error(`Unsupported ICO bit depth ${bits}`);
      }
      if (bits !== 32) {
        const masked = (view.getUint8(maskRow + (x >> 3)) >> (7 - (x & 7))) & 1;
        a = masked ? 0 : 255;
      }
      data.set([r, g, b, a], out);
    }
  }
  return { data, width, height };
}

/** Wraps PNG-encoded images into an ICO. PNG entries are valid from Windows Vista on. */
export function writeIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const headerBytes = 6 + images.length * 16;
  const total = images.reduce((sum, image) => sum + image.png.length, headerBytes);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = headerBytes;
  images.forEach(({ size, png }, i) => {
    const at = 6 + i * 16;
    view.setUint8(at, size >= 256 ? 0 : size);
    view.setUint8(at + 1, size >= 256 ? 0 : size);
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(png, offset);
    offset += png.length;
  });
  return out;
}
