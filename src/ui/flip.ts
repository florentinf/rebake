const DURATION = 220;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Runs `mutate`, then animates every [data-flip] element from where it was.
 * Reads positions mid-animation, so an interrupted transition carries on from
 * its current spot instead of jumping.
 */
export function flip(mutate: () => void) {
  if (prefersReducedMotion()) {
    mutate();
    return;
  }
  const before = new Map<Element, DOMRect>();
  for (const element of document.querySelectorAll('[data-flip]')) {
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height) before.set(element, rect);
  }

  mutate();

  for (const element of document.querySelectorAll<HTMLElement>('[data-flip]')) {
    for (const animation of element.getAnimations()) {
      if (animation.id === 'flip') animation.cancel();
    }
    const last = element.getBoundingClientRect();
    if (!last.width || !last.height) continue;
    const first = before.get(element);
    const options = { id: 'flip', duration: DURATION, easing: EASE_OUT };
    if (!first) {
      element.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        options,
      );
      continue;
    }
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], options);
  }
}
