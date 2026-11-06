/**
 * `isConfigSupported` only says a config is accepted. WebKit's GStreamer encoders
 * accept these and then stamp packets from the input buffer instead of the stream,
 * so several share a timestamp and the file can't be muxed. Only encoding shows it.
 */
const CONFIGS = {
  opus: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
  aac: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
};

// Decoders hand over any size. 4096 is a multiple of neither codec's frame, which is what exposes it.
const INPUT_FRAMES = 4096;
const INPUTS = 4;
const TIMEOUT_MS = 3000;

async function encodesInOrder(config: AudioEncoderConfig): Promise<boolean> {
  if (typeof AudioEncoder !== 'function') return false;
  const supported = await AudioEncoder.isConfigSupported(config).then((result) => !!result.supported, () => false);
  if (!supported) return false;

  const stamps: number[] = [];
  let failed = false;
  const encoder = new AudioEncoder({
    output: (chunk) => stamps.push(chunk.timestamp),
    error: () => { failed = true; },
  });
  try {
    encoder.configure(config);
    const channels = config.numberOfChannels;
    for (let i = 0; i < INPUTS; i++) {
      const data = new Float32Array(INPUT_FRAMES * channels);
      for (let j = 0; j < data.length; j++) data[j] = Math.sin((i * data.length + j) / 20) / 8;
      const audio = new AudioData({
        format: 'f32',
        sampleRate: config.sampleRate,
        numberOfChannels: channels,
        numberOfFrames: INPUT_FRAMES,
        timestamp: Math.round((i * INPUT_FRAMES / config.sampleRate) * 1e6),
        data,
      });
      encoder.encode(audio);
      audio.close();
    }
    const timeout = new Promise<'timeout'>((resolve) => { setTimeout(() => resolve('timeout'), TIMEOUT_MS); });
    if (await Promise.race([encoder.flush(), timeout]) === 'timeout') return false;
  } catch {
    return false;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  return !failed && stamps.length > 1 && stamps.every((stamp, i) => i === 0 || stamp > stamps[i - 1]!);
}

const results = new Map<keyof typeof CONFIGS, Promise<boolean>>();

/** True when this browser's own encoder writes a usable stream. Runs once per thread. */
export function encodesNatively(codec: keyof typeof CONFIGS): Promise<boolean> {
  let result = results.get(codec);
  if (!result) {
    result = encodesInOrder(CONFIGS[codec]);
    results.set(codec, result);
  }
  return result;
}
