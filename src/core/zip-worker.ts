import { downloadZip } from 'client-zip';
import { RebakeError } from './errors';
import { openSpool } from './spool';
import { serve, Transfer, type HandlerContext } from './worker-runtime';

export interface ZipRequest {
  files: { name: string; blob: Blob }[];
  tab: string;
  name: string;
}

async function zip({ files, tab, name }: ZipRequest, context: HandlerContext) {
  const total = files.reduce((sum, file) => sum + file.blob.size, 0);
  const stream = downloadZip(files.map((file) => ({ name: file.name, input: file.blob }))).body;
  if (!stream) throw new RebakeError('crashed', 'The ZIP could not be started.');
  const reader = stream.getReader();
  const output = await openSpool(tab, name);
  const writer = output?.writable.getWriter();
  const held: Uint8Array<ArrayBuffer>[] = [];
  let position = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const data = value as Uint8Array<ArrayBuffer>;
    if (writer) await writer.write({ type: 'write', data, position });
    else held.push(data);
    position += data.length;
    context.progress({ stage: 'finishing', fraction: Math.min(position / total, 1) });
  }

  if (writer && output) {
    await writer.close();
    return { blob: await output.finish() };
  }
  // No disk to spool to. A Blob is the best this browser offers.
  const blob = new Blob(held, { type: 'application/zip' });
  return new Transfer({ blob }, []);
}

serve({ zip });
