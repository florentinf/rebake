import type { ConvertOptions } from '../../core/engine';
import type { AssetFile } from '../../core/fetch-asset';
import type { FormatId } from '../../core/formats';

export interface ConvertRequest {
  file: File;
  input: FormatId;
  target: FormatId;
  options: ConvertOptions;
  xlsx: AssetFile;
}

export interface InspectRequest {
  file: File;
  xlsx: AssetFile;
}

export interface ConvertReply {
  text: string;
}
