import type { ConvertOptions, Inspection, SourceFile } from './engine';
import { FORMATS, type Category, type FormatId } from './formats';
import { ANIMATION_FORMATS, DEFAULT_PDF_DPI, DUAL_COMPRESSION, fitSize, svgSize } from './rendering';
import { formatTime } from './time';

/**
 * `summary` is the folded Options line, most useful fact first. `warnings` change
 * what's in the file and sit beside Convert. `notes` explain a setting and live in Options.
 */
export interface ConversionPlan { summary: string[]; warnings: string[]; notes: string[] }

interface Job {
  sources: SourceFile[];
  target: FormatId;
  options: ConvertOptions;
  inspections: (Inspection | undefined)[];
}

const resolutionLabel = (lines: number) => lines === 2160 ? '4K' : `${lines}p`;
const range = (start = 0, end?: number) => `Trim ${formatTime(start)}–${end === undefined ? 'end' : formatTime(end)}`;

const isCategory = ({ format }: SourceFile, category: Category) => FORMATS[format].category === category;
const hasFormat = ({ sources }: Job, ...formats: FormatId[]) => sources.some(({ format }) => formats.includes(format));

const metadataLine = ({ stripMetadata }: ConvertOptions) => stripMetadata ? 'Metadata removed' : 'Metadata kept';
const svgLine = ({ svgWidth, svgHeight }: ConvertOptions) => svgWidth || svgHeight
  ? `SVG: fit within ${svgWidth ?? 'any'} × ${svgHeight ?? 'any'} px`
  : 'SVG: at least 1024 px on the long edge';

function background({ background: chosen }: ConvertOptions) {
  const color = (chosen ?? '#ffffff').toUpperCase();
  const white = color === '#FFFFFF';
  return { name: white ? 'white' : color, line: `${white ? 'White' : color} background` };
}

/** True when every JPG can keep its picture data, so quality has no say. */
function copiesJpeg({ sources, options, inspections }: Job) {
  return sources.every(({ format }, i) => {
    const info = inspections[i]?.image;
    return format === 'jpg' && !options.recompress && info && !info.needsRotation
      && (options.colorSpace === 'preserve' || (!info.profile && !info.cmyk))
      && fitSize(info.width, info.height, options).scale === 1;
  });
}

function imageQuality(job: Job, { summary, notes }: ConversionPlan) {
  const { target, options } = job;
  if (DUAL_COMPRESSION.has(target)) {
    summary.push(options.compression === 'lossless' ? 'Lossless compression' : `Lossy · Quality ${options.quality}`);
  } else if (target === 'jpg') {
    summary.push(copiesJpeg(job) ? 'Original quality' : `JPG quality ${options.quality}`);
    if (!options.recompress && hasFormat(job, 'jpg')) notes.push('Existing JPG picture data is kept when no resize, color conversion or orientation correction is needed.');
  } else if (target === 'png' || target === 'tiff') {
    summary.push('Lossless compression');
  } else if (target === 'gif') {
    summary.push('Up to 256 colors');
    notes.push('GIF can reduce colors and supports fully transparent or fully opaque pixels.');
  }
}

function imageSize(job: Job, { summary }: ConversionPlan) {
  const { sources, target, options, inspections } = job;
  const sizes = sources.map(({ format }, i) => {
    const info = inspections[i]?.image;
    if (!info) return undefined;
    const base = format === 'svg' ? svgSize(info.width, info.height, options) : info;
    return fitSize(base.width, base.height, options);
  });
  const [first] = sizes;
  if (target === 'ico') summary.push('Icon sizes up to 256 px');
  else if (first && sizes.every((size) => size?.width === first.width && size.height === first.height)) summary.push(`${first.width} × ${first.height} px`);
  else if (options.maxWidth || options.maxHeight) summary.push(`Max ${options.maxWidth ?? 'any'} × ${options.maxHeight ?? 'any'} px`);
  else if (hasFormat(job, 'svg')) summary.push(svgLine(options));
  else summary.push('Original size');
}

