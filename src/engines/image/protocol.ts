import type { ConvertOptions } from '../../core/engine';
import type { AssetFile } from '../../core/fetch-asset';
import type { FormatId } from '../../core/formats';

export type VipsModule = 'vips-heif.wasm' | 'vips-jxl.wasm' | 'vips-resvg.wasm';

export interface InitRequest {
  vipsUrl: string;
  /** Everything to fetch, wasm included, for measured download progress. */
  files: AssetFile[];
  /** file name → URL, handed to Emscripten's locateFile. */
  locate: Record<string, string>;
  modules: VipsModule[];
}

export interface ConvertRequest {
  buffer: ArrayBuffer;
  input: FormatId;
  target: FormatId;
  options: ConvertOptions;
  libheif: AssetFile;
}

export interface ConvertReply {
  output: ArrayBuffer;
  path: string;
  note?: string;
  /** Bytes libvips still holds after this job. */
  held: number;
}
