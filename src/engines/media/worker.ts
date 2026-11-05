import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import {
  ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, canEncodeAudio, Conversion, CustomAudioEncoder,
  EncodedPacket, FlacOutputFormat, getFirstEncodableVideoCodec, Input, Logging, MkvOutputFormat, MovOutputFormat,
  Mp3OutputFormat, Mp4OutputFormat, OggOutputFormat, Output, Quality, registerEncoder, StreamTarget, WavOutputFormat,
  WebMOutputFormat, type AudioCodec, type ConversionAudioOptions, type ConversionVideoOptions, type InputAudioTrack,
  type InputVideoTrack, type OutputFormat, type Target, type VideoCodec, type VideoSample,
} from 'mediabunny';
import type { ConvertOptions, VideoPreset } from '../../core/engine';
import { RebakeError } from '../../core/errors';
import { FORMATS, type FormatId } from '../../core/formats';
import { openOutput } from '../../core/spool';
import { serve, Transfer, type HandlerContext } from '../../core/worker-runtime';
import { GIF_MAX_SECONDS, type ConvertReply, type ConvertRequest, type EncoderPackage, type InspectReply, type InspectRequest } from './protocol';

// The vendored encoder extensions bind to these. See `patchBareImports` in scripts/vendor.mjs.
(globalThis as unknown as { Mediabunny: unknown }).Mediabunny = { CustomAudioEncoder, EncodedPacket, Logging, registerEncoder };

const LARGE_OUTPUT_BYTES = 100e6;
const WAV_MAX_BYTES = 4e9;
const GIF_FPS = 12;
const GIF_SHORT_EDGE = 270;
const GIF_MAX_SHORT_EDGE = 720;

/** `keep` is what plays everywhere in this container and so isn't worth re-encoding. */
interface VideoPlan {
  kind: 'video';
  format(large: boolean): OutputFormat;
  keep: VideoCodec[];
  /** Copied only when the browser can't re-encode: valid here, but not everything plays it. */
  legal: VideoCodec[];
  encode: VideoCodec[];
  audioKeep: AudioCodec[] | 'any';
  audioEncode: AudioCodec;
}

interface AudioPlan {
  kind: 'audio';
  /** `pcmBytes` is the size of this audio as uncompressed samples. */
  format(large: boolean, pcmBytes: number): OutputFormat;
  keep: AudioCodec[];
  encode: AudioCodec;
}

const WAV_CODECS: AudioCodec[] = ['pcm-s16', 'pcm-s24', 'pcm-s32', 'pcm-f32', 'pcm-u8'];

const isobmffStart = (large: boolean) => ({ fastStart: large ? false as const : 'in-memory' as const });

const PLANS: Partial<Record<FormatId, VideoPlan | AudioPlan>> = {
  mp4: {
    kind: 'video',
    format: (large) => new Mp4OutputFormat(isobmffStart(large)),
    keep: ['avc', 'hevc', 'av1'],
    legal: ['avc', 'hevc', 'av1', 'vp9'],
    encode: ['avc', 'hevc', 'av1', 'vp9'],
    audioKeep: ['aac', 'mp3'],
    audioEncode: 'aac',
  },
  mov: {
    kind: 'video',
    format: (large) => new MovOutputFormat(isobmffStart(large)),
    keep: ['avc', 'hevc'],
    legal: ['avc', 'hevc'],
    encode: ['avc', 'hevc'],
    audioKeep: ['aac', 'mp3'],
    audioEncode: 'aac',
  },
  webm: {
    kind: 'video',
    format: () => new WebMOutputFormat(),
    keep: ['vp9', 'av1', 'vp8'],
    legal: ['vp9', 'av1', 'vp8'],
    encode: ['vp9', 'av1', 'vp8'],
    audioKeep: ['opus', 'vorbis'],
    audioEncode: 'opus',
  },
  mkv: {
    kind: 'video',
    format: () => new MkvOutputFormat(),
    keep: ['avc', 'hevc', 'vp9', 'av1', 'vp8'],
    legal: ['avc', 'hevc', 'vp9', 'av1', 'vp8'],
    encode: ['avc', 'vp9', 'av1', 'hevc'],
    audioKeep: 'any',
    audioEncode: 'aac',
  },
  mp3: { kind: 'audio', format: () => new Mp3OutputFormat(), keep: ['mp3'], encode: 'mp3' },
  m4a: { kind: 'audio', format: (large) => new Mp4OutputFormat(isobmffStart(large)), keep: ['aac'], encode: 'aac' },
  opus: { kind: 'audio', format: () => new OggOutputFormat(), keep: ['opus'], encode: 'opus' },
  ogg: { kind: 'audio', format: () => new OggOutputFormat(), keep: ['opus', 'vorbis'], encode: 'opus' },
  flac: { kind: 'audio', format: () => new FlacOutputFormat(), keep: ['flac'], encode: 'flac' },
  wav: {
    kind: 'audio',
    format: (_, pcmBytes) => new WavOutputFormat({ large: pcmBytes > WAV_MAX_BYTES }),
    keep: WAV_CODECS,
    encode: 'pcm-s16',
  },
};

