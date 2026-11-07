const SIZE = 88;
const LARGEST_IMAGE_BYTES = 64e6;
const FRAME_TIMEOUT_MS = 3000;

function toCanvas(source: CanvasImageSource, width: number, height: number, outWidth = SIZE, outHeight = SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const scale = Math.max(outWidth / width, outHeight / height);
  const drawnWidth = width * scale;
  const drawnHeight = height * scale;
  canvas.getContext('2d')?.drawImage(source, (outWidth - drawnWidth) / 2, (outHeight - drawnHeight) / 2, drawnWidth, drawnHeight);
  return canvas;
}

async function imageThumb(file: File) {
  if (file.size > LARGEST_IMAGE_BYTES) return null;
  const bitmap = await createImageBitmap(file);
  const canvas = toCanvas(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return canvas;
}

function seekTo(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('seek')), FRAME_TIMEOUT_MS);
    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    video.currentTime = time;
  });
}

function loadVideo(file: File) {
  return new Promise<{ video: HTMLVideoElement; close: () => void }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const close = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    const timeout = setTimeout(() => {
      close();
      reject(new Error('metadata'));
    }, FRAME_TIMEOUT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('loadeddata', () => {
      clearTimeout(timeout);
      resolve({ video, close });
    }, { once: true });
    video.addEventListener('error', () => {
      clearTimeout(timeout);
      close();
      reject(new Error('decode'));
    }, { once: true });
    video.src = url;
  });
}

async function videoThumb(file: File) {
  const { video, close } = await loadVideo(file);
  try {
    await seekTo(video, Math.min(0.1, (video.duration || 1) / 2));
    return toCanvas(video, video.videoWidth, video.videoHeight);
  } finally {
    close();
  }
}

/** Frames across a video for the trim timeline. Null when this browser can't show them. */
export async function filmstrip(file: File, count: number, frameWidth: number, frameHeight: number) {
  try {
    const { video, close } = await loadVideo(file);
    try {
      const frames: HTMLCanvasElement[] = [];
      for (let i = 0; i < count; i++) {
        await seekTo(video, ((i + 0.5) / count) * video.duration);
        frames.push(toCanvas(video, video.videoWidth, video.videoHeight, frameWidth, frameHeight));
      }
      return frames;
    } finally {
      close();
    }
  } catch {
    return null;
  }
}

/**
 * A small picture of a file, made one at a time so a big batch can't flood the
 * main thread. Anything the browser can't draw itself, such as HEIC outside
 * Safari, keeps its text tile.
 */
let queue: Promise<unknown> = Promise.resolve();
export function thumbnail(file: File, kind: 'image' | 'video') {
  const job = queue.then(() => (kind === 'image' ? imageThumb(file) : videoThumb(file))).catch(() => null);
  queue = job;
  return job;
}
