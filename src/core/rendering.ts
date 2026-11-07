import type { ConvertOptions } from './engine';
import { RebakeError } from './errors';
import type { FormatId } from './formats';

export const DUAL_COMPRESSION: ReadonlySet<FormatId> = new Set(['webp', 'avif', 'jxl']);
export const ANIMATION_FORMATS: ReadonlySet<FormatId> = new Set(['gif', 'webp']);
export const MAX_RENDER_PIXELS = 16_000_000;
export const MAX_IMAGE_EDGE = 32_768;
export const DEFAULT_PDF_DPI = 150;

export function backgroundRgb(color = '#ffffff'): number[] {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new RebakeError('unsupported', 'Choose a valid background color.');
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
}

/** Shared by the UI and engines: invalid stored or programmatic options never reach a codec. */
export function validateOptions(options: ConvertOptions) {
  for (const [key, label] of [['maxWidth', 'Max width'], ['maxHeight', 'Max height'], ['svgWidth', 'Render width'], ['svgHeight', 'Render height']] as const) {
    const value = options[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > MAX_IMAGE_EDGE)) {
      throw new RebakeError('unsupported', `${label} must be a whole number from 1 to ${MAX_IMAGE_EDGE.toLocaleString('en-US')}.`);
    }
  }
  if (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100) throw new RebakeError('unsupported', 'Quality must be a whole number from 1 to 100.');
  if (options.pdfDpi !== undefined && (!Number.isInteger(options.pdfDpi) || options.pdfDpi < 36 || options.pdfDpi > 600)) throw new RebakeError('unsupported', 'Resolution must be a whole number from 36 to 600 DPI.');
  backgroundRgb(options.background);
  const choices = {
    compression: ['lossy', 'lossless'], transparency: ['preserve', 'flatten'], colorSpace: ['srgb', 'preserve'],
    animation: ['all', 'first'], pdfImageCompression: ['preserve', 'lossless', 'lossy'],
  } as const;
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    const value = options[key];
    if (value !== undefined && !(choices[key] as readonly string[]).includes(value)) throw new RebakeError('unsupported', 'One of the conversion settings is invalid. Reset options, then try again.');
  }
}

export function svgSize(width: number, height: number, options: ConvertOptions) {
  const scale = options.svgWidth || options.svgHeight
    ? Math.min(options.svgWidth ? options.svgWidth / width : Infinity, options.svgHeight ? options.svgHeight / height : Infinity)
    : Math.max(1, 1024 / Math.max(width, height));
  const result = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
  if (result.width > MAX_IMAGE_EDGE || result.height > MAX_IMAGE_EDGE || result.width * result.height > MAX_RENDER_PIXELS) {
    throw new RebakeError('unsupported', 'This SVG would render above 16 million pixels. Choose a smaller render width or height.');
  }
  return result;
}

export function fitSize(width: number, height: number, options: ConvertOptions) {
  const scale = Math.min(1, options.maxWidth ? options.maxWidth / width : 1, options.maxHeight ? options.maxHeight / height : 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

export function pdfSize(width: number, height: number, dpi = DEFAULT_PDF_DPI) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new RebakeError('corrupt', 'This PDF has an invalid page size.');
  const scale = Math.min(dpi / 72, Math.sqrt(MAX_RENDER_PIXELS / (width * height)), MAX_IMAGE_EDGE / width, MAX_IMAGE_EDGE / height);
  let w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  if (w * h > MAX_RENDER_PIXELS) {
    if (w > h) w = Math.floor(MAX_RENDER_PIXELS / h);
    else h = Math.floor(MAX_RENDER_PIXELS / w);
  }
  return { width: w, height: h, scale, dpi: scale * 72, capped: scale < dpi / 72 };
}