const PRESETS: Record<VideoPreset, Quality> = {
  small: new Quality('low'),
  balanced: new Quality('medium'),
  high: new Quality('high'),
};

const CODEC_NAMES: Partial<Record<string, string>> = {
  avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1', prores: 'ProRes',
  aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3', eac3: 'E-AC-3', dts: 'DTS', truehd: 'TrueHD',
};
const BETTER_BROWSERS: Partial<Record<string, string>> = { hevc: 'Use Safari or Chrome.' };

const nameOf = (codec: string | null) => (codec && CODEC_NAMES[codec]) ?? 'this';
const openInput = (file: File) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

/** WASM encoders that are always available once fetched, whatever WebCodecs offers. */
const canEncodeAudioHere = async (codec: AudioCodec) =>
  codec === 'mp3' || codec === 'aac' || codec === 'flac' || codec.startsWith('pcm-') || canEncodeAudio(codec);

async function readTracks(file: File) {
  const input = openInput(file);
  let video: InputVideoTrack | null;
  let audios: InputAudioTrack[];
  try {
    video = await input.getPrimaryVideoTrack();
    audios = await input.getAudioTracks();
  } catch {
    throw new RebakeError('corrupt', 'unreadable container');
  }
  // iPhones add a spatial audio track no browser reads. Prefer the one that can be used.
  let audio = audios[0] ?? null;
  for (const track of audios) {
    if (await track.canDecode()) { audio = track; break; }
  }
  return { input, video, audio };
}

async function encodableVideo(plan: VideoPlan, track: InputVideoTrack): Promise<VideoCodec | null> {
  const width = await track.getDisplayWidth();
  const height = await track.getDisplayHeight();
  return getFirstEncodableVideoCodec(plan.encode, { width, height, bitrate: 2e6 });
}

