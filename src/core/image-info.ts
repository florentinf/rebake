import type { Inspection, SourceFile } from './engine';
import { jpegOrientation } from './jpeg';

type ImageInfo = NonNullable<Inspection['image']>;

const HEADER_BYTES = 1 << 20;
const SVG_UNITS: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const ascii = (bytes: Uint8Array, at: number, size: number) => String.fromCharCode(...bytes.subarray(at, at + size));
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer);

function svgLength(text: string | null) {
  const match = /^\s*(\d*\.?\d+)\s*(px|pt|pc|in|cm|mm)?\s*$/.exec(text ?? '');
  return match ? Number(match[1]) * SVG_UNITS[match[2] ?? 'px']! : undefined;
}

function svgInfo(bytes: Uint8Array): ImageInfo | undefined {
  const root = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml').documentElement;
  if (root.localName !== 'svg') return;
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const ratio = box?.length === 4 && box[2]! > 0 && box[3]! > 0 ? box[2]! / box[3]! : undefined;
  const w = svgLength(root.getAttribute('width'));
  const h = svgLength(root.getAttribute('height'));
  const width = w ?? (h && ratio ? h * ratio : box?.[2]);
  const height = h ?? (w && ratio ? w / ratio : box?.[3]);
  if (width && height && Number.isFinite(width) && Number.isFinite(height)) return { width, height };
}

function pngInfo(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length < 26) return;
  const view = viewOf(bytes);
  let frames = 1;
  let alpha = [4, 6].includes(bytes[25]!);
  for (let at = 8; at + 12 <= bytes.length;) {
    const size = view.getUint32(at);
    const tag = ascii(bytes, at + 4, 4);
    if (tag === 'tRNS') alpha = true;
    if (tag === 'eXIf') return; // Let the decoder resolve EXIF orientation.
    if (tag === 'acTL' && size >= 8) frames = view.getUint32(at + 8);
    if (tag === 'IEND') break;
    at += size + 12;
  }
  return { width: view.getUint32(16), height: view.getUint32(20), alpha, frames };
}

function gifInfo(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length < 10) return;
  const view = viewOf(bytes);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function webpInfo(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length < 30) return;
  const view = viewOf(bytes);
  const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    if (bytes[20]! & 8) return; // EXIF may change the displayed dimensions.
    return { width: u24(24) + 1, height: u24(27) + 1, alpha: !!(bytes[20]! & 16), frames: bytes[20]! & 2 ? undefined : 1 };
  }
  if (chunk === 'VP8 ') {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, alpha: false, frames: 1 };
  }
  if (chunk === 'VP8L') {
    return {
      width: 1 + ((bytes[21]! | bytes[22]! << 8) & 0x3fff),
      height: 1 + ((bytes[22]! >> 6 | bytes[23]! << 2 | bytes[24]! << 10) & 0x3fff),
      alpha: !!(bytes[24]! & 16),
      frames: 1,
    };
  }
}

function jpegInfo(bytes: Uint8Array): ImageInfo | undefined {
  const view = viewOf(bytes);
  const orientation = jpegOrientation(bytes);
  let width = 0, height = 0, profile = false, cmyk = false;
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1]!;
    const size = view.getUint16(at + 2);
    if (JPEG_FRAME_MARKERS.has(marker)) {
      width = view.getUint16(at + 7);
      height = view.getUint16(at + 5);
      cmyk = bytes[at + 9] === 4;
    }
    if (marker === 0xe2 && ascii(bytes, at + 4, 11) === 'ICC_PROFILE') profile = true;
    if (size < 2 || marker === 0xda) break;
    at += size + 2;
  }
  if (!width || !height) return;
  const sideways = orientation >= 5 && orientation <= 8;
  return { width: sideways ? height : width, height: sideways ? width : height, alpha: false, frames: 1, profile, needsRotation: orientation !== 1, cmyk };
}

const READERS: Partial<Record<SourceFile['format'], (bytes: Uint8Array) => ImageInfo | undefined>> = {
  svg: svgInfo, png: pngInfo, gif: gifInfo, webp: webpInfo, jpg: jpegInfo,
};

/** A bounded header read. Unknown metadata stays unknown; opening a file never requires an encoder. */
export async function imageInfo({ file, format }: SourceFile): Promise<ImageInfo | undefined> {
  try {
    const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
    // PNG and WebP may put orientation metadata after the pixel chunks. A bounded
    // read cannot promise upright dimensions when the rest of the file is unknown.
    if ((format === 'png' || format === 'webp') && bytes.length < file.size) return;
    return READERS[format]?.(bytes);
  } catch { /* The converter owns decoding errors; a header hint must not prevent opening. */ }
}
