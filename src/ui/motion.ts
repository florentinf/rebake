/** Springs: one engine for everything that moves, so any motion can be interrupted. */

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface SpringOptions {
  /** Seconds to reach the target, roughly. */
  response: number;
  /** 1 settles without overshoot, below 1 overshoots. */
  damping: number;
}

export const SNAP: SpringOptions = { response: 0.22, damping: 1 };
export const GLIDE: SpringOptions = { response: 0.42, damping: 1 };
export const CHASE: SpringOptions = { response: 0.62, damping: 1 };
export const FLICK: SpringOptions = { response: 0.4, damping: 0.78 };

const running = new Set<Spring>();
let lastFrame = 0;
let frameId = 0;

function frame(now: number) {
  const dt = Math.min(0.034, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;
  for (const spring of running) spring.step(dt);
  frameId = running.size ? requestAnimationFrame(frame) : 0;
}

export class Spring {
  x: number;
  target: number;
  private velocity = 0;
  private omega = 1;
  private damping = 1;

  constructor(value: number, options: SpringOptions, private readonly onChange?: (value: number) => void) {
    this.x = value;
    this.target = value;
    this.tune(options);
  }

  private tune({ response, damping }: SpringOptions) {
    this.omega = (2 * Math.PI) / response;
    this.damping = damping;
  }

  /** Heads for `target` from wherever it is now, keeping its speed. */
  to(target: number, options?: SpringOptions) {
    if (options) this.tune(options);
    this.target = target;
    if (prefersReducedMotion()) return this.jump(target);
    running.add(this);
    if (!frameId) {
      lastFrame = performance.now();
      frameId = requestAnimationFrame(frame);
    }
    return this;
  }

  jump(value: number) {
    this.x = value;
    this.target = value;
    this.velocity = 0;
    running.delete(this);
    this.onChange?.(value);
    return this;
  }

  /** Places it without stopping it, for motion that starts from an offset. */
  place(value: number) {
    this.x = value;
    return this;
  }

  step(dt: number) {
    const steps = Math.ceil(dt / 0.004) || 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const pull = -this.omega * this.omega * (this.x - this.target) - 2 * this.damping * this.omega * this.velocity;
      this.velocity += pull * h;
      this.x += this.velocity * h;
    }
    if (Math.abs(this.x - this.target) < 0.0005 * Math.max(1, Math.abs(this.target)) && Math.abs(this.velocity) < 0.01) {
      this.x = this.target;
      this.velocity = 0;
      running.delete(this);
    }
    this.onChange?.(this.x);
  }
}

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
export const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** The further past the edge, the less it follows. */
export const rubberBand = (overshoot: number, size: number, constant = 0.4) =>
  (overshoot * size * constant) / (size + constant * Math.abs(overshoot));

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Fades an element in from slightly below. */
export function rise(element: Element, delay = 0, distance = 10) {
  if (prefersReducedMotion()) return;
  element.animate(
    [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 380, delay, easing: EASE_OUT, fill: 'backwards' },
  );
}

/** A small sideways shake for something refused. */
export function nudge(element: Element) {
  if (prefersReducedMotion()) return;
  element.animate([0, -6, 5, -3, 2, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380, easing: 'ease-out' });
}

/** Swaps a button's label: the old one leaves upwards, the new one arrives from below. */
export function rollLabel(button: HTMLElement, text: string) {
  const old = button.lastElementChild as HTMLElement | null;
  if (old?.textContent === text) return;
  const next = document.createElement('span');
  next.textContent = text;
  button.append(next);
  if (!old) return;
  if (prefersReducedMotion() || !button.offsetWidth) {
    old.remove();
    return;
  }
  old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' })
    .finished.then(() => old.remove(), () => old.remove());
  next.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 40, easing: EASE_OUT, fill: 'backwards' });
}

const collapses = new WeakMap<HTMLElement, Spring>();

/** Opens or closes a `.col` to its natural height. Closed content can't take focus. */
export function collapse(element: HTMLElement, open: boolean, instant = false) {
  element.inert = !open;
  let spring = collapses.get(element);
  if (!spring) {
    spring = new Spring(element.offsetHeight, GLIDE, (height) => {
      element.style.height = `${Math.max(0, height)}px`;
      if (height === spring!.target && !element.inert) {
        element.style.height = 'auto';
        element.classList.add('settled');
      }
    });
    collapses.set(element, spring);
  }
  element.classList.remove('settled');
  const target = open ? element.scrollHeight : 0;
  if (instant || prefersReducedMotion() || !element.offsetParent) {
    spring.jump(target);
    element.style.height = open ? 'auto' : '0px';
    element.classList.toggle('settled', open);
    return;
  }
  spring.place(element.offsetHeight).to(target, GLIDE);
}