function imageAnimation({ sources, target, options, inspections }: Job, { summary, warnings }: ConversionPlan) {
  const animated = sources.some(({ format }, i) => ANIMATION_FORMATS.has(format) && inspections[i]?.image?.frames !== 1);
  if (animated) {
    const keep = ANIMATION_FORMATS.has(target) && options.animation !== 'first';
    summary.push(keep ? 'All animation frames' : 'First frame');
    if (!keep) warnings.push('Animation becomes a still image.');
  }
  const multipage = sources.some(({ format }, i) => !ANIMATION_FORMATS.has(format) && (inspections[i]?.image?.frames ?? 1) > 1);
  if (multipage) warnings.push('Only the first image or animation frame is converted.');
}

function imageTransparency({ sources, target, options, inspections }: Job, { summary, warnings, notes }: ConversionPlan) {
  const transparent = sources.some((_, i) => inspections[i]?.image?.alpha === true);
  const unknown = sources.some(({ format }, i) => format !== 'jpg' && inspections[i]?.image?.alpha === undefined);
  if (target === 'jpg' || options.transparency === 'flatten') {
    const { name, line } = background(options);
    if (transparent || unknown) summary.push(line);
    if (transparent) warnings.push(`Transparent areas become ${name}.`);
    else if (unknown) notes.push('Any transparent areas use the selected background color.');
  } else if (transparent || unknown) {
    summary.push('Transparency kept');
  }
}

function imagePlan(job: Job, plan: ConversionPlan) {
  const { target, options } = job;
  imageQuality(job, plan);
  imageSize(job, plan);
  if (hasFormat(job, 'svg')) plan.notes.push('Vector graphics become pixels at the selected size.');
  imageAnimation(job, plan);
  imageTransparency(job, plan);
  plan.summary.push(metadataLine(options));
  if (options.colorSpace === 'preserve') plan.summary.push('Source color profile');
  if (options.compression === 'lossless' || target === 'png' || target === 'tiff') plan.notes.push('Lossless describes compression. Resizing, rendering and color conversion can still change pixels.');
}

function pdfPagesPlan({ target, options }: Job, { summary, notes }: ConversionPlan) {
  summary.push(`${options.pdfDpi ?? DEFAULT_PDF_DPI} DPI`, options.pages ? `Pages ${options.pages}` : 'All pages');
  summary.push(target === 'jpg' ? `JPG quality ${options.quality}` : 'Lossless PNG compression');
  summary.push(target === 'png' && options.transparency !== 'flatten' ? 'Transparent background' : background(options).line);
  notes.push('One image per page. Several pages download together as a ZIP. A page over 16 million pixels gets a lower resolution, and the result says so.');
}

const PDF_IMAGE_POLICIES = {
  preserve: { line: 'Keep image quality', note: 'JPG picture data is kept where possible. Other images use lossless PNG compression.' },
  lossless: { line: 'Lossless PNG images', note: 'Every image is stored as PNG, including existing JPGs. Earlier compression loss cannot be undone.' },
  lossy: { line: '', note: 'Every image is encoded as JPG. Transparent areas use the selected background.' },
};

function imagesToPdfPlan(job: Job, { summary, warnings, notes }: ConversionPlan) {
  const { sources, options } = job;
  const policy = options.pdfImageCompression ?? 'preserve';
  summary.push(options.pageSize === 'letter' ? 'Letter' : 'A4', `${sources.length} ${sources.length === 1 ? 'page' : 'pages'}`);
  summary.push(policy === 'lossy' ? `JPG quality ${options.quality}` : PDF_IMAGE_POLICIES[policy].line);
  notes.push(PDF_IMAGE_POLICIES[policy].note);
  if (hasFormat(job, 'svg')) notes.push('SVG graphics are rendered into pixels before being placed in the PDF.');
  if (sources.some(({ format }) => ANIMATION_FORMATS.has(format))) warnings.push('Each animated image contributes its first frame.');
  summary.push(background(options).line);
  if (options.colorSpace === 'preserve') summary.push('Source color profile');
  if (options.maxWidth || options.maxHeight) summary.push(`Images: max ${options.maxWidth ?? 'any'} × ${options.maxHeight ?? 'any'} px`);
  if (hasFormat(job, 'svg')) summary.push(svgLine(options));
  summary.push(metadataLine(options));
}

function documentPlan({ target, options }: Job, { summary, warnings }: ConversionPlan) {
  summary.push('Text and structure');
  if (target === 'pdf') summary.push(options.pageSize === 'letter' ? 'Letter' : 'A4');
  warnings.push('Page layout and fonts may change.');
}

