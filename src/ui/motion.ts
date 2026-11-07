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

/** Fades something in where it now stands, for content that arrives on its own time. */
export function fadeIn(element: Element) {
  if (prefersReducedMotion()) return;
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE_OUT });
}

/**
 * A spring's tail is invisible, so anything this close has arrived. It's small
 * because several rows can land on one frame, and their last steps add up.
 */
const ARRIVED = 0.04;

interface Fold {
  spring: Spring;
  paint(height: number): void;
  natural: number;
  /** The block's own top margin, and the gap its parent leaves for it. Both close with it. */
  margin: number;
  gap: number;
  padding: [number, number];
  closing: boolean;
  /** Only its height is changing, so it stays fully drawn. */
  solid: boolean;
  onHidden?: (() => void) | undefined;
}

const folds = new WeakMap<HTMLElement, Fold>();
const FOLD_STYLES = ['height', 'min-height', 'overflow', 'opacity', 'margin-block-start', 'padding-block-start', 'padding-block-end'];

const unfolded = (element: HTMLElement) => {
  for (const property of FOLD_STYLES) element.style.removeProperty(property);
};

const onScreen = (element: HTMLElement) => !!element.parentElement?.offsetParent;

function foldOf(element: HTMLElement) {
  const existing = folds.get(element);
  if (existing) return existing;
  const paint = (height: number) => {
    const { natural, margin, gap, padding, solid } = fold;
    element.style.height = `${Math.max(0, height)}px`;
    if (solid) return;
    const share = natural ? clamp(height / natural, 0, 1) : 0;
    element.style.opacity = String(share);
    element.style.marginBlockStart = `${margin * share - gap * (1 - share)}px`;
    element.style.paddingBlockStart = `${padding[0] * share}px`;
    element.style.paddingBlockEnd = `${padding[1] * share}px`;
  };
  const fold: Fold = {
    spring: new Spring(0, GLIDE, (height) => {
      const { target } = fold.spring;
      if (Math.abs(height - target) > ARRIVED) {
        paint(height);
        return;
      }
      if (height !== target) {
        fold.spring.jump(target);
        return;
      }
      unfolded(element);
      if (!fold.closing) {
        // What's inside may have changed on the way. Finish there, not with a snap.
        const natural = element.offsetHeight;
        if (!target || Math.abs(natural - target) <= 0.5) return;
        fold.natural = natural;
        fold.solid = true;
        hold(element);
        paint(height);
        fold.spring.to(natural, GLIDE);
        return;
      }
      fold.closing = false;
      element.hidden = true;
      const done = fold.onHidden;
      fold.onHidden = undefined;
      done?.();
    }),
    paint,
    natural: 0,
    margin: 0,
    gap: 0,
    padding: [0, 0],
    closing: false,
    solid: false,
  };
  folds.set(element, fold);
  return fold;
}

function hold(element: HTMLElement) {
  element.style.overflow = 'hidden';
  element.style.minHeight = '0';
}

/**
 * Shows or hides a block, and the page closes up around it on a spring. Everything
 * conditional goes through here, so nothing appears or vanishes. A hiding block
 * can't take focus, and only becomes `hidden` once it has finished. The parent has
 * to be a flex column or block: a grid track can't go negative, so a grid would
 * hold the block's gap open until the very end and then drop it.
 */
export function reveal(element: HTMLElement, show: boolean, instant = false, onHidden?: () => void) {
  const fold = foldOf(element);
  const open = !element.hidden && !fold.closing;
  fold.onHidden = show ? undefined : onHidden;
  element.inert = !show;
  if (instant || prefersReducedMotion() || !onScreen(element)) {
    fold.closing = !show;
    if (show) element.hidden = false;
    fold.spring.jump(0);
    return;
  }
  if (!show && element.hidden) {
    fold.onHidden = undefined;
    onHidden?.();
    return;
  }
  if (show === open) return;
  const resting = !element.style.height;
  element.hidden = false;
  if (resting) {
    const style = getComputedStyle(element);
    fold.natural = element.offsetHeight;
    fold.margin = Number.parseFloat(style.marginBlockStart) || 0;
    fold.gap = Number.parseFloat(getComputedStyle(element.parentElement!).rowGap) || 0;
    fold.padding = [Number.parseFloat(style.paddingBlockStart) || 0, Number.parseFloat(style.paddingBlockEnd) || 0];
    fold.spring.place(show ? 0 : fold.natural);
  }
  fold.solid = false;
  fold.closing = !show;
  hold(element);
  fold.paint(fold.spring.x);
  fold.spring.to(show ? fold.natural : 0, GLIDE);
}

/** Changes what a block holds and glides to its new height. */
export function reshape(element: HTMLElement, change: () => void, fade = false) {
  const before = element.offsetHeight;
  const text = element.textContent;
  change();
  if (element.hidden || prefersReducedMotion() || !onScreen(element)) return;
  const fold = foldOf(element);
  const resting = !element.style.height;
  const held = element.style.cssText;
  unfolded(element);
  const after = element.offsetHeight;
  element.style.cssText = held;
  fold.natural = after;
  if (fold.closing) return;
  if (resting) {
    if (fade && text !== element.textContent) fadeIn(element);
    if (after === before) return;
    fold.solid = true;
    hold(element);
    fold.spring.place(before);
    fold.paint(before);
  }
  fold.spring.to(after, GLIDE);
}

const collapses = new WeakMap<HTMLElement, Spring>();

/** How tall a clipped column's contents are right now, whatever its own height. */
function contentHeight(element: HTMLElement) {
  const last = element.lastElementChild;
  return last ? Math.max(0, last.getBoundingClientRect().bottom - element.getBoundingClientRect().top) : 0;
}

/** Opens or closes a `.col` to its natural height. Closed content can't take focus. */
export function collapse(element: HTMLElement, open: boolean, instant = false) {
  element.inert = !open;
  // Already open: measuring again would only clip what's inside for no reason.
  if (open && element.classList.contains('settled')) return;
  let spring = collapses.get(element);
  if (!spring) {
    spring = new Spring(element.offsetHeight, GLIDE, (height) => {
      const { target } = spring!;
      if (height !== target && Math.abs(height - target) <= ARRIVED) {
        spring!.jump(target);
        return;
      }
      element.style.height = `${Math.max(0, height)}px`;
      if (element.inert) return;
      // What's inside can change on the way, so it heads for that, in one move.
      const natural = contentHeight(element);
      if (natural && Math.abs(natural - target) > 0.5) {
        spring!.to(natural, GLIDE);
        return;
      }
      if (height !== target) return;
      element.style.height = 'auto';
      element.classList.add('settled');
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
