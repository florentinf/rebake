import type { OutputPart, PageSize } from '../../core/engine';
import type { AssetFile } from '../../core/fetch-asset';
import type { FormatId } from '../../core/formats';

export interface ConvertRequest {
  file: File;
  input: FormatId;
  target: FormatId;
  pageSize: PageSize;
  pandoc: AssetFile;
  typst: { glue: string; wasm: AssetFile; fonts: AssetFile[] };
}

export interface ConvertReply {
  output: Blob;
  path: string;
  /** Media that can't live inside the file, next to it in a ZIP. */
  media?: OutputPart[];
  /** How many resources pandoc couldn't carry across. */
  lost: number;
}
