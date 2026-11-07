import type { ConvertOptions, Inspection } from '../../core/engine';
import type { FormatId } from '../../core/formats';

export type EncoderPackage = 'mp3' | 'aac' | 'flac';

export interface InspectRequest {
  file: File;
  input: FormatId;
  /** Every target to check this file against. */
  targets: FormatId[];
}

export type InspectReply = Inspection;

export interface ConvertRequest {
  file: File;
  input: FormatId;
  target: FormatId;
  options: ConvertOptions;
  /** Encoder extension URLs, fetched only if the job turns out to need them. */
  encoders: Record<EncoderPackage, string>;
  /** Picks this tab's temp folder. */
  tab: string;
}

export interface ConvertReply {
  /** A disk-backed file, or bytes when nothing on disk was available. */
  output: File | ArrayBuffer;
  path: string;
}

/** Longest clip a GIF is made from. Past this GIFs get huge and nobody wants them. */
export const GIF_MAX_SECONDS = 15;
