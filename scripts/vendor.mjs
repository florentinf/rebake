// Copies engine binaries out of node_modules into vendor/ and records their
// SHA-256 (`npm run vendor`). `--verify` checks vendor/ against those records
// and fails the build on any mismatch.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { gunzipSync, unzipSync } from 'fflate';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const PACKAGES = {
  vips: {
    from: 'node_modules/wasm-vips',
    files: {
      'vips-es6.js': 'lib/vips-es6.js',
      'vips.wasm': 'lib/vips.wasm',
      'vips-heif.wasm': 'lib/vips-heif.wasm',
      'vips-jxl.wasm': 'lib/vips-jxl.wasm',
      'vips-resvg.wasm': 'lib/vips-resvg.wasm',
    },
    licenses: { 'LICENSE': 'LICENSE', 'THIRD-PARTY-NOTICES.md': 'THIRD-PARTY-NOTICES.md' },
  },
  libheif: {
    from: 'node_modules/libheif-js',
    files: { 'libheif-bundle.mjs': 'libheif-wasm/libheif-bundle.mjs' },
    licenses: { 'LICENSE': 'LICENSE' },
  },
  // Mediabunny's encoder extensions. LAME and FFmpeg are LGPL, so these stay
  // separate, replaceable files and load only when a job needs them.
  mp3: {
    from: 'node_modules/@mediabunny/mp3-encoder',
    files: { 'mp3-encoder.mjs': 'dist/bundles/mediabunny-mp3-encoder.min.mjs' },
    licenses: { 'LICENSE': 'LICENSE', 'COPYING.lame': 'licenses/lame/COPYING' },
  },
  aac: {
    from: 'node_modules/@mediabunny/aac-encoder',
    files: { 'aac-encoder.mjs': 'dist/bundles/mediabunny-aac-encoder.min.mjs' },
    licenses: { 'LICENSE': 'LICENSE', 'COPYING.ffmpeg': 'licenses/ffmpeg/COPYING.LGPLv2.1' },
  },
  flac: {
    from: 'node_modules/@mediabunny/flac-encoder',
    files: { 'flac-encoder.mjs': 'dist/bundles/mediabunny-flac-encoder.min.mjs' },
    licenses: { 'LICENSE': 'LICENSE' },
  },
  // typst.ts: Typst compiled for the browser, used by the document engine for PDF.
  typst: {
    from: 'node_modules/@myriaddreamin/typst-ts-web-compiler',
    files: {
      'typst.mjs': 'pkg/typst_ts_web_compiler.mjs',
      'typst.wasm': 'pkg/typst_ts_web_compiler_bg.wasm',
    },
  },
  pdfjs: {
    from: 'node_modules/pdfjs-dist',
    files: {
      'pdf.mjs': 'build/pdf.min.mjs',
      'pdf.worker.mjs': 'build/pdf.worker.min.mjs',
      'openjpeg.wasm': 'wasm/openjpeg.wasm',
      'jbig2.wasm': 'wasm/jbig2.wasm',
      'qcms_bg.wasm': 'wasm/qcms_bg.wasm',
    },
    licenses: Object.fromEntries(['LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_QCMS', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_PDFJS_QCMS']
      .map((name) => [name, `wasm/${name}`]).concat([['LICENSE', 'LICENSE']])),
  },
  pdflib: {
    from: 'node_modules/pdf-lib',
    files: { 'pdf-lib.mjs': 'dist/pdf-lib.esm.min.js' },
    licenses: { 'LICENSE': 'LICENSE.md' },
  },
  // SheetJS isn't current on npm: the release comes from cdn.sheetjs.com (see package.json).
  xlsx: {
    from: 'node_modules/xlsx',
    files: { 'xlsx.mjs': 'xlsx.mjs' },
    licenses: { 'LICENSE': 'LICENSE' },
  },
};

/** The official release, not an npm rebuild. The hash pins what upstream published. */
const PANDOC = {
  version: '3.9',
  url: 'https://github.com/jgm/pandoc/releases/download/3.9/pandoc-3.9.wasm.zip',
  sha256: 'db4e31bc0c665cee724a0be507f47a7cbce99eceee15b2165babbb3bcb1fb1a7',
};

/** The fonts Typst's own CLI embeds. Pandoc's Typst template asks for these by name. */
const TYPST_FONTS = {
  version: '0.14.2',
  url: 'https://github.com/typst/typst-assets/archive/refs/tags/v0.14.2.tar.gz',
  sha256: 'b77fd810a31a3f75c26b87e0c4575904908d8954adf87085d61585fe622295e2',
  files: [
    'LibertinusSerif-Regular.otf', 'LibertinusSerif-Bold.otf', 'LibertinusSerif-Italic.otf', 'LibertinusSerif-BoldItalic.otf',
    'NewCMMath-Book.otf',
    'DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf', 'DejaVuSansMono-Oblique.ttf', 'DejaVuSansMono-BoldOblique.ttf',
  ],
};

