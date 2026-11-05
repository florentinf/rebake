import type { PageSize } from '../../core/engine';
import type { AssetFile } from '../../core/fetch-asset';

export interface RenderRequest {
  file: File;
  type: 'image/png' | 'image/jpeg';
  /** 0–1. */
  quality: number;
  /** One-based. Unset means every page. */
  pages?: number[];
  pdfjs: { library: string; worker: string; wasm: Record<string, string>; data: AssetFile; files: AssetFile[] };
}

export interface RenderedPage {
  page: number;
  blob: Blob;
}

export interface RenderReply {
  pages: RenderedPage[];
  /** Pages in the document, not pages rendered. */
  total: number;
}

export interface StartRequest {
  library: AssetFile;
  pageSize: PageSize;
}

export interface AddRequest {
  bytes: ArrayBuffer;
  kind: 'jpg' | 'png';
}

export interface FinishReply {
  output: ArrayBuffer;
}
