import { formatTime, parseTime } from '../core/time';
import { clamp, rubberBand, SNAP, Spring } from './motion';

/** A well of radios with one mark that slides between them, across rows too. */
export function createSegment(root: HTMLElement) {
  const mark = document.createElement('span');
  mark.className = 'seg-mark';
  mark.setAttribute('aria-hidden', 'true');

  const draw = () => {
    mark.style.transform = `translate(${x.x}px, ${y.x}px)`;
    mark.style.width = `${width.x}px`;
    mark.style.height = `${height.x}px`;
  };
  const x = new Spring(0, SNAP, draw);
  const y = new Spring(0, SNAP, draw);
  const width = new Spring(0, SNAP, draw);
  const height = new Spring(0, SNAP, draw);

  function place(animate: boolean) {
    if (mark.parentElement !== root) root.prepend(mark);
    const chosen = root.querySelector('input:checked')?.parentElement;
    mark.hidden = !chosen;
    if (!chosen || !chosen.offsetWidth) return;
    const move = animate && width.x > 0;
    for (const [spring, value] of [[x, chosen.offsetLeft], [y, chosen.offsetTop], [width, chosen.offsetWidth], [height, chosen.offsetHeight]] as const) {
      if (move) spring.to(value, SNAP);
      // Already heading there: a refresh mustn't cut a slide short.
      else if (spring.target !== value) spring.jump(value);
    }
  }

  root.addEventListener('change', () => place(true));
  new ResizeObserver(() => place(false)).observe(root);
  return { refresh: (animate = false) => place(animate) };
}

/**
 * The quality slider. The native range stays underneath as the real control, so
 * the keyboard, assistive tech and saved state all keep working. The pointer is
 * handled here for the value that rides the thumb, the edges that give, and the
 * soft stop at the recommended value.
 */
export function createSlider(input: HTMLInputElement, root: HTMLElement, recommended: number) {
  const fill = root.querySelector<HTMLElement>('.sl-fill')!;
  const thumb = root.querySelector<HTMLElement>('.sl-thumb')!;
  const rider = root.querySelector<HTMLElement>('.sl-rider')!;
  const stop = root.querySelector<HTMLElement>('.sl-mark')!;
  const low = Number(input.min);
  const span = Number(input.max) - low;
  let size = 1;
  let dragging = false;
  let grab = 0;

  const offset = (value: number) => ((value - low) / span) * size;
  const draw = () => {
    fill.style.transform = `scaleX(${clamp(position.x, 0, size) / size})`;
    thumb.style.transform = `translateX(${position.x}px)`;
    rider.style.transform = `translateX(${clamp(position.x, 8, size - 8)}px)`;
  };
  const position = new Spring(0, SNAP, draw);

  function showValue() {
    rider.textContent = input.value;
  }

  function sync(animate = false) {
    size = root.clientWidth || 1;
    stop.style.left = `${offset(recommended)}px`;
    showValue();
    const goal = offset(input.valueAsNumber);
    if (dragging) return;
    if (animate) position.to(goal, SNAP);
    // Already heading there: a refresh mustn't cut the settle short.
    else if (position.target !== goal) position.jump(goal);
  }

  function valueAt(x: number) {
    const raw = low + (clamp(x, 0, size) / size) * span;
    return Math.abs(raw - recommended) < span * 0.016 ? recommended : Math.round(raw);
  }

  function setValue(value: number) {
    if (input.valueAsNumber === value) return;
    input.value = String(value);
    showValue();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  root.addEventListener('pointerdown', (event) => {
    if (event.button) return;
    root.setPointerCapture(event.pointerId);
    dragging = true;
    root.classList.add('on');
    const here = event.clientX - root.getBoundingClientRect().left;
    grab = Math.abs(here - position.x) < 20 ? here - position.x : 0;
    if (!grab) {
      setValue(valueAt(here));
      position.to(here, SNAP);
    }
    input.focus({ preventScroll: true });
    event.preventDefault();
  });

  root.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const x = event.clientX - root.getBoundingClientRect().left - grab;
    const past = x < 0 ? x : x > size ? x - size : 0;
    const value = valueAt(x);
    setValue(value);
    position.jump(value === recommended ? offset(value) : past ? (past < 0 ? 0 : size) + rubberBand(past, size) : x);
  });

  const release = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('on');
    position.to(offset(input.valueAsNumber), { response: 0.3, damping: 0.8 });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  input.addEventListener('input', () => {
    showValue();
    if (!dragging) position.to(offset(input.valueAsNumber), SNAP);
  });

  new ResizeObserver(() => sync()).observe(root);
  return { sync };
}

