import type { FormatId } from './formats';

export interface SourceFile {
  file: File;
  format: FormatId;
}

/** Options common to every engine. Engines ignore what doesn't apply to them. */
export interface ConvertOptions {
  /** 1–100. */
  quality: number;
  maxWidth?: number;
  maxHeight?: number;
  stripMetadata: boolean;
  /** Short edge cap for video, in pixels. Never upscales. */
  maxResolution?: number;
  /** `balanced` keeps the original streams wherever the target container allows it. */
  preset?: VideoPreset;
  /** Seconds into the source. */
  trimStart?: number;
  trimEnd?: number;
  removeAudio?: boolean;
  /** Bits per second. Unset keeps the original audio where the target allows it. */
  audioBitrate?: number;
  /** Unset keeps the source's channel count. */
  channels?: 1 | 2;
  /** Streams the output straight into this file, for files too big to hold. */
  destination?: FileSystemFileHandle;
  /** Paper for PDF output. */
  pageSize?: PageSize;
  /** Which PDF pages to render, like `1-3, 5`. Unset means all of them. */
  pages?: string;
  /** Which spreadsheet sheet to read. Unset means the first. */
  sheet?: string;
}

export type PageSize = 'a4' | 'letter';

export type VideoPreset = 'small' | 'balanced' | 'high';

export const DEFAULT_OPTIONS: ConvertOptions = { quality: 82, stripMetadata: true };

/** `converting` is one measured pass. `finishing` has no signal: the file is being closed. */
export type Stage = 'loading' | 'decoding' | 'encoding' | 'converting' | 'finishing';

/** `fraction` is null when the stage has no measurable signal. Never invent one. */
export interface Progress {
  stage: Stage;
  fraction: number | null;
}

export type OnProgress = (progress: Progress) => void;

/** One file of a result that can't fit in a single one. */
export interface OutputPart {
  /** Relative path inside the ZIP. */
  name: string;
  blob: Blob;
  /** A supporting file, such as a document's image, not itself in the target format. */
  asset?: boolean;
}

export interface ConvertResult {
  /** Disk-backed when the engine spooled it, so holding this costs no memory. */
  blob: Blob;
  /** Which code path did the work, e.g. `heic:native`. Visible to tests. */
  path: string;
  /** Set when the result is several files: they replace `blob` and go out as one ZIP. */
  parts?: OutputPart[];
  /** Something that went missing on the way, in plain language. Shown with the result. */
  note?: string;
}

export interface EngineProbe {
  available: boolean;
  /** Plain-language reason when `available` is false. */
  reason?: string;
}

/** What one specific file can do here. Only engines whose answer depends on the file have this. */
export interface Inspection {
  /** Narrows the format-level targets: these are what this file can really become. */
  targets: FormatId[];
  /** Plain-language reason, only when the file lost targets it would have elsewhere. */
  note?: string;
  /** Target → the longest source it accepts, in seconds. Trimming can bring a file under it. */
  limits?: Partial<Record<FormatId, number>>;
  /** Seconds, when the file has a timeline. */
  duration?: number;
  hasAudio?: boolean;
  /** Spreadsheet sheet names, in order. */
  sheets?: string[];
}

export interface Engine {
  readonly id: string;
  /** Cheap feature checks, no download. Run once per engine, cached by the capability layer. */
  probe(): Promise<EngineProbe>;
  /** Targets this engine can produce from `input` in this browser. */
  targets(input: FormatId): FormatId[];
  /** Reads the file's own tracks and checks them against this browser. */
  inspect?(source: SourceFile): Promise<Inspection>;
  /** Bytes still to fetch for this conversion, as transferred. */
  downloadSize(input: FormatId, target: FormatId): Promise<number>;
  convert(
    source: SourceFile,
    target: FormatId,
    options: ConvertOptions,
    onProgress: OnProgress,
    signal: AbortSignal,
  ): Promise<ConvertResult>;
  /** Several inputs, one output. Engines that have this take a batch whole, as images to one PDF. */
  merge?(
    sources: SourceFile[],
    target: FormatId,
    options: ConvertOptions,
    onProgress: OnProgress,
    signal: AbortSignal,
  ): Promise<ConvertResult>;
}
