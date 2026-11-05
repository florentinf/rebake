import type { Category } from '../core/formats';

export interface Facts {
  /** Tokens matched against each control's `data-show`. */
  show: Set<string>;
}

const keyFor = (kind: Category) => `rebake.more.${kind}`;

interface Saved {
  open?: boolean;
  values?: Record<string, string | boolean>;
}

function load(kind: Category): Saved {
  try {
    return JSON.parse(localStorage.getItem(keyFor(kind)) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function store(kind: Category, saved: Saved) {
  try {
    localStorage.setItem(keyFor(kind), JSON.stringify(saved));
  } catch { /* private mode */ }
}

/** The "More" panel: closed by default, and each category keeps its own state. */
export function createDrawer(drawer: HTMLElement, more: HTMLButtonElement, panel: HTMLElement) {
  const controls = [...panel.querySelectorAll<HTMLInputElement>('[data-keep]')];
  const sections = [...panel.querySelectorAll<HTMLElement>('[data-show]')];
  const isToggle = (control: HTMLInputElement) => control.type === 'radio' || control.type === 'checkbox';
  const defaults = new Map(controls.map((control) => [control, isToggle(control) ? control.defaultChecked : control.defaultValue]));
  let kind: Category | null = null;

  function setOpen(open: boolean) {
    more.setAttribute('aria-expanded', String(open));
    panel.toggleAttribute('inert', !open);
    drawer.classList.toggle('open', open);
  }

  function snapshot(): Saved {
    const values: Record<string, string | boolean> = {};
    for (const control of controls) {
      if (control.type === 'radio') {
        if (control.checked) values[control.dataset.keep!] = control.value;
      } else {
        values[control.dataset.keep!] = control.type === 'checkbox' ? control.checked : control.value;
      }
    }
    return { open: more.getAttribute('aria-expanded') === 'true', values };
  }

  function restore({ open = false, values = {} }: Saved) {
    for (const control of controls) {
      const saved = values[control.dataset.keep!];
      if (control.type === 'radio') {
        control.checked = saved === undefined ? defaults.get(control) === true : saved === control.value;
      } else if (control.type === 'checkbox') {
        control.checked = typeof saved === 'boolean' ? saved : defaults.get(control) === true;
      } else {
        control.value = typeof saved === 'string' ? saved : String(defaults.get(control));
      }
    }
    setOpen(open);
  }

  function save() {
    if (kind) store(kind, snapshot());
  }

  panel.addEventListener('change', (event) => {
    if ((event.target as HTMLElement).dataset.keep) save();
  });

  return {
    save,
    setOpen,
    isOpen: () => more.getAttribute('aria-expanded') === 'true',
    /** Shows the right controls, and swaps in the category's own state when it changes. */
    sync(next: Category, facts: Facts) {
      if (next !== kind) {
        kind = next;
        restore(load(next));
      }
      for (const section of sections) {
        section.hidden = !section.dataset.show!.split(' ').some((token) => facts.show.has(token));
      }
    },
  };
}