async function inspect({ file, targets }: InspectRequest): Promise<InspectReply> {
  const { input, video, audio } = await readTracks(file);
  if (!video && !audio) throw new RebakeError('corrupt', 'no tracks');
  const videoCodec = video?.codec ?? null;
  const audioCodec = audio?.codec ?? null;
  const readsVideo = video ? await video.canDecode() : false;
  const readsAudio = audio ? await audio.canDecode() : false;

  const offered: FormatId[] = [];
  for (const target of targets) {
    if (target === 'gif') {
      if (readsVideo) offered.push(target);
      continue;
    }
    const plan = PLANS[target];
    if (!plan) continue;
    if (plan.kind === 'audio') {
      if (!audio) continue;
      const copies = !!audioCodec && plan.keep.includes(audioCodec);
      if (copies || (readsAudio && await canEncodeAudioHere(plan.encode))) offered.push(target);
      continue;
    }
    if (!video) continue;
    const copies = !!videoCodec && plan.legal.includes(videoCodec);
    const encodes = readsVideo && !!await encodableVideo(plan, video);
    if (copies || encodes) offered.push(target);
  }

  const duration = await input.computeDuration().catch(() => undefined);
  let note: string | undefined;
  if (video && !readsVideo) {
    const hint = BETTER_BROWSERS[videoCodec ?? ''];
    const kept = offered.filter((target) => PLANS[target]?.kind === 'video').map((target) => FORMATS[target].label);
    const reach = kept.length ? ` It can only be copied to ${kept.join(' or ')}.` : '';
    note = `This browser can't read ${nameOf(videoCodec)} video.${reach}${hint ? ` ${hint}` : ''}`;
  } else if (audio && !readsAudio) {
    const hint = BETTER_BROWSERS[audioCodec ?? ''];
    note = `This browser can't read ${nameOf(audioCodec)} audio.${hint ? ` ${hint}` : ''}`;
  } else if (!offered.length) {
    note = "This browser can't convert this file.";
  }

  const reply: InspectReply = { targets: offered, duration, hasAudio: !!audio, limits: { gif: GIF_MAX_SECONDS } };
  if (note) reply.note = note;
  return reply;
}

const loadedEncoders = new Set<EncoderPackage>();

async function loadEncoder(pkg: EncoderPackage, url: string, context: HandlerContext) {
  if (loadedEncoders.has(pkg)) return;
  context.progress({ stage: 'loading', fraction: null });
  let module: Record<string, () => void>;
  try {
    module = await import(/* @vite-ignore */ url) as Record<string, () => void>;
  } catch {
    throw new RebakeError('offline', 'encoder not cached');
  }
  const register = { mp3: 'registerMp3Encoder', aac: 'registerAacEncoder', flac: 'registerFlacEncoder' }[pkg];
  module[register]!();
  loadedEncoders.add(pkg);
}

