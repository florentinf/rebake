import { fetchAssets } from '../../core/fetch-asset';
import type { HandlerContext } from '../../core/worker-runtime';
import type { ConvertRequest } from './protocol';

type Glue = typeof import('@myriaddreamin/typst-ts-web-compiler');
type Compiler = Awaited<ReturnType<InstanceType<Glue['TypstCompilerBuilder']>['build']>>;

/** Errors come back as text instead of being thrown as a wasm object. */
const TEXT_DIAGNOSTICS = 2;

let compiler: Compiler | undefined;

async function load({ glue, wasm, fonts }: ConvertRequest['typst'], context: HandlerContext) {
  if (compiler) return compiler;
  const [binary, ...faces] = await fetchAssets([wasm, ...fonts], context.progress);
  const typst = (await import(/* @vite-ignore */ glue)) as Glue;
  await typst.default({ module_or_path: binary! });
  const builder = new typst.TypstCompilerBuilder();
  builder.set_dummy_access_model();
  for (const face of faces) await builder.add_raw_font(face);
  compiler = await builder.build();
  return compiler;
}

export interface TypstFailure {
  message: string;
}

/** Compiles one in-memory document. Files are visible to it by their relative paths. */
export async function compilePdf(
  source: string,
  media: Record<string, Uint8Array>,
  assets: ConvertRequest['typst'],
  context: HandlerContext,
): Promise<Uint8Array> {
  const typst = await load(assets, context);
  typst.reset();
  typst.reset_shadow();
  typst.add_source('/main.typ', source);
  for (const [path, bytes] of Object.entries(media)) typst.map_shadow(`/${path}`, bytes);
  const reply = typst.compile('/main.typ', null, 'pdf', TEXT_DIAGNOSTICS) as { result?: Uint8Array; diagnostics?: string[] };
  if (reply.result) return reply.result;
  throw { message: reply.diagnostics?.[0] ?? 'Typst failed.' } satisfies TypstFailure;
}
