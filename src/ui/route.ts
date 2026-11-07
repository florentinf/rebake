import { CHASE, clamp, FLICK, GLIDE, lerp, prefersReducedMotion, Spring } from './motion';

type Point = readonly [number, number];

const ARRIVAL_WAIT_MS = 420;

/**
 * The title: format, arrow, format. The arrow is the progress bar. It grows
 * across the column to reach the target, then folds into a tick. It's three
 * strokes on three springs, so it can be stopped and turned back at any point.
 */
export function createRoute(root: HTMLElement, from: HTMLElement, to: HTMLElement, box: HTMLElement, arrow: SVGPathElement, track: SVGPathElement, rider: HTMLElement) {
  let boxWidth = 60;
  let size = 90;
  let middle = 30;
  let travel = 0;
  let boxLeft = 0;
  let width = 0;

  const opening = new Spring(0, GLIDE, draw);
  const progress = new Spring(0, CHASE, draw);
  const fold = new Spring(0, FLICK, draw);

  const mix = (a: Point, b: Point, t: number) => `${lerp(a[0], b[0], t).toFixed(2)} ${lerp(a[1], b[1], t).toFixed(2)}`;

  function draw() {
    const shift = opening.x * travel;
    const tip = boxWidth + shift * clamp(progress.x, 0, 1);
    const head = 0.27 * size;
    const t = fold.x;
    to.style.transform = shift > 0.1 ? `translateX(${shift}px)` : '';

    const start: Point = [size * 0.04, middle];
    const point: Point = [tip, middle];
    const upper: Point = [tip - head, middle - head];
    const lower: Point = [tip - head, middle + head];
    const tickStart: Point = [boxWidth * 0.1, middle + 0.02 * size];
    const tickCorner: Point = [boxWidth * 0.37, middle + 0.25 * size];
    const tickEnd: Point = [boxWidth * 0.95, middle - 0.29 * size];
    arrow.setAttribute('d', [
      `M${mix(start, tickStart, t)}L${mix(point, tickCorner, t)}`,
      `M${mix(upper, tickEnd, t)}L${mix(point, tickCorner, t)}`,
      `M${mix(lower, tickCorner, t)}L${mix(point, tickCorner, t)}`,
    ].join(''));

    track.setAttribute('d', shift > 2 ? `M${tip + 6} ${middle}L${boxWidth + shift} ${middle}` : '');
    track.style.opacity = String(opening.x);
    rider.style.opacity = String(clamp(opening.x * 1.4 - 0.2, 0, 1) * (1 - clamp(fold.x, 0, 1)));
    const riderWidth = rider.offsetWidth;
    rider.style.transform = `translateX(${clamp(boxLeft + tip - riderWidth / 2, 0, width - riderWidth)}px)`;
    rider.textContent = `${Math.round(clamp(progress.x, 0, 1) * 100)}%`;
  }

  function fit() {
    root.style.removeProperty('--route-size');
    const room = root.clientWidth;
    const natural = to.offsetLeft + to.offsetWidth;
    if (room && natural > room) {
      const base = Number.parseFloat(getComputedStyle(root).fontSize);
      root.style.setProperty('--route-size', `${Math.floor((base * room) / natural * 0.985)}px`);
    }
  }

  function measure() {
    if (root.hidden) return;
    fit();
    size = Number.parseFloat(getComputedStyle(root).fontSize);
    boxWidth = box.offsetWidth;
    middle = box.offsetHeight / 2 + size * 0.012;
    boxLeft = box.offsetLeft;
    width = root.clientWidth;
    travel = Math.max(0, width - (to.offsetLeft + to.offsetWidth));
    arrow.style.strokeWidth = (size * 0.088).toFixed(2);
    draw();
  }

  new ResizeObserver(measure).observe(root);
  void document.fonts?.ready.then(measure);

  function setText(element: HTMLElement, text: string) {
    if (element.textContent === text) return;
    element.textContent = text;
    if (!prefersReducedMotion() && root.offsetWidth) {
      element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    }
  }

  return {
    set(fromText: string, toText: string) {
      setText(from, fromText);
      setText(to, toText);
      measure();
    },
    waiting(on: boolean) {
      root.classList.toggle('waiting', on);
    },
    /** The arrow stretches out and starts from nothing. */
    begin() {
      root.dataset.tone = 'work';
      fold.jump(0);
      progress.jump(0);
      opening.to(1, GLIDE);
    },
    advance(position: number) {
      progress.to(position, CHASE);
    },
    /** Resolves when the tip reaches the target, or soon after, so a fast job isn't held up. */
    arrive() {
      progress.to(1, CHASE);
      return new Promise<void>((resolve) => {
        const started = performance.now();
        const check = () => {
          if (progress.x > 0.99 || performance.now() - started > ARRIVAL_WAIT_MS) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
    },
    /** Folds into the tick. */
    finish() {
      root.dataset.tone = 'done';
      root.classList.remove('waiting');
      fold.to(1, FLICK);
      opening.to(0, { response: 0.5, damping: 0.92 });
    },
    /** Goes back to a plain arrow from wherever it is. */
    retract() {
      root.dataset.tone = '';
      root.classList.remove('waiting');
      opening.to(0, GLIDE);
      progress.to(0, GLIDE);
    },
    reset() {
      opening.jump(0);
      progress.jump(0);
      fold.jump(0);
      root.dataset.tone = '';
      root.classList.remove('waiting');
    },
  };
}
