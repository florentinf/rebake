import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MediaInfo {
  container: string;
  video?: string;
  audio?: string;
  width?: number;
  height?: number;
  rotation?: number;
  channels?: number;
  sampleRate?: number;
  bitrate?: number;
  bits?: number;
  duration: number;
  frames?: number;
}

interface Stream {
  codec_type: string; codec_name: string; width?: number; height?: number; channels?: number;
  sample_rate?: string; bits_per_raw_sample?: string; bits_per_sample?: number; nb_read_frames?: string;
  side_data_list?: { rotation?: number }[];
}

function ffprobe(path: string, extra: string[] = []) {
  const json = execFileSync('ffprobe', ['-v', 'error', ...extra, '-show_format', '-show_streams', '-of', 'json', path], { maxBuffer: 1e8 });
  return JSON.parse(json.toString()) as { format: { format_name: string; duration?: string; bit_rate?: string }; streams: Stream[] };
}

/** ffprobe on a path, then a full ffmpeg decode, so a file that only looks right still fails. */
export function inspectPath(path: string, { decode = true } = {}): MediaInfo {
  const { format, streams } = ffprobe(path);
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (decode) {
    const errors = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1e8 });
    if (errors.length) throw new Error(`decode errors: ${errors}`);
  }
  const info: MediaInfo = { container: format.format_name, duration: Number(format.duration ?? 0) };
  if (video) {
    info.video = video.codec_name;
    info.width = video.width!;
    info.height = video.height!;
    const rotation = video.side_data_list?.find((data) => data.rotation !== undefined)?.rotation;
    if (rotation) info.rotation = rotation;
  }
  if (audio) {
    info.audio = audio.codec_name;
    info.channels = audio.channels!;
    info.sampleRate = Number(audio.sample_rate);
    info.bits = Number(audio.bits_per_raw_sample) || audio.bits_per_sample || 0;
  }
  if (format.bit_rate) info.bitrate = Number(format.bit_rate);
  return info;
}

export function withFile<T>(bytes: Uint8Array, name: string, use: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'rebake-'));
  const path = join(dir, name.replace(/[^\w.-]/g, '_'));
  try {
    writeFileSync(path, bytes);
    return use(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const inspectBytes = (bytes: Uint8Array, name: string) => withFile(bytes, name, (path) => inspectPath(path));

/** Hash of every compressed packet in one stream: equal hashes mean no re-encode happened. */
export function packetHash(path: string, stream: 'v:0' | 'a:0'): string {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', `0:${stream}`, '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'], { maxBuffer: 1e8 });
  return createHash('sha256').update(out).digest('hex');
}

/** One decoded frame's mean luma and chroma spread, on a 0–255 scale. */
export function frameStats(path: string, seconds: number) {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', path, '-frames:v', '1', '-vf', 'scale=64:36:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1e7 });
  let luma = 0;
  let chroma = 0;
  const pixels = out.length / 3;
  for (let i = 0; i < out.length; i += 3) {
    const [r, g, b] = [out[i]!, out[i + 1]!, out[i + 2]!];
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    chroma += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return { luma: luma / pixels, chroma: chroma / pixels };
}
