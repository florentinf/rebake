// Generates test fixtures outside the repo (REBAKE_FIXTURES, default ../rebake-fixtures).
// HEIC needs macOS `sips`: there's no free HEVC encoder here, so CI runs without it.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import Vips from 'wasm-vips';
import * as XLSX from 'xlsx';

const dir = resolve(process.env.REBAKE_FIXTURES ?? '../rebake-fixtures');
mkdirSync(dir, { recursive: true });

if (process.argv.includes('--large')) {
  makeLarge(dir);
  process.exit(0);
}
const vips = await Vips({ dynamicLibraries: ['vips-heif.wasm', 'vips-jxl.wasm', 'vips-resvg.wasm'] });

const W = 240, H = 160;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#0a7"/><stop offset="1" stop-color="#e30"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="80" cy="80" r="50" fill="#fff" fill-opacity=".7"/></svg>`;
writeFileSync(`${dir}/sample.svg`, svg);

const image = vips.Image.newFromBuffer(Buffer.from(svg)).flatten({ background: [255, 255, 255] }).copy();
image.setInt('orientation', 1);
const save = (name, options = {}) => writeFileSync(`${dir}/${name}`, image.writeToBuffer(`.${name.split('.').pop()}`, options));
save('sample.jpg', { Q: 90 });
save('sample.png');
save('sample.webp');
save('sample.avif', { effort: 1 });
save('sample.gif');
save('sample.tiff');
save('sample.jxl');

// EXIF orientation 6 + GPS-bearing metadata, to prove rotation and stripping.
const rotated = image.copy();
rotated.setInt('orientation', 6);
rotated.setString('exif-ifd0-Artist', 'rebake-fixture-marker');
rotated.setString('exif-ifd2-UserComment', 'rebake-fixture-marker');
writeFileSync(`${dir}/rotated.jpg`, rotated.writeToBuffer('.jpg', { keep: 'all' }));

// Two-frame GIF: animation should survive GIF→WebP and not break GIF→JPG.
const frames = vips.Image.arrayjoin([image, image.invert()], { across: 1 }).copy();
frames.setInt('page-height', H);
writeFileSync(`${dir}/animated.gif`, frames.writeToBuffer('.gif'));

// 48×48 ICO, one 32-bit DIB entry: the classic layout.
const small = image.thumbnailImage(48, { height: 48, crop: 'centre' });
const rgba = small.addalpha().writeToMemory();
const dibHeader = 40, pixels = 48 * 48 * 4, mask = 48 * 4;
const ico = Buffer.alloc(6 + 16 + dibHeader + pixels + mask);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(48, 6); ico.writeUInt8(48, 7); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(dibHeader + pixels + mask, 14); ico.writeUInt32LE(22, 18);
ico.writeUInt32LE(40, 22); ico.writeInt32LE(48, 26); ico.writeInt32LE(96, 30); ico.writeUInt16LE(1, 34); ico.writeUInt16LE(32, 36);
for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
  const from = (y * 48 + x) * 4, to = 62 + ((47 - y) * 48 + x) * 4;
  ico[to] = rgba[from + 2]; ico[to + 1] = rgba[from + 1]; ico[to + 2] = rgba[from]; ico[to + 3] = rgba[from + 3];
}
writeFileSync(`${dir}/sample.ico`, ico);

if (process.platform === 'darwin') {
  execFileSync('sips', ['-s', 'format', 'heic', `${dir}/sample.png`, '--out', `${dir}/sample.heic`], { stdio: 'ignore' });
  const real = `${dir}/real`;
  if (existsSync(real)) console.log('real/ photos kept');
} else {
  rmSync(`${dir}/sample.heic`, { force: true });
}
writeFileSync(`${dir}/corrupt.png`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]));
writeFileSync(`${dir}/notes.txt`, 'not an image\n');
makeMedia(dir);
await makeDocuments(dir);
await makePdfs(dir);
makeData(dir);
console.log(`fixtures in ${dir}`);
process.exit(0);

