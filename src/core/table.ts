import type { FormatId } from './formats';

export type EngineId = 'image' | 'media' | 'document' | 'pdf' | 'data';

export interface Row {
  engine: EngineId;
  /** Offered targets; the first is the preselected default. */
  targets: FormatId[];
  /** Targets another engine writes, as images to PDF. */
  via?: Partial<Record<FormatId, EngineId>>;
}

const raster = (...targets: FormatId[]): Row => ({ engine: 'image', targets: [...targets, 'pdf'], via: { pdf: 'pdf' } });
const media = (...targets: FormatId[]): Row => ({ engine: 'media', targets });
const document = (...targets: FormatId[]): Row => ({ engine: 'document', targets });
const data = (...targets: FormatId[]): Row => ({ engine: 'data', targets });
const ALL_AUDIO: FormatId[] = ['mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav'];
/** Extracting audio: a video's audio targets, in the same order everywhere. */
const audioFrom = (input: FormatId) => ALL_AUDIO.filter((format) => format !== input);

/**
 * The whole conversion graph as plain data, so the build can read it without
 * loading an engine. Static on purpose: no search, no chaining.
 */
export const TABLE: Partial<Record<FormatId, Row>> = {
  heic: raster('jpg', 'png', 'webp', 'avif', 'jxl', 'tiff', 'gif', 'ico'),
  jpg: raster('png', 'webp', 'avif', 'jxl', 'tiff', 'gif', 'ico'),
  png: raster('jpg', 'webp', 'avif', 'jxl', 'tiff', 'gif', 'ico'),
  webp: raster('jpg', 'png', 'avif', 'jxl', 'tiff', 'gif', 'ico'),
  avif: raster('jpg', 'png', 'webp', 'jxl', 'tiff', 'gif', 'ico'),
  gif: raster('webp', 'png', 'jpg', 'avif', 'jxl', 'tiff', 'ico'),
  tiff: raster('jpg', 'png', 'webp', 'avif', 'jxl', 'gif', 'ico'),
  jxl: raster('jpg', 'png', 'webp', 'avif', 'tiff', 'gif', 'ico'),
  svg: raster('png', 'jpg', 'webp', 'avif', 'jxl', 'tiff', 'gif', 'ico'),
  ico: raster('png', 'jpg', 'webp', 'avif', 'jxl', 'tiff', 'gif'),

  mov: media('mp4', 'webm', 'mkv', 'gif', ...ALL_AUDIO),
  mp4: media('mp3', 'webm', 'mov', 'mkv', 'gif', 'm4a', 'opus', 'ogg', 'flac', 'wav'),
  webm: media('mp4', 'mov', 'mkv', 'gif', ...ALL_AUDIO),
  mkv: media('mp4', 'webm', 'mov', 'gif', ...ALL_AUDIO),

  mp3: media(...audioFrom('mp3')),
  m4a: media(...audioFrom('m4a')),
  aac: media(...ALL_AUDIO),
  opus: media(...audioFrom('opus')),
  ogg: media(...audioFrom('ogg')),
  flac: media(...audioFrom('flac')),
  wav: media(...audioFrom('wav')),

  docx: document('pdf', 'md', 'html', 'odt', 'epub', 'rtf', 'tex'),
  odt: document('docx', 'pdf', 'md', 'html', 'epub', 'rtf', 'tex'),
  md: document('pdf', 'docx', 'html', 'odt', 'epub', 'rtf', 'tex'),
  html: document('pdf', 'docx', 'md', 'odt', 'epub', 'rtf', 'tex'),
  epub: document('pdf', 'docx', 'md', 'html', 'odt', 'rtf', 'tex'),
  rtf: document('docx', 'pdf', 'md', 'html', 'odt', 'epub', 'tex'),
  tex: document('pdf', 'docx', 'md', 'html', 'odt', 'epub', 'rtf'),

  pdf: { engine: 'pdf', targets: ['png', 'jpg'] },

  csv: data('json', 'yaml', 'tsv'),
  tsv: data('csv', 'json', 'yaml'),
  json: data('csv', 'yaml', 'tsv'),
  yaml: data('json', 'csv', 'tsv'),
  xlsx: data('csv'),
};

// Keep the familiar conversion default first. Processing the current format is
// offered for engines with real same-format operations, never for read-only inputs.
const PROCESSABLE: FormatId[] = ['jpg', 'png', 'webp', 'avif', 'jxl', 'tiff', 'gif', 'ico', 'mp4', 'mov', 'webm', 'mkv', 'mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav', 'csv', 'tsv', 'json', 'yaml'];
for (const format of PROCESSABLE) TABLE[format]!.targets.push(format);

export const engineIdFor = (row: Row, target: FormatId): EngineId => row.via?.[target] ?? row.engine;
