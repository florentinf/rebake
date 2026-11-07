declare module 'virtual:engines' {
  interface EngineFile {
    url: string;
    bytes: number;
    /** Roughly what crosses the network. */
    wire: number;
  }
  const engines: Record<
    'vips' | 'libheif' | 'mp3' | 'aac' | 'flac' | 'pandoc' | 'typst' | 'fonts' | 'pdfjs' | 'pdflib' | 'xlsx',
    { files: Record<string, EngineFile> }
  >;
  export default engines;
}

declare module 'gifenc' {
  type Palette = number[][];
  interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options: { palette: Palette; delay: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(): Encoder;
  export function quantize(rgba: Uint8ClampedArray, colors: number, options: { format: 'rgb565' | 'rgb444' | 'rgba4444' }): Palette;
  export function applyPalette(rgba: Uint8ClampedArray, palette: Palette, format: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}