/** Media needs ffmpeg with x264, x265, libvpx, SVT-AV1, Opus and LAME. Files already there are kept. */
function ffmpeg(...args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

function makeMedia(out) {
  const picture = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2'];
  const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2,aformat=channel_layouts=stereo'];
  const h264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'];
  const hevc = ['-c:v', 'libx265', '-preset', 'veryfast', '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'];
  const vp9 = ['-c:v', 'libvpx-vp9', '-b:v', '600k', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p'];
  const av1 = ['-c:v', 'libsvtav1', '-preset', '12', '-pix_fmt', 'yuv420p', '-svtav1-params', 'lp=4'];
  const aac = ['-c:a', 'aac', '-b:a', '128k'];
  const opus = ['-c:a', 'libopus', '-b:a', '96k'];

  // The container × codec table from SPEC.md, as inputs. MOV has no VP9 or AV1 row:
  // ffmpeg refuses to write them ("only supported in MP4"), so such files don't exist in practice.
  const videos = {
    'h264-aac.mp4': [...h264, ...aac],
    'h264-aac.mov': [...h264, ...aac],
    'h264-aac.mkv': [...h264, ...aac],
    'hevc-aac.mov': [...hevc, ...aac],
    'hevc-aac.mp4': [...hevc, ...aac],
    'hevc-aac.mkv': [...hevc, ...aac],
    'vp9-opus.webm': [...vp9, ...opus],
    'vp9-opus.mkv': [...vp9, ...opus],
    'vp9-aac.mp4': [...vp9, ...aac],
    'av1-opus.webm': [...av1, ...opus],
    'av1-opus.mkv': [...av1, ...opus],
    'av1-aac.mp4': [...av1, ...aac],
  };
  for (const [name, codecs] of Object.entries(videos)) {
    if (!existsSync(`${out}/${name}`)) ffmpeg(...picture, ...tone, ...codecs, '-shortest', `${out}/${name}`);
  }
  if (!existsSync(`${out}/silent.mp4`)) ffmpeg(...picture, ...h264, `${out}/silent.mp4`);
  // Portrait by rotation metadata, the way a phone records it.
  if (!existsSync(`${out}/rotated.mov`)) {
    ffmpeg('-display_rotation', '90', '-i', `${out}/h264-aac.mov`, '-c', 'copy', `${out}/rotated.mov`);
  }
  // Over the GIF limit, at a low enough rate to keep the file small.
  if (!existsSync(`${out}/long.mp4`)) {
    ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=20',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', ...h264, ...aac, '-shortest', `${out}/long.mp4`);
  }
  // Tagged HDR. Muted on purpose: pure testsrc2 colours clip, which would hide a missing gamut conversion.
  const hdr = ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=2,eq=saturation=0.35'];
  const hdrCodec = ['-c:v', 'libx265', '-preset', 'veryfast', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-color_primaries', 'bt2020', '-colorspace', 'bt2020nc'];
  if (!existsSync(`${out}/hdr-hlg.mov`)) {
    ffmpeg(...hdr, ...tone, ...hdrCodec, '-color_trc', 'arib-std-b67',
      '-x265-params', 'log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc', ...aac, '-shortest', `${out}/hdr-hlg.mov`);
  }
  if (!existsSync(`${out}/hdr-pq.mp4`)) {
    ffmpeg(...hdr, ...tone, ...hdrCodec, '-color_trc', 'smpte2084',
      '-x265-params', 'log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc', ...aac, '-shortest', `${out}/hdr-pq.mp4`);
  }

  const sound = ['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=3,aformat=channel_layouts=stereo'];
  const audios = {
    'sample.mp3': ['-c:a', 'libmp3lame', '-b:a', '128k'],
    'sample.m4a': ['-c:a', 'aac', '-b:a', '128k'],
    'sample.aac': ['-c:a', 'aac', '-b:a', '128k'],
    'sample.opus': ['-c:a', 'libopus', '-b:a', '96k'],
    'opus-in.ogg': ['-c:a', 'libopus', '-b:a', '96k'],
    'vorbis.ogg': ['-c:a', 'vorbis', '-strict', '-2', '-ac', '2'],
    'sample.flac': ['-c:a', 'flac'],
    'sample.wav': ['-c:a', 'pcm_s16le'],
    'deep.flac': ['-c:a', 'flac', '-sample_fmt', 's32', '-ar', '96000'],
  };
  for (const [name, codec] of Object.entries(audios)) {
    if (!existsSync(`${out}/${name}`)) ffmpeg(...sound, ...codec, `${out}/${name}`);
  }

  // Keeps its real header, loses the rest: opens as MP4, then has nothing behind it.
  copyFileSync(`${out}/h264-aac.mp4`, `${out}/corrupt.mp4`);
  truncateSync(`${out}/corrupt.mp4`, 2000);
}

/** Documents need pandoc. Each carries the marker text, and the richer formats a PNG and a JPG. */
async function makeDocuments(out) {
  const work = `${out}/.doc-work`;
  mkdirSync(work, { recursive: true });
  save('.doc-work/picture.png');
  save('.doc-work/photo.jpg', { Q: 80 });
  const text = '# rebake-doc-marker\n\nA paragraph with *emphasis*, **strong** and accents: café.\n\n| Name | Count |\n| --- | --- |\n| one | 1 |\n| two | 2 |\n\n- first\n- second\n';
  writeFileSync(`${work}/plain.md`, text);
  writeFileSync(`${work}/images.md`, `${text}\n![A chart](picture.png)\n\n![A photo](photo.jpg)\n`);
  const pandoc = (from, ...args) => execFileSync('pandoc', [from, '--standalone', ...args], { cwd: work, stdio: 'inherit' });
  copyFileSync(`${work}/plain.md`, `${out}/sample.md`);
  pandoc('plain.md', '-o', `${out}/sample.tex`);
  pandoc('plain.md', '-o', `${out}/sample.rtf`);
  pandoc('images.md', '--embed-resources', '--metadata', 'title=Sample', '-o', `${out}/sample.html`);
  pandoc('images.md', '-o', `${out}/sample.docx`);
  pandoc('images.md', '-o', `${out}/sample.odt`);
  pandoc('images.md', '--metadata', 'title=Sample', '-o', `${out}/sample.epub`);
  rmSync(work, { recursive: true, force: true });
  writeFileSync(`${out}/corrupt.docx`, readFileSync(`${out}/sample.docx`).subarray(0, 900));
  // Text no bundled font can draw: the PDF must refuse, not print empty boxes.
  writeFileSync(`${out}/japanese.md`, '# 見出し\n\nこれは日本語の文章です。\n');
}

async function makePdfs(out) {
  const build = async (pages) => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= pages; i++) {
      document.addPage([595.28, 841.89]).drawText(`rebake page ${i}`, { x: 72, y: 720, size: 32, font });
    }
    return document.save();
  };
  writeFileSync(`${out}/sample.pdf`, await build(3));
  writeFileSync(`${out}/one-page.pdf`, await build(1));
  writeFileSync(`${out}/corrupt.pdf`, Buffer.from('%PDF-1.7\nthis is not a real document\n'));
  execFileSync('qpdf', ['--encrypt', 'secret', 'secret', '256', '--', `${out}/one-page.pdf`, `${out}/locked.pdf`]);
}

