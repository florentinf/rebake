import type { RgbaImage } from './ico';

export interface DecodedHeic extends RgbaImage {
  /** Embedded ICC profile. Null when pixels are already sRGB. */
  icc: Uint8Array | null;
  path: 'heic:native' | 'heic:libheif';
}

/** iOS caps a canvas near 16.7 MP, and a 24 MP photo over that reads back blank. */
const TILE_WIDTH = 4096;
const TILE_HEIGHT = 2048;

/** Safari decodes HEIC itself. Pixels are read in tiles so no canvas nears the limit. */
export async function decodeNative(buffer: ArrayBuffer): Promise<DecodedHeic | null> {
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/heic' }));
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    if (!width || !height) return null;
    const data = new Uint8Array(width * height * 4);
    const canvas = new OffscreenCanvas(Math.min(width, TILE_WIDTH), Math.min(height, TILE_HEIGHT));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    for (let top = 0; top < height; top += TILE_HEIGHT) {
      for (let left = 0; left < width; left += TILE_WIDTH) {
        const w = Math.min(TILE_WIDTH, width - left);
        const h = Math.min(TILE_HEIGHT, height - top);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, -left, -top);
        const tile = context.getImageData(0, 0, w, h).data;
        // A canvas the browser refused to back reads as all zeros, not as an error.
        if (tile[3] === 0 && tile[tile.length - 1] === 0) return null;
        for (let row = 0; row < h; row++) {
          data.set(
            tile.subarray(row * w * 4, (row + 1) * w * 4),
            ((top + row) * width + left) * 4,
          );
        }
      }
    }
    return { data, width, height, icc: null, path: 'heic:native' };
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: unknown) => void): void;
  free(): void;
}

interface Libheif {
  HeifDecoder: new () => { decode(buffer: ArrayBuffer): HeifImage[] };
}

/** libde265 in WASM, for every browser without native HEIC. */
export async function decodeLibheif(url: string, buffer: ArrayBuffer): Promise<DecodedHeic> {
  const imported = (await import(/* @vite-ignore */ url)) as { default: Libheif | (() => Libheif) };
  const libheif = typeof imported.default === 'function' ? imported.default() : imported.default;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(buffer);
  if (!images.length) throw new Error('No image in HEIC file');
  const image = images.find((candidate) => candidate.is_primary?.()) ?? images[0]!;
  const width = image.get_width();
  const height = image.get_height();
  const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
  await new Promise<void>((resolve, reject) => {
    image.display(target, (result) => (result ? resolve() : reject(new Error('HEIC decode failed'))));
  });
  for (const each of images) each.free();
  return {
    data: new Uint8Array(target.data.buffer),
    width,
    height,
    icc: findIccProfile(new Uint8Array(buffer)),
    path: 'heic:libheif',
  };
}

/**
 * libheif hands over raw pixels, and iPhone pixels are Display P3. Without the
 * profile the output would look washed out, so pull it from the `colr` box.
 */
function findIccProfile(file: Uint8Array): Uint8Array | null {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const limit = Math.min(file.length, 1 << 20) - 12;
  for (let i = 4; i < limit; i++) {
    const isColr = file[i] === 0x63 && file[i + 1] === 0x6f && file[i + 2] === 0x6c && file[i + 3] === 0x72;
    if (!isColr) continue;
    const kind = String.fromCharCode(...file.subarray(i + 4, i + 8));
    if (kind !== 'prof' && kind !== 'rICC') continue;
    const size = view.getUint32(i - 4);
    if (size > 12 && i - 4 + size <= file.length) return file.slice(i + 8, i - 4 + size);
  }
  return null;
}
