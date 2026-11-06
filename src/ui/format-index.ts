import { FORMATS, type FormatId } from '../core/formats';
import { pagePath } from '../core/links';
import { TABLE } from '../core/table';

const GROUPS: [string, FormatId[]][] = [
  ['Images', ['jpg', 'png', 'heic', 'webp', 'gif', 'avif', 'jxl', 'tiff', 'svg', 'ico']],
  ['Video', ['mp4', 'mov', 'webm', 'mkv']],
  ['Audio', ['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg', 'aac']],
  ['Documents', ['pdf', 'docx', 'md', 'html', 'epub', 'odt', 'rtf', 'tex']],
  ['Data', ['csv', 'xlsx', 'json', 'yaml', 'tsv']],
];

const targetsOf = (format: FormatId) => TABLE[format]?.targets ?? [];

/** Every format rebake reads. Pointing at one shows what it can become; its link opens that converter. */
export function createFormatIndex(root: HTMLElement, line: HTMLElement) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const idle = coarse ? 'Tap a format to see what it can become.' : 'Point at a format to see what it can become.';
  const links = new Map<FormatId, HTMLAnchorElement>();
  let current: FormatId | null = null;

  function look(format: FormatId | null) {
    current = format;
    root.classList.toggle('looking', !!format);
    const targets = format ? targetsOf(format) : [];
    for (const [id, link] of links) {
      link.classList.toggle('is-from', id === format);
      link.classList.toggle('is-to', targets.includes(id));
    }
    if (!format) {
      line.textContent = idle;
      return;
    }
    const labels = targets.map((id) => FORMATS[id].label);
    const name = document.createElement('b');
    name.textContent = FORMATS[format].label;
    const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}` : labels[0];
    line.replaceChildren(name, ` can become ${list}.`);
  }

  for (const [title, formats] of GROUPS) {
    const row = document.createElement('div');
    row.className = 'ix-row';
    const heading = document.createElement('span');
    heading.className = 'ix-title';
    heading.textContent = title;
    const list = document.createElement('div');
    list.className = 'ix-list';
    for (const format of formats) {
      const link = document.createElement('a');
      link.className = 'format';
      link.textContent = FORMATS[format].label;
      link.href = pagePath({ from: format, to: targetsOf(format)[0]! });
      link.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') look(format);
      });
      link.addEventListener('focus', () => look(format));
      // On touch the first tap shows what it can become, the second opens it.
      link.addEventListener('click', (event) => {
        if (coarse && current !== format) {
          event.preventDefault();
          look(format);
        }
      });
      links.set(format, link);
      list.append(link);
    }
    row.append(heading, list);
    root.append(row);
  }

  root.addEventListener('pointerleave', () => look(null));
  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget as Node | null)) look(null);
  });
  look(null);
}
