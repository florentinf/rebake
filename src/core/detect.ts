import { FORMATS, sameFormat, type FormatId } from './formats';

const HEAD_BYTES = 4096;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, len: number) =>
  String.fromCharCode(...b.subarray(at, at + len));

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function isoBmffImage(b: Uint8Array): FormatId | null {
  if (ascii(b, 4, 4) !== 'ftyp') return null;
  const boxSize = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0);
  const end = Math.min(boxSize, b.length);
  const brands = [ascii(b, 8, 4)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(b, at, 4));
  // The major brand wins; `mif1`-major files name their real codec among the compatible brands.
  if (AVIF_BRANDS.has(brands[0]!)) return 'avif';
  if (HEIC_BRANDS.has(brands[0]!)) return 'heic';
  if (brands.some((x) => AVIF_BRANDS.has(x))) return 'avif';
  if (brands.some((x) => HEIC_BRANDS.has(x))) return 'heic';
  return brands.includes('mif1') || brands.includes('msf1') ? 'heic' : null;
}

const QUICKTIME_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

/** ISO BMFF that isn't an image. Runs after the image check, which owns `mif1` and friends. */
function isoBmffMedia(b: Uint8Array): FormatId | null {
  const box = ascii(b, 4, 4);
  if (box !== 'ftyp') return QUICKTIME_ATOMS.has(box) ? 'mov' : null;
  const major = ascii(b, 8, 4);
  if (major === 'qt  ') return 'mov';
  return major === 'M4A ' || major === 'M4B ' ? 'm4a' : 'mp4';
}

function matroska(b: Uint8Array): FormatId | null {
  if (!startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  return ascii(b, 0, Math.min(b.length, 64)).includes('webm') ? 'webm' : 'mkv';
}

/** ADTS and MP3 frames both open with a sync word; only the layer bits differ. */
function audioFrame(b: Uint8Array): FormatId | null {
  if (b[0] !== 0xff || (b[1]! & 0xe0) !== 0xe0) return null;
  if ((b[1]! & 0xf6) === 0xf0) return 'aac';
  const hasLayer = (b[1]! & 0x06) !== 0;
  const hasVersion = (b[1]! & 0x18) !== 0x08;
  const validBitrate = (b[2]! & 0xf0) !== 0xf0;
  return hasLayer && hasVersion && validBitrate ? 'mp3' : null;
}

function isIco(b: Uint8Array): boolean {
  if (!(startsWith(b, [0, 0, 1, 0]) || startsWith(b, [0, 0, 2, 0]))) return false;
  const count = b[4]! | (b[5]! << 8);
  // Four-byte signature is weak: require a sane directory too.
  return count > 0 && count < 256 && b[9] === 0 && b.length >= 22;
}

function looksLikeSvg(b: Uint8Array): boolean {
  const text = new TextDecoder().decode(b).trimStart();
  return text.startsWith('<') && /<svg[\s>]/i.test(text);
}

/** A ZIP's first entries name what it really is. Null when they don't say. */
function zipBased(b: Uint8Array): FormatId | null {
  if (!startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || b.length < 30) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const nameLength = view.getUint16(26, true);
  if (ascii(b, 30, nameLength) === 'mimetype') {
    const type = ascii(b, 30 + nameLength + view.getUint16(28, true), 60);
    if (type.startsWith('application/epub+zip')) return 'epub';
    if (type.startsWith('application/vnd.oasis.opendocument.text')) return 'odt';
    return null;
  }
  const names = new Set<string>();
  for (let at = 0; at + 30 < b.length && view.getUint32(at, true) === 0x04034b50;) {
    const length = view.getUint16(at + 26, true);
    names.add(ascii(b, at + 30, Math.min(length, b.length - at - 30)));
    if (view.getUint16(at + 6, true) & 8) break; // Size comes after the data: can't step over it.
    at += 30 + length + view.getUint16(at + 28, true) + view.getUint32(at + 18, true);
  }
  const has = (prefix: string) => [...names].some((name) => name.startsWith(prefix));
  if (has('word/')) return 'docx';
  if (has('xl/')) return 'xlsx';
  // Office writes this first. Bytes alone can't always say which, so the zip family and the name decide.
  return names.has('[Content_Types].xml') ? 'docx' : null;
}

function hasPdfMarker(b: Uint8Array): boolean {
  // Readers accept junk before the header, up to the first kilobyte.
  return ascii(b, 0, Math.min(b.length, 1024)).includes('%PDF-');
}

const looksLikeHtml = (b: Uint8Array) =>
  /^\s*(<!--[\s\S]*?-->\s*)*<(!doctype\s+html|html[\s>])/i.test(new TextDecoder().decode(b));

/** Identifies a format from its first bytes alone. */
export function sniff(bytes: Uint8Array): FormatId | null {
  const b = bytes;
  if (b.length < 4) return null;
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if ((ascii(b, 0, 4) === 'RIFF' || ascii(b, 0, 4) === 'RF64') && ascii(b, 8, 4) === 'WAVE') return 'wav';
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 4) === 'OggS') return ascii(b, 28, 8) === 'OpusHead' ? 'opus' : 'ogg';
  if (ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (startsWith(b, [0xff, 0x0a])) return 'jxl';
  if (startsWith(b, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return 'jxl';
  const iso = b.length >= 16 ? isoBmffImage(b) : null;
  if (iso) return iso;
  const media = (b.length >= 12 ? isoBmffMedia(b) : null) ?? matroska(b) ?? audioFrame(b);
  if (media) return media;
  if (isIco(b)) return 'ico';
  if (ascii(b, 0, 5) === '{\\rtf') return 'rtf';
  if (hasPdfMarker(b)) return 'pdf';
  const zip = zipBased(b);
  if (zip) return zip;
  if (looksLikeHtml(b)) return 'html';
  if (looksLikeSvg(b)) return 'svg';
  return null;
}

/** Text can start with anything, so `ID3,name` in a .csv mustn't read as an MP3. */
function binary(head: Uint8Array): boolean {
  return head.includes(0);
}

function byExtension(name: string): FormatId | null {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!ext) return null;
  for (const [id, info] of Object.entries(FORMATS)) {
    if (info.extension === ext || info.aliases?.includes(ext)) return id as FormatId;
  }
  return null;
}

function byMime(mime: string): FormatId | null {
  for (const [id, info] of Object.entries(FORMATS)) if (info.mime === mime) return id as FormatId;
  return null;
}

/** Magic bytes first, then the extension, then the MIME type. */
export async function detect(file: File): Promise<FormatId | null> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const sniffed = sniff(head);
  const named = byExtension(file.name);
  if (named && FORMATS[named].text && !binary(head)) return named;
  // An .m4a can be `isom` inside, and an .ogg can hold Opus: same bytes, so the name decides.
  if (sniffed && named && sameFormat(sniffed, named)) return named;
  return sniffed ?? named ?? byMime(file.type);
}
