import Papa from 'papaparse';
import { LineCounter, parseAllDocuments, stringify, YAMLError, YAMLParseError } from 'yaml';
import { RebakeError } from '../../core/errors';
import { fetchAssets, type AssetFile } from '../../core/fetch-asset';
import { FORMATS, type FormatId } from '../../core/formats';
import { serve, type HandlerContext } from '../../core/worker-runtime';
import type { ConvertRequest, InspectRequest } from './protocol';

type Sheetjs = typeof import('xlsx');
type Table = { columns: string[]; rows: unknown[][] };

let sheetjs: Sheetjs | undefined;

async function loadSheetjs(asset: AssetFile, context: HandlerContext) {
  if (sheetjs) return sheetjs;
  await fetchAssets([asset], context.progress);
  sheetjs = (await import(/* @vite-ignore */ asset.url)) as Sheetjs;
  return sheetjs;
}

async function readWorkbook(file: File, asset: AssetFile, context: HandlerContext) {
  const xlsx = await loadSheetjs(asset, context);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { xlsx, workbook: xlsx.read(bytes, { type: 'array', dense: true }) };
  } catch (error) {
    if (/password|encrypt/i.test(String(error))) throw new RebakeError('locked', 'password');
    throw new RebakeError('corrupt', String(error));
  }
}

const label = (format: FormatId) => FORMATS[format].label;

/** A number only when writing it back gives the same digits, so `007` and long IDs stay text. */
function typed(cell: string): unknown {
  if (cell === 'true') return true;
  if (cell === 'false') return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(cell) && cell.length <= 15) return Number(cell);
  return cell;
}

function parseDelimited(text: string, format: 'csv' | 'tsv') {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter: format === 'tsv' ? '\t' : '', // Empty detects `;`, which spreadsheets write in much of Europe.
    skipEmptyLines: 'greedy',
  });
  const broken = parsed.errors.find((error) => error.type === 'Quotes');
  if (broken) throw new RebakeError('unsupported', `This ${label(format)} has an unclosed quote on row ${(broken.row ?? 0) + 1}.`);
  const [header, ...rows] = parsed.data;
  if (!header) throw new RebakeError('unsupported', `This ${label(format)} is empty.`);
  const long = rows.findIndex((row) => row.length > header.length);
  if (long >= 0) throw new RebakeError('unsupported', `Row ${long + 2} has more columns than the header.`);
  return { columns: header, rows };
}

function asRecords({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return rows.map((row) => Object.fromEntries(columns.map((column, i) => [column, typed(row[i] ?? '')])));
}

function describeYamlError(error: unknown, format: FormatId): RebakeError {
  const line = error instanceof YAMLParseError ? error.linePos?.[0]?.line : undefined;
  return new RebakeError('unsupported', `This ${label(format)} has a syntax error${line ? ` on line ${line}` : ''}.`);
}

function yamlErrorLine(text: string) {
  const lineCounter = new LineCounter();
  const [first] = parseAllDocuments(text, { lineCounter, version: '1.2' }) as unknown as { errors: YAMLParseError[] }[];
  return first?.errors[0]?.linePos?.[0]?.line;
}

/** The slow path keeps integers beyond 2^53, which `JSON.parse` would silently round. */
function parseStructured(text: string, format: 'json' | 'yaml'): unknown {
  const clean = text.replace(/^\uFEFF/, '');
  if (format === 'json') {
    let value: unknown;
    try {
      value = JSON.parse(clean);
    } catch (error) {
      // YAML accepts things JSON doesn't, but where it objects it can name the line.
      const line = /line (\d+)/.exec(String(error))?.[1] ?? yamlErrorLine(clean);
      throw new RebakeError('unsupported', `This JSON has a syntax error${line ? ` on line ${line}` : ''}.`);
    }
    if (!/\d{16}/.test(clean)) return value;
  }
  const lineCounter = new LineCounter();
  const documents = parseAllDocuments(clean, { intAsBigInt: true, lineCounter, version: '1.2' });
  const list = 'empty' in documents ? [] : [...documents];
  for (const document of list) {
    if (document.errors[0]) throw describeYamlError(document.errors[0], format);
  }
  if (!list.length) throw new RebakeError('unsupported', `This ${label(format)} is empty.`);
  try {
    const values = list.map((document) => document.toJS({ maxAliasCount: 100 }));
    return values.length === 1 ? values[0] : values;
  } catch (error) {
    if (error instanceof YAMLError || error instanceof ReferenceError) throw describeYamlError(error, format);
    throw error;
  }
}

/** Nested objects become dotted columns. Arrays stay as JSON in their cell. */
function flatten(record: Record<string, unknown>, prefix = '', into: Record<string, unknown> = {}) {
  for (const [key, value] of Object.entries(record)) {
    const name = prefix + key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value as Record<string, unknown>, `${name}.`, into);
    else into[name] = value;
  }
  return into;
}

