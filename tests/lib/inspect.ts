import Vips from 'wasm-vips';
import { sniff } from '../../src/core/detect';
import type { FormatId } from '../../src/core/formats';

let vips: Promise<Awaited<ReturnType<typeof Vips>>> | undefined;
const engine = () => (vips ??= Vips({
  dynamicLibraries: ['vips-heif.wasm', 'vips-jxl.wasm', 'vips-resvg.wasm'],
  print: () => {},
  printErr: () => {},
} as Parameters<typeof Vips>[0]));

export interface Header {
  format: FormatId | null;
  width: number;
  height: number;
  pages: number;
  entries?: number[];
  orientation: number;
}

function readIcoDirectory(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: view.getUint16(4, true) }, (_, i) => view.getUint8(6 + i * 16) || 256);
}

/** Reads the output back: magic bytes first, then an independent full decode. */
export async function readHeader(bytes: Uint8Array): Promise<Header> {
  const format = sniff(bytes.subarray(0, 4096));
  if (format === 'ico') {
    const entries = readIcoDirectory(bytes);
    const largest = Math.max(...entries);
    return { format, width: largest, height: largest, pages: 1, entries, orientation: 1 };
  }
  const v = await engine();
  const multiPage = format === 'gif' || format === 'webp';
  const image = v.Image.newFromBuffer(bytes, '', (multiPage ? { n: -1 } : {}) as object);
  const pages = image.getTypeof('n-pages') ? image.getInt('n-pages') : 1;
  const orientation = image.getTypeof('orientation') ? image.getInt('orientation') : 1;
  // Force real decoding, not only a header parse.
  image.avg();
  return { format, width: image.width, height: image.pageHeight, pages, orientation };
}

export const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(text);