function dataPlan(job: Job, { summary, warnings, notes }: ConversionPlan) {
  const { target, options } = job;
  if (hasFormat(job, 'xlsx')) {
    summary.push(options.sheet ? `Sheet: ${options.sheet}` : 'First sheet', 'Values only');
    warnings.push('CSV does not retain formulas, formatting or other worksheets.');
  } else if (target === 'csv' || target === 'tsv') {
    summary.push('Header row', target === 'csv' ? 'Comma-separated' : 'Tab-separated');
    if (hasFormat(job, 'json', 'yaml')) notes.push('Nested fields become dotted columns. Literal dots and backslashes in field names are escaped; arrays and empty objects remain JSON inside their cells.');
  } else {
    summary.push(`${FORMATS[target].label} structure`);
    if (hasFormat(job, 'csv', 'tsv')) notes.push('The first row supplies unique column names. Unambiguous numbers and true/false become typed values; other cells stay text.');
  }
}

function gifPlan({ options }: Job, { summary, warnings }: ConversionPlan) {
  summary.push('12 frames/s', `Up to ${Math.min(options.maxResolution ?? 270, 720)}p`, 'Up to 256 colors');
  warnings.push('GIF removes audio and reduces colors and frame rate.');
}

function videoPlan({ target, options, inspections }: Job, { summary, notes }: ConversionPlan) {
  const { preset, trimStart, maxResolution } = options;
  const copies = inspections.every((inspection) => {
    const media = inspection?.media;
    return media?.videoCopyTargets.includes(target) && preset !== 'small' && !trimStart
      && (!maxResolution || (media.width && media.height && Math.min(media.width, media.height) <= maxResolution));
  });
  summary.push(copies ? 'Original quality' : preset === 'small' ? 'Small file' : preset === 'high' ? 'High quality' : 'Balanced quality');
  if (copies) notes.push('Balanced and High keep the original video when they can.');
  if (maxResolution) summary.push(`Up to ${resolutionLabel(maxResolution)}`);
  if (options.removeAudio) summary.push('No sound');
  else if (!inspections.some((inspection) => inspection?.hasAudio)) summary.push('No audio in source');
}

function audioPlan({ sources, target, options, inspections }: Job, trimmed: boolean, { summary, notes }: ConversionPlan) {
  const { audioBitrate, channels } = options;
  const copies = !audioBitrate && !channels && !trimmed && inspections.every((inspection) => inspection?.media?.audioCopyTargets.includes(target));
  summary.push(audioBitrate ? `${audioBitrate / 1000} kbps` : copies ? 'Original quality' : target === 'flac' || target === 'wav' ? 'Lossless' : 'Automatic bitrate');
  if (channels) summary.push(channels === 1 ? 'Mono' : 'Stereo');
  if (sources.some((source) => isCategory(source, 'video'))) notes.push('Only audio is included in the result.');
}

function mediaPlan(job: Job, plan: ConversionPlan) {
  const { target, options } = job;
  const trimmed = options.trimStart !== undefined || options.trimEnd !== undefined;
  const { category } = FORMATS[target];
  if (target === 'gif') gifPlan(job, plan);
  else if (category === 'video') videoPlan(job, plan);
  else if (category === 'audio') audioPlan(job, trimmed, plan);
  if (trimmed) plan.summary.push(range(options.trimStart, options.trimEnd));
}

/** Describe effective settings, with bounded header facts when available. No guessed dimensions or sizes. */
export function conversionPlan(sources: SourceFile[], target: FormatId, options: ConvertOptions, inspections: (Inspection | undefined)[]): ConversionPlan {
  const plan: ConversionPlan = { summary: [], warnings: [], notes: [] };
  const job: Job = { sources, target, options, inspections };
  const all = (...categories: Category[]) => sources.every((source) => categories.some((category) => isCategory(source, category)));
  if (all('image')) (target === 'pdf' ? imagesToPdfPlan : imagePlan)(job, plan);
  else if (all('pdf')) pdfPagesPlan(job, plan);
  else if (all('document')) documentPlan(job, plan);
  else if (all('data')) dataPlan(job, plan);
  else if (all('video', 'audio')) mediaPlan(job, plan);
  return plan;
}
