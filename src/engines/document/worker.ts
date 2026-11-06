import { unzipSync } from 'fflate';
import { sniff } from '../../core/detect';
import type { OutputPart } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import { fetchAssets, type AssetFile } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { serve, type HandlerContext } from '../../core/worker-runtime';
import { runPandoc, type PandocWarning } from './pandoc';
import type { ConvertReply, ConvertRequest, FinishPdfRequest, TiffReply } from './protocol';
import { compilePdf, type TypstFailure } from './typst';

const READERS: Partial<Record<FormatId, string>> = { md: 'markdown', html: 'html', docx: 'docx', odt: 'odt', epub: 'epub', rtf: 'rtf', tex: 'latex' };
const WRITERS: Partial<Record<FormatId, string>> = { md: 'gfm', html: 'html', docx: 'docx', odt: 'odt', epub: 'epub', rtf: 'rtf', tex: 'latex', pdf: 'typst' };
/** These can't hold an image, so their media goes beside them. */
const EXTERNAL_MEDIA: ReadonlySet<FormatId> = new Set(['md', 'tex', 'pdf']);
const LOST: ReadonlySet<string> = new Set(['CouldNotFetchResource', 'CouldNotConvertImage', 'CouldNotHighlight']);
const MEDIA_ZIP = 'media.zip';
/**
 * Typst draws what its fonts lack as empty boxes, without a word. The bundled
 * fonts cover Latin, Greek, Cyrillic and Hebrew, so anything past that refuses.
 */
const NO_GLYPHS = /[\u0600-\u08ff\u0900-\u1cff\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\uff00-\uffef\u{1f000}-\u{1faff}\u{20000}-\u{3ffff}]/u;

let pandoc: WebAssembly.Module | undefined;

async function loadPandoc(asset: AssetFile, context: HandlerContext) {
  if (pandoc) return pandoc;
  const [bytes] = await fetchAssets([asset], context.progress);
  context.progress({ stage: 'converting', fraction: null });
  pandoc = await WebAssembly.compile(bytes!);
  return pandoc;
}

function extractMedia(zip: Uint8Array | undefined) {
  return zip?.length ? unzipSync(zip) : {};
}

function pandocFailure(stderr: string, warnings: PandocWarning[]): RebakeError {
  if (stderr) console.warn('pandoc:', stderr.slice(0, 500), warnings.slice(0, 3));
  return new RebakeError('corrupt', stderr || 'pandoc produced nothing');
}

interface PdfJob {
  source: string;
  media: Record<string, Uint8Array>;
  lost: number;
  typst: ConvertRequest['typst'];
}

/** A job waiting for its TIFFs. The worker runs one job at a time. */
let waiting: PdfJob | undefined;

async function buildPdf({ source, media, lost, typst }: PdfJob, context: HandlerContext): Promise<ConvertReply> {
  try {
    const pdf = await compilePdf(source, media, typst, context);
    return { output: new Blob([pdf as Uint8Array<ArrayBuffer>]), path: 'pandoc+typst', lost };
  } catch (error) {
    if (error instanceof RebakeError) throw error;
    const message = (error as TypstFailure | null)?.message ?? String(error);
    console.warn('typst:', message.slice(0, 500));
    if (/image|decode|file format/i.test(message)) throw new RebakeError('unsupported', "One of this document's images is in a format PDF output can't use. Pick DOCX or HTML instead.");
    throw new RebakeError('unsupported', "This document can't be laid out as a PDF. Pick DOCX or HTML instead.");
  }
}

async function finishPdf({ pngs }: FinishPdfRequest, context: HandlerContext): Promise<ConvertReply> {
  const job = waiting;
  waiting = undefined;
  if (!job) throw new RebakeError('crashed', 'No PDF is waiting.');
  for (const [name, png] of Object.entries(pngs)) {
    const renamed = `${name}.png`;
    delete job.media[name];
    job.media[renamed] = png;
    job.source = job.source.replaceAll(`${name}"`, `${renamed}"`);
  }
  return buildPdf(job, context);
}

async function convert(request: ConvertRequest, context: HandlerContext): Promise<ConvertReply | TiffReply> {
  const { file, input, target, pageSize } = request;
  const module = await loadPandoc(request.pandoc, context);
  context.progress({ stage: 'converting', fraction: null });

  const inputName = `input.${FORMATS[input].extension}`;
  const outputName = `output.${target === 'pdf' ? 'typ' : FORMATS[target].extension}`;
  const external = EXTERNAL_MEDIA.has(target);
  const options: Record<string, unknown> = {
    from: READERS[input],
    to: WRITERS[target],
    'input-files': [inputName],
    'output-file': outputName,
    standalone: true,
    ...(external ? { 'extract-media': MEDIA_ZIP } : {}),
    ...(target === 'html' ? { 'embed-resources': true } : {}),
    ...(target === 'pdf' ? { variables: { papersize: pageSize === 'letter' ? 'us-letter' : 'a4' } } : {}),
  };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const outputs = [outputName, ...(external ? [MEDIA_ZIP] : [])];
  const result = await runPandoc(module, options, { [inputName]: bytes }, outputs);
  const written = result.files[outputName];
  if (!written?.length) throw pandocFailure(result.stderr, result.warnings);

  const lost = result.warnings.filter((warning) => LOST.has(warning.type)).length;
  const media = extractMedia(result.files[MEDIA_ZIP]);

  if (target === 'pdf') {
    const source = new TextDecoder().decode(written);
    const missing = NO_GLYPHS.exec(source)?.[0];
    if (missing) throw new RebakeError('unsupported', `PDF output has no font for some of this text (${missing}). Pick DOCX or HTML instead.`);
    const job: PdfJob = { source, media, lost, typst: request.typst };
    const tiffs = Object.entries(media).filter(([, content]) => sniff(content.subarray(0, 16)) === 'tiff');
    if (!tiffs.length) return buildPdf(job, context);
    waiting = job;
    return { tiffs: Object.fromEntries(tiffs) as TiffReply['tiffs'] };
  }

  const parts: OutputPart[] = Object.entries(media)
    .filter(([, content]) => content.length)
    .map(([name, content]) => ({ name, blob: new Blob([content as Uint8Array<ArrayBuffer>]), asset: true }));
  return {
    output: new Blob([written as Uint8Array<ArrayBuffer>]),
    path: 'pandoc',
    lost,
    ...(parts.length ? { media: parts } : {}),
  };
}

serve({ convert, finishPdf });
