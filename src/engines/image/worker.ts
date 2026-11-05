import type { ConvertOptions } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import type { FormatId } from '../../core/formats';
import { serve, Transfer, type HandlerContext } from '../../core/worker-runtime';
import { decodeLibheif, decodeNative, type DecodedHeic } from './heic';
import { readIco, writeIco } from './ico';
import type { ConvertReply, ConvertRequest, InitRequest } from './protocol';

type VipsFactory = typeof import('wasm-vips');
type VipsModule = Awaited<ReturnType<VipsFactory>>;
type Image = InstanceType<VipsModule['Image']>;

let vips: VipsModule;

const ANIMATED: ReadonlySet<FormatId> = new Set(['gif', 'webp']);
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
/** Small vectors render at this long edge so the raster is actually useful. */
const SVG_MIN_EDGE = 1024;

async function fetchAll(files: InitRequest['files'], context: HandlerContext) {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  let received = 0;
  await Promise.all(files.map(async ({ url }) => {
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new RebakeError('offline', 'engine not cached');
    }
    if (!response.ok || !response.body) throw new RebakeError('offline', 'engine not cached');
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      context.progress({ stage: 'loading', fraction: Math.min(received / total, 1) });
    }
  }));
}

async function init(request: InitRequest, context: HandlerContext) {
  await fetchAll(request.files, context);
  try {
    await start(request);
  } catch (error) {
    // A bad start is never the file's fault.
    throw new RebakeError('crashed', `Engine failed to start: ${error instanceof Error ? error.message : error}`);
  }
}

async function start(request: InitRequest) {
  const { default: Vips } = (await import(/* @vite-ignore */ request.vipsUrl)) as { default: VipsFactory };
  vips = await Vips({
    locateFile: (name: string) => request.locate[name] ?? name,
    mainScriptUrlOrBlob: request.vipsUrl,
    dynamicLibraries: request.modules,
    print: () => {},
    printErr: () => {},
  } as Parameters<VipsFactory>[0]);
  vips.Cache.max(0);
}

function fromPixels({ data, width, height, icc }: DecodedHeic | (ReturnType<typeof rgba>)): Image {
  let image = vips.Image.newFromMemory(data, width, height, 4, vips.BandFormat.uchar).copy({ interpretation: 'srgb' });
  if (image.extractBand(3).min() >= 255) image = image.extractBand(0, { n: 3 });
  if (icc) {
    image = image.copy();
    image.setBlob('icc-profile-data', icc);
  }
  return image;
}

const rgba = (image: { data: Uint8Array; width: number; height: number }) => ({ ...image, icc: null });

function load(buffer: ArrayBuffer, input: FormatId, target: FormatId): Image {
  const bytes = new Uint8Array(buffer);
  if (input === 'ico') {
    const entry = readIco(buffer);
    return entry.kind === 'png' ? vips.Image.newFromBuffer(entry.bytes) : fromPixels(rgba(entry));
  }
  if (input === 'svg') {
    const probe = vips.Image.newFromBuffer(bytes);
    const edge = Math.max(probe.width, probe.height);
    const scale = edge < SVG_MIN_EDGE ? SVG_MIN_EDGE / edge : 1;
    return vips.Image.newFromBuffer(bytes, '', { scale } as object);
  }
  if (ANIMATED.has(input) && ANIMATED.has(target)) return vips.Image.newFromBuffer(bytes, '', { n: -1 } as object);
  return vips.Image.newFromBuffer(bytes);
}

function normalise(source: Image, target: FormatId, options: ConvertOptions): Image {
  let image = source;
  const animated = image.getTypeof('n-pages') !== 0 && image.pageHeight !== image.height;

  if (!animated) image = image.autorot();

  // Metadata stripping also drops the ICC profile, so pixels must become sRGB first.
  if (image.getTypeof('icc-profile-data') !== 0) {
    try {
      image = image.iccTransform('srgb');
    } catch {
      // A broken profile shouldn't fail the file; the pixels are still usable.
    }
  } else if (image.interpretation !== 'srgb' && image.interpretation !== 'b-w') {
    image = image.colourspace('srgb');
  }

  const { maxWidth, maxHeight } = options;
  if ((maxWidth || maxHeight) && target !== 'ico' && !animated) {
    const scale = Math.min(
      maxWidth ? maxWidth / image.width : 1,
      maxHeight ? maxHeight / image.height : 1,
    );
    if (scale < 1) image = image.resize(scale);
  }

  if (target === 'jpg' && image.hasAlpha()) image = image.flatten({ background: [255, 255, 255] });
  return image;
}

function encodeIco(image: Image): Uint8Array {
  const edge = Math.max(image.width, image.height);
  const sizes = ICO_SIZES.filter((size) => size <= edge);
  if (!sizes.length) sizes.push(16);
  return writeIco(sizes.map((size) => {
    const scaled = image.thumbnailImage(size, { height: size });
    const withAlpha = scaled.hasAlpha() ? scaled : scaled.addalpha();
    const square = withAlpha.gravity('centre', size, size, { extend: 'background', background: [0, 0, 0, 0] });
    return { size, png: square.writeToBuffer('.png', { keep: 'none' }) };
  }));
}

function encode(image: Image, target: FormatId, options: ConvertOptions): Uint8Array {
  const Q = options.quality;
  const keep = options.stripMetadata ? 'none' : 'all';
  switch (target) {
    case 'jpg': return image.writeToBuffer('.jpg', { Q, keep, optimize_coding: true, interlace: true });
    case 'png': return image.writeToBuffer('.png', { keep, compression: 6 });
    case 'webp': return image.writeToBuffer('.webp', { Q, keep, effort: 4 });
    case 'avif': return image.writeToBuffer('.avif', { Q, keep, effort: 3 });
    case 'jxl': return image.writeToBuffer('.jxl', { Q, keep, effort: 4 });
    case 'gif': return image.writeToBuffer('.gif', { keep });
    case 'tiff': return image.writeToBuffer('.tif', { keep, compression: 'deflate', predictor: 'horizontal' });
    case 'ico': return encodeIco(image);
    default: throw new RebakeError('unsupported', `Can't write ${target}.`);
  }
}

async function convert(request: ConvertRequest, context: HandlerContext): Promise<Transfer<ConvertReply>> {
  const { buffer, input, target, options, libheif } = request;
  let path = `vips:${input}`;
  let image: Image;

  if (input === 'heic') {
    context.progress({ stage: 'decoding', fraction: null });
    const decoded = (await decodeNative(buffer)) ?? (await decodeLibheif(libheif.url, buffer));
    path = decoded.path;
    image = fromPixels(decoded);
  } else {
    image = load(buffer, input, target);
  }

  const prepared = normalise(image, target, options);
  context.progress({ stage: 'encoding', fraction: 0 });
  prepared.onProgress = (percent: number) => context.progress({ stage: 'encoding', fraction: percent / 100 });
  const encoded = encode(prepared, target, options);
  const output = encoded.slice().buffer as ArrayBuffer;
  return new Transfer({ output, path }, [output]);
}

serve({ init, convert });