async function ensureEncoder(codec: AudioCodec, encoders: ConvertRequest['encoders'], context: HandlerContext) {
  if (codec === 'mp3' || codec === 'flac') await loadEncoder(codec, encoders[codec], context);
  else if (codec === 'aac' && !(await canEncodeAudio('aac'))) await loadEncoder('aac', encoders.aac, context);
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Fits a size under a short-edge cap. Never scales up. */
function capped(width: number, height: number, shortEdge: number | undefined) {
  const scale = shortEdge ? Math.min(1, shortEdge / Math.min(width, height)) : 1;
  return { width: even(width * scale), height: even(height * scale), resized: scale < 1 };
}

/** An 8-bit encoder fed HLG or PQ gives grey, flat pictures. The canvas tone-maps to sRGB. */
function toneMapper(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' })!;
  return (sample: VideoSample) => {
    sample.draw(context, 0, 0, width, height);
    return canvas;
  };
}

/** FLAC and PCM can be deeper than 16 bits, and WAV shouldn't lose that. */
async function deepAudio(track: InputAudioTrack): Promise<boolean> {
  if (track.codec === 'pcm-s24' || track.codec === 'pcm-s32' || track.codec === 'pcm-f32') return true;
  if (track.codec !== 'flac') return false;
  const description = (await track.getDecoderConfig())?.description as ArrayBuffer | ArrayBufferView<ArrayBuffer> | undefined;
  if (!description) return false;
  const bytes = description instanceof ArrayBuffer
    ? new Uint8Array(description)
    : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
  const start = String.fromCharCode(...bytes.subarray(0, 4)) === 'fLaC' ? 8 : 0;
  const bits = (((bytes[start + 12]! & 1) << 4) | (bytes[start + 13]! >> 4)) + 1;
  return bits > 16;
}

const trimOf = ({ trimStart, trimEnd }: ConvertOptions) =>
  trimStart !== undefined || trimEnd !== undefined ? { start: trimStart, end: trimEnd } : undefined;

interface VideoJob {
  options: ConversionVideoOptions;
  path: string;
}

async function planVideo(track: InputVideoTrack, plan: VideoPlan, options: ConvertOptions): Promise<VideoJob> {
  const source = track.codec;
  const reads = await track.canDecode();
  const displayWidth = await track.getDisplayWidth();
  const displayHeight = await track.getDisplayHeight();
  const { width, height, resized } = capped(displayWidth, displayHeight, options.maxResolution);
  const wantsEncode = resized || options.preset === 'small' || !!options.trimStart;
  const fits = !!source && plan.keep.includes(source);

  if (fits && !wantsEncode) return { options: {}, path: `copy:${source}` };

  const legalCopy = !!source && plan.legal.includes(source);
  if (!reads) {
    if (legalCopy && !resized && options.preset !== 'small') return { options: {}, path: `copy:${source}` };
    throw new RebakeError('unsupported', `This browser can't read ${nameOf(source)} video, so it can't change it. It can only copy it as it is.`);
  }

  const codec = await encodableVideo(plan, track);
  if (!codec) {
    if (legalCopy && !wantsEncode) return { options: {}, path: `copy:${source}` };
    throw new RebakeError('unsupported', "This browser can't encode video for this format.");
  }

  const encode: ConversionVideoOptions = {
    codec,
    forceTranscode: true,
    quality: PRESETS[options.preset ?? 'balanced'],
  };
  if (resized) {
    encode.width = width;
    encode.height = height;
    encode.fit = 'fill';
  }
  if (await track.hasHighDynamicRange()) {
    encode.process = toneMapper(width, height);
    encode.processedWidth = width;
    encode.processedHeight = height;
    encode.allowTransformationMetadata = false;
  }
  return { options: encode, path: `encode:${codec}` };
}

function planAudio(track: InputAudioTrack, keep: AudioCodec[] | 'any', encode: AudioCodec, options: ConvertOptions): ConversionAudioOptions {
  const stays = !options.audioBitrate && !options.channels
    && (keep === 'any' || (!!track.codec && keep.includes(track.codec)));
  if (stays) return {};
  const audio: ConversionAudioOptions = { codec: encode, forceTranscode: true };
  if (options.audioBitrate && !encode.startsWith('pcm-') && encode !== 'flac') audio.bitrate = options.audioBitrate;
  if (options.channels) audio.numberOfChannels = options.channels;
  else if (track.numberOfChannels > 2 && (encode === 'mp3' || encode === 'opus')) audio.numberOfChannels = 2;
  if (encode === 'mp3' && track.sampleRate > 48000) audio.sampleRate = 48000;
  return audio;
}

async function convertGif(request: ConvertRequest, context: HandlerContext) {
  const { options } = request;
  const { input, video } = await readTracks(request.file);
  if (!video) throw new RebakeError('unsupported', 'This file has no video to make a GIF from.');
  if (!(await video.canDecode())) throw new RebakeError('unsupported', `This browser can't read ${nameOf(video.codec)} video.`);

  const start = options.trimStart ?? 0;
  const end = options.trimEnd ?? await input.computeDuration();
  const length = end - start;
  if (length > GIF_MAX_SECONDS) {
    throw new RebakeError('unsupported', `GIF is limited to ${GIF_MAX_SECONDS} s. Trim it under More.`);
  }
  const shortEdge = Math.min(options.maxResolution ?? GIF_SHORT_EDGE, GIF_MAX_SHORT_EDGE);
  const { width, height } = capped(await video.getDisplayWidth(), await video.getDisplayHeight(), shortEdge);
  const sink = new CanvasSink(video, { width, height, fit: 'fill', poolSize: 1 });
  const count = Math.max(1, Math.floor(length * GIF_FPS));
  const times = Array.from({ length: count }, (_, i) => start + i / GIF_FPS);
  const delay = Math.round(1000 / GIF_FPS);

  const gif = GIFEncoder();
  let index = 0;
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    if (frame) {
      const canvas = frame.canvas as OffscreenCanvas;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
      const palette = quantize(pixels, 256, { format: 'rgb444' });
      gif.writeFrame(applyPalette(pixels, palette, 'rgb444'), width, height, { palette, delay });
    }
    index++;
    context.progress({ stage: 'converting', fraction: index / count });
  }
  gif.finish();
  const bytes = gif.bytes().slice();
  return new Transfer<ConvertReply>({ output: bytes.buffer as ArrayBuffer, path: 'gif' }, [bytes.buffer as ArrayBuffer]);
}