/**
 * The trim timeline. The two time fields stay the source of truth, and the
 * handles write to them. Typing moves the handles the other way.
 */
export function createTrim(
  root: HTMLElement,
  start: HTMLInputElement,
  end: HTMLInputElement,
  onChange: () => void,
) {
  const track = root.querySelector<HTMLElement>('.tr-track')!;
  const before = root.querySelector<HTMLElement>('.tr-before')!;
  const after = root.querySelector<HTMLElement>('.tr-after')!;
  const span = root.querySelector<HTMLElement>('.tr-span')!;
  const startHandle = root.querySelector<HTMLElement>('.tr-start')!;
  const endHandle = root.querySelector<HTMLElement>('.tr-end')!;
  let duration = 0;
  let size = 1;

  const read = () => {
    const from = start.value ? parseTime(start.value) : 0;
    const to = end.value ? parseTime(end.value) : duration;
    return [clamp(from ?? 0, 0, duration), clamp(to ?? duration, 0, duration)] as const;
  };

  function paint() {
    const [left, right] = [leftEdge.x, rightEdge.x];
    before.style.width = `${left}px`;
    after.style.width = `${size - right}px`;
    span.style.left = `${left}px`;
    span.style.width = `${Math.max(0, right - left)}px`;
    startHandle.style.left = `${left}px`;
    endHandle.style.left = `${right}px`;
  }
  const leftEdge = new Spring(0, SNAP, paint);
  const rightEdge = new Spring(0, SNAP, paint);

  /** Handles follow a finger exactly, and glide when the times change any other way. */
  function draw(animate = true) {
    if (!duration) return;
    const [from, to] = read();
    for (const [edge, value] of [[leftEdge, (from / duration) * size], [rightEdge, (to / duration) * size]] as const) {
      if (animate) edge.to(value, SNAP);
      else edge.jump(value);
    }
    for (const [handle, value] of [[startHandle, from], [endHandle, to]] as const) {
      handle.setAttribute('aria-valuemax', String(Math.round(duration)));
      handle.setAttribute('aria-valuenow', String(Math.round(value)));
      handle.setAttribute('aria-valuetext', formatTime(value));
    }
  }

  function write(input: HTMLInputElement, seconds: number) {
    const atEdge = input === start ? seconds <= 0 : seconds >= duration;
    input.value = atEdge ? '' : formatTime(seconds);
    draw(false);
    onChange();
  }

  function bind(handle: HTMLElement, input: HTMLInputElement) {
    let held = false;
    const move = (seconds: number) => {
      const [from, to] = read();
      write(input, input === start ? clamp(seconds, 0, to - 1) : clamp(seconds, from + 1, duration));
    };
    handle.addEventListener('pointerdown', (event) => {
      handle.setPointerCapture(event.pointerId);
      held = true;
      handle.classList.add('on');
      handle.focus({ preventScroll: true });
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (held) move(((event.clientX - track.getBoundingClientRect().left) / size) * duration);
    });
    const release = () => {
      held = false;
      handle.classList.remove('on');
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
    handle.addEventListener('keydown', (event) => {
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
      if (!step) return;
      event.preventDefault();
      move(read()[input === start ? 0 : 1] + step);
    });
  }

  bind(startHandle, start);
  bind(endHandle, end);
  start.addEventListener('input', () => draw());
  end.addEventListener('input', () => draw());
  new ResizeObserver(() => {
    size = track.clientWidth || 1;
    draw(false);
  }).observe(track);

  return {
    /** A file with no known length gets the time fields alone. */
    setDuration(seconds: number) {
      duration = seconds;
      end.placeholder = seconds ? formatTime(seconds) : 'End';
      track.hidden = !seconds;
      draw(false);
    },
    draw,
  };
}
