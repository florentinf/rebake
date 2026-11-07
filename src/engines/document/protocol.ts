import type { OutputPart, PageSize } from '../../core/engine';
import type { AssetFile } from '../../core/fetch-asset';
import type { FormatId } from '../../core/formats';

export const UNUSABLE_IMAGE = "One of this document's images is in a format PDF output can't use. Pick DOCX or HTML instead.";

export interface ConvertRequest {
  file: File;
  input: FormatId;
  target: FormatId;
  pageSize: PageSize;
  pandoc: AssetFile;
  typst: { glue: string; wasm: AssetFile; fonts: AssetFile[] };
}

/** Typst can't read TIFF, so these go through the image engine, then `finishPdf`. */
export interface TiffReply {
  tiffs: Record<string, Uint8Array<ArrayBuffer>>;
}

export interface FinishPdfRequest {
  pngs: Record<string, Uint8Array<ArrayBuffer>>;
}

export interface ConvertReply {
  output: Blob;
  path: string;
  /** Media that can't live inside the file, next to it in a ZIP. */
  media?: OutputPart[];
  /** How many resources pandoc couldn't carry across. */
  lost: number;
}