async function convert(request: ConvertRequest, context: HandlerContext) {
  const { file, target, options, encoders, tab } = request;
  if (target === 'gif') return convertGif(request, context);
  const plan = PLANS[target];
  if (!plan) throw new RebakeError('unsupported', `Can't write ${FORMATS[target].label}.`);

  const { input, video, audio } = await readTracks(file);
  const large = file.size >= LARGE_OUTPUT_BYTES;
  const seconds = await input.computeDuration().catch(() => 0);
  const pcmBytes = audio ? seconds * audio.sampleRate * audio.numberOfChannels * 3 : 0;

  let videoJob: VideoJob | null = null;
  let audioOptions: ConversionAudioOptions | null = null;
  const dropAudio = plan.kind === 'video' && !!options.removeAudio;

  if (plan.kind === 'video') {
    if (!video) throw new RebakeError('unsupported', 'This file has no video.');
    videoJob = await planVideo(video, plan, options);
  } else if (!audio) {
    throw new RebakeError('unsupported', 'This file has no audio.');
  }
  if (audio && !dropAudio) {
    const keep = plan.kind === 'video' ? plan.audioKeep : plan.keep;
    const encode = plan.kind === 'video' ? plan.audioEncode
      : target === 'wav' && await deepAudio(audio) ? 'pcm-s24'
      : plan.encode;
    audioOptions = planAudio(audio, keep, encode, options);
    // A trim start can turn a copy into an encode at the last moment, so have the encoder ready.
    if (audioOptions.codec || options.trimStart) await ensureEncoder(audioOptions.codec ?? encode, encoders, context);
  }

  const stream = await openOutput(options.destination, tab, `output.${FORMATS[target].extension}`);
  const buffered = stream ? null : new BufferTarget();
  const outputTarget: Target = stream ? new StreamTarget(stream.writable, { chunked: true }) : buffered!;
  const output = new Output({ format: plan.format(large, pcmBytes), target: outputTarget });

  const trim = trimOf(options);
  const conversion = await Conversion.init({
    input,
    output,
    showWarnings: false,
    video: (track) => (videoJob && track.number === video?.number ? videoJob.options : { discard: true }),
    audio: (track) => (audioOptions && track.number === audio?.number ? audioOptions : { discard: true }),
    ...(trim ? { trim } : {}),
    // A remux must never quietly become a re-encode over a small timestamp offset.
    copy: options.trimStart && !videoJob?.path.startsWith('copy') ? {} : { shiftTolerance: Infinity },
  });

  const lost = conversion.discardedTracks.filter(({ reason }) => reason !== 'discarded_by_user');
  for (const { track, reason } of lost) {
    if (track.number === video?.number) throw new RebakeError('unsupported', "This browser can't convert this video.");
    if (track.number === audio?.number) {
      const fix = plan.kind === 'video' ? ' Turn on Remove audio under More.' : '';
      const cause = reason === 'no_encodable_target_codec' ? 'encode' : 'read';
      throw new RebakeError('unsupported', `This browser can't ${cause} the audio.${fix}`);
    }
  }
  if (!conversion.isValid) throw new RebakeError('unsupported', "This browser can't convert this file.");

  conversion.onProgress = (fraction) => context.progress({ stage: 'converting', fraction });
  await conversion.execute();
  context.progress({ stage: 'finishing', fraction: null });

  const path = videoJob?.path ?? (audioOptions?.codec ? `encode:${audioOptions.codec}` : 'copy');
  if (stream) return { output: await stream.finish(), path };
  const bytes = buffered!.buffer!;
  return new Transfer({ output: bytes, path }, [bytes]);
}

serve({ inspect, convert });