function makeData(out) {
  const rows = [['id', 'name', 'note'], ['007', 'Zoë', 'has, a comma'], ['42', 'Bob', 'says "hi"']];
  writeFileSync(`${out}/sample.csv`, 'id,name,note\n007,Zoë,"has, a comma"\n42,Bob,"says ""hi"""\n');
  writeFileSync(`${out}/sample.tsv`, 'id\tname\tnote\n007\tZoë\thas, a comma\n42\tBob\tsays "hi"\n');
  const records = [{ id: '007', name: 'Zoë', note: 'has, a comma' }, { id: 42, name: 'Bob', note: 'says "hi"' }];
  writeFileSync(`${out}/sample.json`, `${JSON.stringify(records, null, 2)}\n`);
  writeFileSync(`${out}/sample.yaml`, '- id: "007"\n  name: Zoë\n  note: has, a comma\n- id: 42\n  name: Bob\n  note: says "hi"\n');
  writeFileSync(`${out}/nested.json`, '[{"id":9007199254740993,"who":{"name":"A","age":3},"tags":["x","y"]}]\n');
  writeFileSync(`${out}/scalar.json`, '"just a string"\n');
  writeFileSync(`${out}/bad.json`, '{\n  "a": 1,\n  "b": \n}\n');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Alpha');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['only'], ['beta-marker']]), 'Beta');
  writeFileSync(`${out}/sample.xlsx`, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

/** A file over 1 GB: incompressible 1080p H.264, looped by stream copy. */
function makeLarge(out) {
  const path = `${out}/large.mov`;
  if (existsSync(path) && statSync(path).size > 1e9) {
    console.log(`${path} kept`);
    return;
  }
  const seed = `${out}/large-seed.mov`;
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10,noise=alls=40:allf=t',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '120M', '-maxrate', '120M', '-bufsize', '240M', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', seed);
  const size = statSync(seed).size;
  ffmpeg('-stream_loop', String(Math.ceil(1.15e9 / size) - 1), '-i', seed, '-c', 'copy', path);
  rmSync(seed);
  console.log(`${path}: ${(statSync(path).size / 1e9).toFixed(2)} GB`);
}