function toTable(value: unknown, input: FormatId, target: FormatId): Table {
  const records = Array.isArray(value) ? value : [value];
  const isRecord = (item: unknown) => !!item && typeof item === 'object' && !Array.isArray(item);
  if (!records.length || !records.every(isRecord)) {
    throw new RebakeError('unsupported', `This ${label(input)} isn't a list of records, so it can't become ${label(target)}.`);
  }
  const flat = records.map((record) => flatten(record as Record<string, unknown>));
  const columns = [...new Set(flat.flatMap((record) => Object.keys(record)))];
  return { columns, rows: flat.map((record) => columns.map((column) => record[column])) };
}

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, jsonValue);
  return String(value);
};

const writeDelimited = ({ columns, rows }: Table, delimiter: string) =>
  `${Papa.unparse({ fields: columns, data: rows.map((row) => row.map(cell)) }, { delimiter, newline: '\n' })}\n`;

/** BigInt has no JSON form until `rawJSON`. A string keeps every digit where that's missing. */
function jsonValue(_key: string, value: unknown) {
  if (typeof value !== 'bigint') return value;
  const raw = (JSON as unknown as { rawJSON?(text: string): unknown }).rawJSON;
  return raw ? raw(String(value)) : String(value);
}

function write(value: unknown, input: FormatId, target: FormatId): string {
  if (target === 'json') return `${JSON.stringify(value, jsonValue, 2)}\n`;
  if (target === 'yaml') return stringify(value, { aliasDuplicateObjects: false });
  return writeDelimited(toTable(value, input, target), target === 'tsv' ? '\t' : ',');
}

async function convert({ file, input, target, options, xlsx }: ConvertRequest, context: HandlerContext) {
  context.progress({ stage: 'converting', fraction: null });
  if (input === 'xlsx') {
    const { xlsx: library, workbook } = await readWorkbook(file, xlsx, context);
    const name = options.sheet && workbook.SheetNames.includes(options.sheet) ? options.sheet : workbook.SheetNames[0];
    const sheet = name === undefined ? undefined : workbook.Sheets[name];
    if (!sheet) throw new RebakeError('corrupt', 'no sheets');
    return { text: library.utils.sheet_to_csv(sheet, { blankrows: false }) };
  }
  const text = await file.text();
  if (input === 'csv' || input === 'tsv') {
    const table = parseDelimited(text, input);
    if (target === 'csv' || target === 'tsv') {
      return { text: writeDelimited(table, target === 'tsv' ? '\t' : ',') };
    }
    return { text: write(asRecords(table), input, target) };
  }
  return { text: write(parseStructured(text, input as 'json' | 'yaml'), input, target) };
}

async function sheets({ file, xlsx }: InspectRequest, context: HandlerContext) {
  const { workbook } = await readWorkbook(file, xlsx, context);
  return workbook.SheetNames;
}

serve({ convert, sheets });
