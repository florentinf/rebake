/** Every format rebake can read or write. Sessions 2 and 3 add to this union. */
export type FormatId =
  | 'jpg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff' | 'heic' | 'jxl' | 'svg' | 'ico'
  | 'mp4' | 'mov' | 'webm' | 'mkv'
  | 'mp3' | 'm4a' | 'aac' | 'opus' | 'ogg' | 'flac' | 'wav'
  | 'md' | 'html' | 'docx' | 'odt' | 'epub' | 'rtf' | 'tex'
  | 'pdf'
  | 'csv' | 'tsv' | 'json' | 'yaml' | 'xlsx';

export type Category = 'image' | 'video' | 'audio' | 'document' | 'pdf' | 'data';

export interface FormatInfo {
  label: string;
  extension: string;
  mime: string;
  category: Category;
  /** Extensions that also mean this format, without the dot. */
  aliases?: string[];
  /** Quality setting applies when writing this format. */
  lossy?: boolean;
  /** Formats sharing a container. Bytes can't always tell these apart, so the extension decides. */
  family?: 'isobmff' | 'matroska' | 'ogg' | 'zip';
  /** Plain text: no magic bytes to check, and an extension outranks a lookalike head. */
  text?: boolean;
  /** Name in URLs, where the extension isn't what people search for. */
  slug?: string;
}

export const FORMATS: Record<FormatId, FormatInfo> = {
  jpg: { label: 'JPG', extension: 'jpg', mime: 'image/jpeg', category: 'image', aliases: ['jpeg', 'jpe', 'jfif'], lossy: true },
  png: { label: 'PNG', extension: 'png', mime: 'image/png', category: 'image' },
  webp: { label: 'WebP', extension: 'webp', mime: 'image/webp', category: 'image', lossy: true },
  avif: { label: 'AVIF', extension: 'avif', mime: 'image/avif', category: 'image', lossy: true },
  gif: { label: 'GIF', extension: 'gif', mime: 'image/gif', category: 'image' },
  tiff: { label: 'TIFF', extension: 'tiff', mime: 'image/tiff', category: 'image', aliases: ['tif'] },
  heic: { label: 'HEIC', extension: 'heic', mime: 'image/heic', category: 'image', aliases: ['heif', 'hif'] },
  jxl: { label: 'JPEG XL', extension: 'jxl', mime: 'image/jxl', category: 'image', lossy: true },
  svg: { label: 'SVG', extension: 'svg', mime: 'image/svg+xml', category: 'image' },
  ico: { label: 'ICO', extension: 'ico', mime: 'image/x-icon', category: 'image', aliases: ['cur'] },
  mp4: { label: 'MP4', extension: 'mp4', mime: 'video/mp4', category: 'video', aliases: ['m4v'], family: 'isobmff' },
  mov: { label: 'MOV', extension: 'mov', mime: 'video/quicktime', category: 'video', aliases: ['qt'], family: 'isobmff' },
  webm: { label: 'WebM', extension: 'webm', mime: 'video/webm', category: 'video', family: 'matroska' },
  mkv: { label: 'MKV', extension: 'mkv', mime: 'video/x-matroska', category: 'video', family: 'matroska' },
  mp3: { label: 'MP3', extension: 'mp3', mime: 'audio/mpeg', category: 'audio', lossy: true },
  m4a: { label: 'M4A', extension: 'm4a', mime: 'audio/mp4', category: 'audio', aliases: ['m4b'], lossy: true, family: 'isobmff' },
  aac: { label: 'AAC', extension: 'aac', mime: 'audio/aac', category: 'audio', lossy: true },
  opus: { label: 'Opus', extension: 'opus', mime: 'audio/opus', category: 'audio', lossy: true, family: 'ogg' },
  ogg: { label: 'OGG', extension: 'ogg', mime: 'audio/ogg', category: 'audio', aliases: ['oga'], lossy: true, family: 'ogg' },
  flac: { label: 'FLAC', extension: 'flac', mime: 'audio/flac', category: 'audio' },
  wav: { label: 'WAV', extension: 'wav', mime: 'audio/wav', category: 'audio', aliases: ['wave'] },
  md: { label: 'Markdown', extension: 'md', mime: 'text/markdown', category: 'document', aliases: ['markdown', 'mdown', 'mkd'], text: true, slug: 'markdown' },
  html: { label: 'HTML', extension: 'html', mime: 'text/html', category: 'document', aliases: ['htm', 'xhtml'], text: true },
  docx: { label: 'DOCX', extension: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document', family: 'zip' },
  odt: { label: 'ODT', extension: 'odt', mime: 'application/vnd.oasis.opendocument.text', category: 'document', family: 'zip' },
  epub: { label: 'EPUB', extension: 'epub', mime: 'application/epub+zip', category: 'document', family: 'zip' },
  rtf: { label: 'RTF', extension: 'rtf', mime: 'application/rtf', category: 'document' },
  tex: { label: 'LaTeX', extension: 'tex', mime: 'application/x-tex', category: 'document', aliases: ['latex'], text: true, slug: 'latex' },
  pdf: { label: 'PDF', extension: 'pdf', mime: 'application/pdf', category: 'pdf' },
  csv: { label: 'CSV', extension: 'csv', mime: 'text/csv', category: 'data', text: true },
  tsv: { label: 'TSV', extension: 'tsv', mime: 'text/tab-separated-values', category: 'data', aliases: ['tab'], text: true },
  json: { label: 'JSON', extension: 'json', mime: 'application/json', category: 'data', text: true },
  yaml: { label: 'YAML', extension: 'yaml', mime: 'application/yaml', category: 'data', aliases: ['yml'], text: true },
  xlsx: { label: 'XLSX', extension: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'data', family: 'zip' },
};

export const slugOf = (format: FormatId) => FORMATS[format].slug ?? format;

/** True when `actual` is what was asked for, or the same container under another name. */
export function sameFormat(actual: FormatId | null, wanted: FormatId): boolean {
  if (!actual) return false;
  if (actual === wanted) return true;
  const family = FORMATS[wanted].family;
  return !!family && FORMATS[actual].family === family;
}
