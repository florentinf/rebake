import engines from 'virtual:engines';
import { platform } from '../../core/capabilities';
import type { ConvertOptions, ConvertResult, Engine, Inspection, OnProgress, SourceFile } from '../../core/engine';
import { uncachedBytes } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { WorkerHost } from '../../core/worker-host';
import type { ConvertReply, ConvertRequest, InspectRequest } from './protocol';

const host = new WorkerHost(
  () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'rebake-data' }),
);

const TEXT: FormatId[] = ['csv', 'tsv', 'json', 'yaml'];
const xlsxFile = () => engines.xlsx.files['xlsx.mjs']!;

export const dataEngine: Engine = {
  id: 'data',

  async probe() {
    return platform.wasm ? { available: true } : { available: false, reason: "This browser can't run the converter." };
  },

  targets(input) {
    return input === 'xlsx' ? ['csv'] : TEXT;
  },

  /** Only a workbook has anything to ask about. Text formats open without loading a thing. */
  async inspect({ file, format }: SourceFile): Promise<Inspection> {
    const targets = this.targets(format);
    if (format !== 'xlsx') return { targets };
    const request: InspectRequest = { file, xlsx: xlsxFile() };
    return { targets, sheets: await host.call<string[]>('sheets', request) };
  },

  async downloadSize(input) {
    return input === 'xlsx' ? uncachedBytes([xlsxFile()]) : 0;
  },

  async convert(source: SourceFile, target: FormatId, options: ConvertOptions, onProgress: OnProgress, signal: AbortSignal): Promise<ConvertResult> {
    const request: ConvertRequest = { file: source.file, input: source.format, target, options, xlsx: xlsxFile() };
    const reply = await host.call<ConvertReply>('convert', request, { onProgress, signal });
    return { blob: new Blob([reply.text], { type: FORMATS[target].mime }), path: `data:${source.format}` };
  },
};
