import type { ConvertOptions, ConvertResult, Engine, OnProgress, SourceFile } from './engine';
import { RebakeError } from './errors';
import { sniff } from './detect';
import { FORMATS, sameFormat, type FormatId } from './formats';
import { engineFor, offeredTargets, ROUTES } from './routes';
import { probeEngine } from './capabilities';
import { validateOptions } from './rendering';

async function isFormat(blob: Blob, target: FormatId): Promise<boolean> {
  const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  const found = sniff(bytes);
  if (sameFormat(found, target)) return true;
  // Text has no signature, and may open like one by chance. It must decode and hold something.
  if (!FORMATS[target].text || !bytes.length) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return !bytes.includes(0);
  } catch {
    return false;
  }
}

async function verified(result: ConvertResult, target: FormatId): Promise<ConvertResult> {
  const checks = (result.parts ?? [{ blob: result.blob }]).filter((part) => !('asset' in part && part.asset));
  for (const { blob } of checks) {
    if (!(await isFormat(blob, target))) {
      throw new RebakeError('mismatch', `The result wasn't a valid ${FORMATS[target].label}, so it was discarded.`);
    }
  }
  return result;
}

async function engineFrom(input: FormatId, target: FormatId): Promise<Engine> {
  const route = ROUTES[input];
  if (!route || !offeredTargets(route, input).includes(target)) {
    throw new RebakeError('unsupported', `Can't convert ${FORMATS[input].label} to ${FORMATS[target].label}.`);
  }
  const engine = engineFor(route, target);
  const probe = await probeEngine(engine);
  if (!probe.available) throw new RebakeError('unsupported', probe.reason ?? "This browser can't run the converter.");
  return engine;
}

/** Runs one job, and refuses to return a file that isn't the format asked for. */
export async function convert(
  source: SourceFile,
  target: FormatId,
  options: ConvertOptions,
  onProgress: OnProgress,
  signal: AbortSignal,
): Promise<ConvertResult> {
  validateOptions(options);
  const engine = await engineFrom(source.format, target);
  return verified(await engine.convert(source, target, options, onProgress, signal), target);
}

/** The PDF engine also renders PDFs, but its merge is images to PDF only. */
const imagesToPdf = (sources: SourceFile[], target: FormatId) =>
  target === 'pdf' && sources.every(({ format }) => FORMATS[format].category === 'image');

/** True when an engine takes this whole selection as one job. */
export function canMerge(sources: SourceFile[], target: FormatId): boolean {
  if (sources.length < 2 || !imagesToPdf(sources, target)) return false;
  return sources.every(({ format }) => {
    const route = ROUTES[format];
    return !!route && !!engineFor(route, target).merge && offeredTargets(route, format).includes(target);
  });
}

/** Several inputs into one file. Same checks as `convert`. */
export async function merge(
  sources: SourceFile[],
  target: FormatId,
  options: ConvertOptions,
  onProgress: OnProgress,
  signal: AbortSignal,
): Promise<ConvertResult> {
  validateOptions(options);
  const first = sources[0];
  const engine = first && imagesToPdf(sources, target) ? await engineFrom(first.format, target) : undefined;
  if (!engine?.merge) throw new RebakeError('unsupported', "These files can't be merged.");
  return verified(await engine.merge(sources, target, options, onProgress, signal), target);
}
