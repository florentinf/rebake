import { collapse, reveal } from './motion';

const keyFor = (kind: string) => `rebake.more.${kind}`;

interface Saved {
  open?: boolean;
  values?: Record<string, string | boolean>;
}

function load(kind: string): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(keyFor(kind)) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function store(kind: string, saved: Saved) {
  try {
    localStorage.setItem(keyFor(kind), JSON.stringify(saved));
  } catch { /* private mode */ }
}

/** The Options panel: closed by default, and each category keeps its own state. */
export function createDrawer(more: HTMLButtonElement, panel: HTMLElement) {
  const controls = [...panel.querySelectorAll<HTMLInputElement>('[data-keep]')];
  const sections = [...panel.querySelectorAll<HTMLElement>('[data-show]')];
  const isToggle = (control: HTMLInputElement) => control.type === 'radio' || control.type === 'checkbox';
  const defaults = new Map(controls.map((control) => [control, isToggle(control) ? control.defaultChecked : control.defaultValue]));
  let kind: string | null = null;
  let overrides: Record<string, string | boolean> = {};
  /** Whether the panel should be open once this category's rows are in. */
  let wanted: boolean | null = null;

  function setOpen(open: boolean, instant = false) {
    more.setAttribute('aria-expanded', String(open));
    collapse(panel, open, instant);
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
    if (!values || typeof values !== 'object' || Array.isArray(values)) values = {};
    const effective = { ...overrides, ...values };
    for (const control of controls) {
      const saved = effective[control.dataset.keep!];
      if (control.type === 'radio') {
        const valid = controls.some((other) => other.type === 'radio' && other.name === control.name && other.value === saved);
        control.checked = valid ? saved === control.value : defaults.get(control) === true;
      } else if (control.type === 'checkbox') {
        control.checked = typeof saved === 'boolean' ? saved : defaults.get(control) === true;
      } else {
        control.value = typeof saved === 'string' ? saved : String(defaults.get(control));
      }
    }
    wanted = open === true;
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
    /** Whether anything differs from this category's defaults. */
    isDirty: () => controls.some((control) => {
      const base = overrides[control.dataset.keep!];
      if (control.type === 'radio') return control.checked !== (base === undefined ? defaults.get(control) === true : base === control.value);
      if (control.type === 'checkbox') return control.checked !== defaults.get(control);
      return control.value !== (typeof base === 'string' ? base : String(defaults.get(control)));
    }),
    reset() { restore({ open: true }); save(); },
    /**
     * Swaps in a category's own state. Its rows follow in `show`, once they can be
     * decided. Changing the format mid-job leaves the panel as it is: it only
     * opens or closes by itself for a new file.
     */
    use(next: string, midJob: boolean) {
      if (next === kind) return;
      save();
      kind = next;
      overrides = next === 'image-pdf' ? { colorSpace: 'preserve', quality: '92' } : {};
      restore(load(next));
      if (midJob) wanted = null;
    },
    /** Shows the controls whose `data-show` has one of these tokens. `animate` is false until the job is on screen. */
    show(tokens: Set<string>, animate: boolean) {
      const glide = animate && more.getAttribute('aria-expanded') === 'true';
      // Inner rows first, so a row that's opening measures itself with them in place.
      for (const section of [...sections].reverse()) {
        const on = section.dataset.show!.split(' ').some((token) => tokens.has(token));
        section.toggleAttribute('data-off', !on);
        reveal(section, on, !glide);
      }
      if (wanted !== null) setOpen(wanted, !animate);
      wanted = null;
    },
  };
}
