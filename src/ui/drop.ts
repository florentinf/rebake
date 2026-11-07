import type { State } from './app';
import { clamp, GLIDE, SNAP, Spring } from './motion';

const TITLE_RESTORE_MS = 280;
/** How far the zone's corners open under the pointer, of the way they open for a drop. */
const ZONE_HOVER = 0.3;

interface DropZone {
  zone: HTMLElement;
  negative: HTMLElement;
  title: HTMLElement;
  negativeTitle: HTMLElement;
  line: HTMLElement;
  negativeLine: HTMLElement;
  state: () => State;
  /** The file list takes the drop once a job is open. Null means the drag left. */
  onCatch: (label: string | null) => void;
  onFiles: (files: File[], point?: { x: number; y: number }) => void;
}

/** The whole window takes dropped and pasted files. The zone is where that shows. */
export function createDropZone({ zone, negative, title, negativeTitle, line, negativeLine, state, onCatch, onFiles }: DropZone) {
  const page = document.body;
  // The counter survives crossing child elements.
  let depth = 0;
  let negativeReach = 0;
  let restTitle: string | null = null;

  function setText(text: string, subline = line.textContent ?? '') {
    title.textContent = text;
    negativeTitle.textContent = text;
    line.textContent = subline;
    negativeLine.textContent = subline;
  }

  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const reach = new Spring(0, GLIDE, (radius) => {
    negative.style.setProperty('--radius', `${Math.max(0, radius).toFixed(1)}px`);
  });
  const corners = new Spring(0, SNAP, (value) => {
    zone.style.setProperty('--in', `${14 + value * 8}px`);
    zone.style.setProperty('--arm', `${20 + value * 22}px`);
  });
  const cornersAtRest = () => zone.matches(':hover') ? ZONE_HOVER : 0;

  // Hover is a small rehearsal of the drop: the same corners, a little of the way.
  zone.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') corners.to(ZONE_HOVER, SNAP);
  });
  zone.addEventListener('pointerleave', () => corners.to(0, SNAP));

  /** The negative spreads from wherever the pointer is. */
  function aim(x: number, y: number) {
    const box = zone.getBoundingClientRect();
    if (!box.width) return;
    const inside = [clamp(x - box.left, 0, box.width), clamp(y - box.top, 0, box.height)] as const;
    negative.style.setProperty('--x', `${inside[0]}px`);
    negative.style.setProperty('--y', `${inside[1]}px`);
    negativeReach = Math.hypot(Math.max(inside[0], box.width - inside[0]), Math.max(inside[1], box.height - inside[1])) + 2;
    if (page.classList.contains('dragging')) reach.to(negativeReach, GLIDE);
  }

  function dragLabel(event: DragEvent) {
    const list = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file');
    if (!list.length) return state() === 'empty' ? 'Drop to convert' : 'Drop to add';
    const every = (kind: string) => list.every((item) => item.type.startsWith(kind));
    const noun = every('image/') ? 'photo' : every('video/') ? 'video' : every('audio/') ? 'audio file' : 'file';
    return list.length === 1 ? `Drop your ${noun}` : `Drop ${list.length} ${noun}s`;
  }

  function setDragging(on: boolean, label = '') {
    page.classList.toggle('dragging', on);
    if (state() === 'empty') {
      if (on) {
        restTitle ??= title.textContent;
        setText(label);
      }
      reach.to(on ? negativeReach : 0, on ? GLIDE : { response: 0.3, damping: 1 });
    }
    if (!on && restTitle) {
      const rest = restTitle;
      restTitle = null;
      setTimeout(() => {
        if (!page.classList.contains('dragging')) setText(rest);
      }, TITLE_RESTORE_MS);
    }
    corners.to(on ? 1 : cornersAtRest(), on ? { response: 0.38, damping: 0.72 } : SNAP);
    onCatch(on && state() === 'file' ? label : null);
  }

  addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    aim(event.clientX, event.clientY);
    if (!depth++) setDragging(true, dragLabel(event));
  });
  addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    aim(event.clientX, event.clientY);
  });
  addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) setDragging(false);
  });
  addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    setDragging(false);
    onFiles([...(event.dataTransfer?.files ?? [])], { x: event.clientX, y: event.clientY });
  });
  addEventListener('paste', (event) => {
    onFiles([...(event.clipboardData?.files ?? [])]);
  });

  return { setText };
}
