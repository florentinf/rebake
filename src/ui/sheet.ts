import { FORMATS, type FormatId } from '../core/formats';
import { clamp, CHASE, fadeIn, FLICK, GLIDE, prefersReducedMotion, reshape, reveal, Spring } from './motion';
import { thumbnail } from './thumbs';

const MANY_FILES = 5;
const STAGGER_MS = 28;
const LONGEST_STAGGER_MS = 280;

const TICK = 'M5 11.5 9.5 16 17.5 6.5';
const CROSS = 'M6 6l10 10M16 6 6 16';

export interface Row {
  element: HTMLLIElement;
  /** Follows the file's real progress: 0 is pale, 1 is the finished picture. */
  develop(value: number): void;
  latent(): void;
  restore(name: string, size: string): void;
  succeed(name: string, size: string): void;
  fail(reason: string): void;
}

interface Slide {
  x: Spring;
  y: Spring;
  scale: Spring;
}

const svg = (viewBox: string, path: string, pathLength = false) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  element.setAttribute('viewBox', viewBox);
  element.setAttribute('aria-hidden', 'true');
  const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  stroke.setAttribute('d', path);
  if (pathLength) stroke.setAttribute('pathLength', '1');
  element.append(stroke);
  return element;
};

const span = (className: string, text: string) => {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
};

function slideOf(element: HTMLElement, slides: WeakMap<HTMLElement, Slide>) {
  let slide = slides.get(element);
  if (!slide) {
    const draw = () => {
      const { x, y, scale } = slide!;
      element.style.transform = x.x || y.x || scale.x !== 1 ? `translate(${x.x}px, ${y.x}px) scale(${scale.x})` : '';
    };
    slide = { x: new Spring(0, GLIDE, draw), y: new Spring(0, GLIDE, draw), scale: new Spring(1, GLIDE, draw) };
    slides.set(element, slide);
  }
  return slide;
}

/** The list of files: a small picture that develops, a name, its facts, and a result. */
export function createSheet(list: HTMLUListElement, onAdd: () => void) {
  const slides = new WeakMap<HTMLElement, Slide>();
  const addLabel = span('', 'Add files');
  const addButton = document.createElement('button');
  addButton.className = 'add';
  addButton.type = 'button';
  addButton.append(svg('0 0 16 16', 'M8 3v10M3 8h10'), addLabel);
  addButton.addEventListener('click', onAdd);
  const addTotal = span('add-total', '');
  const addCell = document.createElement('li');
  addCell.className = 'add-cell';
  addCell.append(addButton, addTotal);

  function createRow(file: File, format: FormatId, facts: string, onRemove: () => void): Row {
    const name = span('row-name', file.name);
    name.title = file.name;
    const size = span('row-size', facts);
    const print = document.createElement('div');
    print.className = 'print';
    print.append(span('print-label', FORMATS[format].label));

    const mark = document.createElement('i');
    mark.className = 'row-mark';
    mark.setAttribute('aria-hidden', 'true');
    const markIcon = svg('0 0 22 22', TICK, true);
    mark.append(markIcon);

    const remove = document.createElement('button');
    remove.className = 'row-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.append(svg('0 0 14 14', 'M3 3l8 8M11 3l-8 8'));
    remove.addEventListener('click', onRemove);

    const details = document.createElement('div');
    details.className = 'row-details';
    details.append(name, size);
    const element = document.createElement('li');
    element.className = 'row';
    element.append(print, details, mark, remove);

    const development = new Spring(1, CHASE, (value) => {
      print.style.setProperty('--develop', clamp(value, 0, 1).toFixed(3));
    });

    const { category } = FORMATS[format];
    if (category === 'image' || category === 'video') {
      void thumbnail(file, category).then((canvas) => {
        if (!canvas) return;
        print.append(canvas);
        fadeIn(canvas);
      });
    }

    return {
      element,
      develop: (value) => development.to(value, CHASE),
      latent() {
        element.classList.remove('ok', 'failed');
        development.to(0, GLIDE);
      },
      restore(text, restored) {
        element.classList.remove('ok', 'failed');
        name.textContent = text;
        name.title = text;
        size.textContent = restored;
        development.to(1, GLIDE);
      },
      succeed(text, result) {
        development.to(1, CHASE);
        markIcon.firstElementChild!.setAttribute('d', TICK);
        name.textContent = text;
        name.title = text;
        size.textContent = result;
        element.classList.add('ok');
      },
      fail(reason) {
        markIcon.firstElementChild!.setAttribute('d', CROSS);
        size.textContent = reason;
        element.classList.add('failed');
        development.to(0, GLIDE);
      },
    };
  }

  /** New rows arrive from the drop point, or rise into place from a picker. */
  function arrive(element: HTMLElement, index: number, from?: { x: number; y: number }) {
    if (prefersReducedMotion()) return;
    const box = element.getBoundingClientRect();
    const slide = slideOf(element, slides);
    element.style.opacity = '0';
    setTimeout(() => {
      element.style.opacity = '';
      if (from) {
        slide.x.place(from.x - (box.left + box.width / 2)).to(0, FLICK);
        slide.y.place(from.y - (box.top + box.height / 2)).to(0, FLICK);
        slide.scale.place(0.55).to(1, FLICK);
      } else {
        slide.y.place(14).to(0, GLIDE);
      }
    }, Math.min(index * STAGGER_MS, LONGEST_STAGGER_MS));
  }

  return {
    createRow,
    addLabel,
    addCell,
    /** The whole selection's size, only worth saying for a batch. */
    setTotal(text: string) {
      addTotal.textContent = text;
    },
    /** Shows these rows. Those already on screen glide, new ones arrive. */
    show(rows: Row[], fresh: Row[], from?: { x: number; y: number }) {
      const before = new Map([...list.children].map((element) => [element, element.getBoundingClientRect()]));
      reshape(list, () => {
        list.classList.toggle('many', rows.length > MANY_FILES);
        list.replaceChildren(...rows.map((row) => row.element), addCell);
      });
      for (const element of list.children as HTMLCollectionOf<HTMLElement>) {
        const first = before.get(element);
        if (!first || prefersReducedMotion()) continue;
        const shown = element.style.transform;
        element.style.transform = '';
        const last = element.getBoundingClientRect();
        element.style.transform = shown;
        const y = first.top - last.top;
        if (Math.abs(y) < 0.5) continue;
        slideOf(element, slides).y.place(y).to(0, GLIDE);
      }
      fresh.forEach((row, index) => arrive(row.element, index, from));
    },
    /** Takes one row out, and the rest close up behind it. */
    remove(row: Row) {
      reveal(row.element, false, false, () => {
        reshape(list, () => {
          row.element.remove();
          list.classList.toggle('many', list.querySelectorAll('.row').length > MANY_FILES);
        });
      });
    },
    clear() {
      list.replaceChildren();
    },
  };
}