async function fetchPinned({ url, sha256: expected }) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`vendor: ${url} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`vendor: checksum mismatch for ${url}`);
  return bytes;
}

/** Reads a plain ustar archive, which is all GitHub's tarballs are. */
function untar(bytes) {
  const files = new Map();
  for (let at = 0; at + 512 <= bytes.length && bytes[at];) {
    const name = bytes.subarray(at, at + 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(bytes.subarray(at + 124, at + 136).toString().trim(), 8);
    if (bytes[at + 156] === 0x30 || !bytes[at + 156]) files.set(name, bytes.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * pdf.js asks for CMaps and standard fonts one file at a time, depending on the
 * PDF. Packing them means one URL to cache, so a CJK PDF still works offline
 * after any other PDF was opened. Layout: u32 header length, JSON index, bytes.
 */
function packPdfjsData(root) {
  const entries = ['cmaps', 'standard_fonts'].flatMap((dir) => readdirSync(join(root, dir))
    .filter((name) => !name.startsWith('LICENSE'))
    .map((name) => [`${dir}/${name}`, readFileSync(join(root, dir, name))]));
  const index = {};
  let offset = 0;
  for (const [name, bytes] of entries) {
    index[name] = [offset, bytes.length];
    offset += bytes.length;
  }
  const header = Buffer.from(JSON.stringify(index));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return Buffer.concat([length, header, ...entries.map(([, bytes]) => bytes)]);
}

/**
 * The extensions `import ... from "mediabunny"`, a bare name a file fetched from
 * /engines/ can't resolve. The media worker puts its own copy on `globalThis`,
 * and this binds to that, so an extension can never pair with a second copy.
 */
function patchBareImports(buf) {
  let count = 0;
  const source = buf.toString('utf8').replace(/import\{([^}]*)\}from"mediabunny";/g, (_, names) => {
    count++;
    return `const{${names.replaceAll(' as ', ':')}}=globalThis.Mediabunny;`;
  });
  if (!count || /from"mediabunny"/.test(source)) throw new Error('extension bundle changed: re-check the import patch');
  return Buffer.from(source);
}

/**
 * embind builds its call wrappers with `new Function`, which `script-src 'self'`
 * forbids. The generated source is one fixed template, so this interprets the
 * same template as a closure. Same calls, same order, no runtime code.
 */
const NEW_FUNCTION = 'b=(new Function(v,n+"}\\n"))(...d);';
const INVOKER = `b=((names,values,source)=>{
const scope=Object.fromEntries(names.map((name,i)=>[name,values[i]]));
const destructible=source.includes("var destructors = []");
const stack=source.includes("var sp = stackSave()");
const method=source.includes("var thisWired =");
const returns=source.includes("var ret = fromRetWire");
const count=names.filter((name)=>/^toArg\\d+Wire$/.test(name)).length;
const dtors=names.filter((name)=>name.endsWith("_dtor")).map((name)=>name.slice(0,-5));
return function(...args){
const destructors=destructible?[]:null;
const sp=stack?scope.stackSave():0;
const wired={};
let rv;
try{
if(method)wired.thisWired=scope.toClassParamWire(destructors,this);
const call=[scope.fn];
if(method)call.push(wired.thisWired);
for(let i=0;i<count;i++){wired["arg"+i+"Wired"]=scope["toArg"+i+"Wire"](destructors,args[i]);call.push(wired["arg"+i+"Wired"]);}
rv=scope.invoker(...call);
}finally{if(stack)scope.stackRestore(sp);}
if(destructible)scope.runDestructors(destructors);
else for(const name of dtors)scope[name+"_dtor"](wired[name]);
return returns?scope.fromRetWire(rv):undefined;
};
})(v,d,n+"}\\n");`;

const EMVAL_NEW_FUNCTION = 'c=(new Function(Object.keys(h),l))(...Object.values(h));';
const EMVAL_CALLER = `c=((kind,readers,env,isVoid)=>function(handle,methodName,destructorsRef,args){
const callee=kind===3?null:env.toValue(handle);
const values=readers.map((read,p)=>read(args+p*8));
let result;
if(kind===0)result=callee(...values);
else if(kind===1)result=callee[env.getStringOrSymbol(methodName)](...values);
else if(kind===2)result=new callee(...values);
else result=values[values.length-1];
if(!isVoid)return env.emval_returnValue(env.toReturnWire,destructorsRef,result);
})(c,g,h,b.kb);`;

function patchVipsGlue(buf) {
  let source = buf.toString('utf8');
  for (const [from, to] of [[NEW_FUNCTION, INVOKER], [EMVAL_NEW_FUNCTION, EMVAL_CALLER]]) {
    if (source.split(from).length !== 2) throw new Error('vips glue changed: re-check the embind patch');
    source = source.replace(from, () => to);
  }
  if (source.includes('new Function')) throw new Error('vips glue: unexpected new Function');
  return Buffer.from(source);
}

/** Writes one vendored file and its checksum and sizes. */
function record(entry, lines, pkg, name, buf) {
  const path = join('vendor', pkg, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  const digest = sha256(buf);
  lines.push(`${digest}  ${pkg}/${name}`);
  const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
  entry.files[name] = { sha256: digest, bytes: buf.length, brotli: br.length };
}

/**
 * typst.ts makes its default file-access callbacks with `new Function`, which
 * the CSP forbids. There are five fixed sources, so a lookup does the same job,
 * and anything else fails loudly here at runtime instead of evaluating.
 */
const TYPST_SOURCES = `const typstFunction=(...parts)=>{
const known={
"return 0":()=>0,
"return true":()=>true,
"path\\u0000return path":(path)=>path,
"throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()')":()=>{throw new Error("File not found in the document's media.");},
"throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()')":()=>{throw new Error("Typst packages aren't available.");},
};
const body=known[parts.join("\\u0000")];
if(!body)throw new Error("typst glue: unexpected function source");
return body;
};
`;

function patchTypstGlue(buf) {
  const source = buf.toString('utf8');
  if (source.split('new Function(').length !== 3) throw new Error('typst glue changed: re-check the Function patch');
  return Buffer.from(TYPST_SOURCES + source.replaceAll('new Function(', 'typstFunction('));
}

const verify = process.argv.includes('--verify');

if (verify) {
  const sums = readFileSync('vendor/SHA256SUMS', 'utf8').trim().split('\n');
  for (const line of sums) {
    const [expected, path] = line.split(/\s+/);
    const full = join('vendor', path);
    if (!existsSync(full)) throw new Error(`vendor: missing ${path}`);
    const actual = sha256(readFileSync(full));
    if (actual !== expected) throw new Error(`vendor: checksum mismatch for ${path}`);
  }
  const recorded = JSON.parse(readFileSync('vendor/manifest.json', 'utf8'));
  for (const [pkg, { from }] of Object.entries(PACKAGES)) {
    const { version } = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'));
    if (version !== recorded[pkg].version) {
      throw new Error(`vendor: ${from} is ${version} but vendor/${pkg} holds ${recorded[pkg].version}. Run npm run vendor.`);
    }
  }
  console.log(`vendor: ${sums.length} files verified`);
} else {
  const lines = [];
  const manifest = {};
  for (const [pkg, { from, files, licenses = {} }] of Object.entries(PACKAGES)) {
    const version = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version;
    const entry = { version, files: {} };
    for (const [name, src] of Object.entries(files)) {
      const original = readFileSync(join(from, src));
      const buf = name === 'vips-es6.js' ? patchVipsGlue(original)
        : name === 'typst.mjs' ? patchTypstGlue(original)
        : name.endsWith('-encoder.mjs') ? patchBareImports(original)
        : original;
      record(entry, lines, pkg, name, buf);
      if (buf !== original) entry.files[name].upstreamSha256 = sha256(original);
    }
    for (const [name, src] of Object.entries(licenses)) copyFileSync(join(from, src), join('vendor', pkg, name));
    if (pkg === 'pdfjs') record(entry, lines, pkg, 'data.pack', packPdfjsData(from));
    manifest[pkg] = entry;
  }

  const release = unzipSync(await fetchPinned(PANDOC));
  const wasm = Object.entries(release).find(([name]) => name.endsWith('pandoc.wasm'))?.[1];
  if (!wasm) throw new Error('vendor: no pandoc.wasm in the release');
  manifest.pandoc = { version: PANDOC.version, source: PANDOC.url, files: {} };
  record(manifest.pandoc, lines, 'pandoc', 'pandoc.wasm', Buffer.from(wasm));

  const assets = untar(Buffer.from(gunzipSync(await fetchPinned(TYPST_FONTS))));
  manifest.fonts = { version: TYPST_FONTS.version, source: TYPST_FONTS.url, files: {} };
  for (const name of TYPST_FONTS.files) {
    const bytes = assets.get(`typst-assets-${TYPST_FONTS.version}/files/fonts/${name}`);
    if (!bytes) throw new Error(`vendor: ${name} missing from typst-assets`);
    record(manifest.fonts, lines, 'fonts', name, bytes);
  }
  writeFileSync('vendor/fonts/NOTICE', assets.get(`typst-assets-${TYPST_FONTS.version}/NOTICE`));
  writeFileSync('vendor/typst/LICENSE', assets.get(`typst-assets-${TYPST_FONTS.version}/LICENSE`));
  writeFileSync('vendor/SHA256SUMS', lines.join('\n') + '\n');
  writeFileSync('vendor/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(lines.join('\n'));
}
