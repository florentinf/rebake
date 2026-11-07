import type { ConvertOptions } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import type { FormatId } from '../../core/formats';
import { fetchAssets } from '../../core/fetch-asset';
import { serve, Transfer, type HandlerContext } from '../../core/worker-runtime';
import { decodeLibheif, decodeNative } from './heic';
import { readIco, writeIco, type RgbaImage } from './ico';
import { ANIMATION_FORMATS, backgroundRgb, fitSize, svgSize } from '../../core/rendering';
import { jpegOrientation, stripJpeg } from '../../core/jpeg';
import type { ConvertReply, ConvertRequest, InitRequest } from './protocol';

type VipsFactory = typeof import('wasm-vips');
type VipsModule = Awaited<ReturnType<VipsFactory>>;
type Image = InstanceType<VipsModule['Image']>;

let vips: VipsModule;

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function init(request: InitRequest, context: HandlerContext) {
  await fetchAssets(request.files, context.progress);
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

function fromPixels({ data, width, height, icc }: RgbaImage & { icc?: Uint8Array | null }): Image {
  let image = vips.Image.newFromMemory(data, width, height, 4, vips.BandFormat.uchar).copy({ interpretation: 'srgb' });
  if (image.extractBand(3).min() >= 255) image = image.extractBand(0, { n: 3 });
  if (icc) {
    image = image.copy();
    image.setBlob('icc-profile-data', icc);
  }
  return image;
}

function load(buffer: ArrayBuffer, input: FormatId, target: FormatId, options: ConvertOptions): Image {
  const bytes = new Uint8Array(buffer);
  if (input === 'ico') {
    const entry = readIco(buffer);
    return entry.kind === 'png' ? vips.Image.newFromBuffer(entry.bytes) : fromPixels(entry);
  }
  if (input === 'svg') {
    const probe = vips.Image.newFromBuffer(bytes);
    const { scale } = svgSize(probe.width, probe.height, options);
    return vips.Image.newFromBuffer(bytes, '', { scale } as object);
  }
  if (ANIMATION_FORMATS.has(input) && ANIMATION_FORMATS.has(target) && options.animation !== 'first') return vips.Image.newFromBuffer(bytes, '', { n: -1 } as object);
  return vips.Image.newFromBuffer(bytes, '', (input === 'jpg' ? { fail_on: 'error' } : {}) as object);
}

function normalise(source: Image, target: FormatId, options: ConvertOptions, notes: string[]): Image {
  let image = source;
  const animated = image.getTypeof('n-pages') !== 0 && image.pageHeight !== image.height;

  if (!animated) image = image.autorot();

  const preserve = options.colorSpace === 'preserve' && (['srgb', 'rgb', 'rgb16', 'b-w', 'grey16'].includes(image.interpretation)
    || (['jpg', 'tiff'].includes(target) && image.interpretation === 'cmyk'));
  if (options.colorSpace === 'preserve' && !preserve) notes.push('The source color space is not supported by this output; colors were converted to sRGB.');
  // Keep-profile mode retains ICC independently of camera/location metadata.
  if (!preserve && image.getTypeof('icc-profile-data') !== 0) {
    try {
      image = image.iccTransform('srgb', { depth: image.format === 'ushort' ? 16 : 8 });
    } catch {
      image = image.colourspace('srgb');
      image.remove('icc-profile-data');
      notes.push('The source color profile could not be read. The output uses sRGB.');
    }
  } else if (!preserve && !['srgb', 'b-w', 'rgb16', 'grey16'].includes(image.interpretation)) {
    image = image.colourspace('srgb');
  }

  const { maxWidth, maxHeight } = options;
  if ((maxWidth || maxHeight) && target !== 'ico') {
    const frameHeight = animated ? image.pageHeight : image.height;
    const { scale } = fitSize(image.width, frameHeight, options);
    if (scale < 1 && animated) {
      const frames = Array.from({ length: image.height / frameHeight }, (_, i) => image.crop(0, i * frameHeight, image.width, frameHeight).resize(scale));
      image = vips.Image.arrayjoin(frames, { across: 1 });
      image.setInt('page-height', frames[0]!.height);
    } else if (scale < 1) image = image.resize(scale);
  }

  if ((target === 'jpg' || options.transparency === 'flatten') && image.hasAlpha()) image = image.flatten({ background: backgroundRgb(options.background) });
  return image;
}

function encodeIco(image: Image, options: ConvertOptions): Uint8Array {
  const edge = Math.max(image.width, image.height);
  const sizes = ICO_SIZES.filter((size) => size <= edge);
  if (!sizes.length) sizes.push(16);
  return writeIco(sizes.map((size) => {
    const scaled = image.thumbnailImage(size, { height: size });
    const withAlpha = scaled.hasAlpha() ? scaled : scaled.addalpha();
    const square = withAlpha.gravity('centre', size, size, { extend: 'background', background: options.transparency === 'flatten' ? [...backgroundRgb(options.background), 255] : [0, 0, 0, 0] });
    return { size, png: square.writeToBuffer('.png', { keep: options.colorSpace === 'preserve' ? 'icc' : 'none' }) };
  }));
}

function encode(image: Image, target: FormatId, options: ConvertOptions): Uint8Array {
  const Q = options.quality;
  const keep = options.stripMetadata ? options.colorSpace === 'preserve' ? 'icc' : 'none' : 'all';
  const lossless = options.compression === 'lossless';
  switch (target) {
    case 'jpg': return image.writeToBuffer('.jpg', { Q, keep, optimize_coding: true, interlace: true });
    case 'png': return image.writeToBuffer('.png', { keep, compression: 6 });
    case 'webp': return image.writeToBuffer('.webp', { Q, keep, effort: 4, lossless, exact: lossless });
    case 'avif': return image.writeToBuffer('.avif', { Q, keep, effort: 3, lossless, ...(lossless ? { subsample_mode: 'off' } : {}) });
    case 'jxl': return image.writeToBuffer('.jxl', { Q, keep, effort: 4, lossless, ...(!lossless && Q === 100 ? { distance: 0.01 } : {}) });
    case 'gif': return image.writeToBuffer('.gif', { keep });
    case 'tiff': return image.writeToBuffer('.tif', { keep, compression: 'deflate', predictor: 'horizontal' });
    case 'ico': return encodeIco(image, options);
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
    image = load(buffer, input, target, options);
  }

  // Removing JPEG metadata can preserve the original compressed picture exactly.
  // Color conversion, orientation correction, resizing and an explicit recompress opt out.
  if (input === 'jpg' && target === 'jpg' && !options.recompress
    && jpegOrientation(new Uint8Array(buffer)) === 1
    && (options.colorSpace === 'preserve' || (image.getTypeof('icc-profile-data') === 0 && ['srgb', 'b-w'].includes(image.interpretation)))
    && fitSize(image.width, image.height, options).scale === 1) {
    image.avg(); // Validate the full picture even though its compressed bytes can be copied.
    const output = options.stripMetadata ? stripJpeg(new Uint8Array(buffer)).buffer : buffer;
    return new Transfer({ output, path: 'jpeg:copy', held: vips.Stats.mem() }, [output]);
  }

  const notes: string[] = [];
  const prepared = normalise(image, target, options, notes);
  context.progress({ stage: 'encoding', fraction: 0 });
  prepared.onProgress = (percent: number) => context.progress({ stage: 'encoding', fraction: percent / 100 });
  const encoded = encode(prepared, target, options);
  const output = encoded.slice().buffer as ArrayBuffer;
  return new Transfer({ output, path, held: vips.Stats.mem(), ...(notes.length ? { note: notes.join(' ') } : {}) }, [output]);
}

serve({ init, convert });
