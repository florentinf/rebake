import { FORMATS, slugOf, type FormatId } from './formats';
import { TABLE } from './table';

export interface Link {
  from: FormatId;
  to: FormatId;
}

export const pagePath = ({ from, to }: Link) => `/${slugOf(from)}-to-${slugOf(to)}`;

/** Every row of the routing table, each with a page of its own. */
export function allLinks(): Link[] {
  return Object.entries(TABLE).flatMap(([from, row]) => row.targets.map((to) => ({ from: from as FormatId, to })));
}

const bySlug = (slug: string) => Object.keys(FORMATS).find((id) => slugOf(id as FormatId) === slug) as FormatId | undefined;

/** The conversion a path stands for. Offline, the service worker serves `/` for any path, so the app reads this itself. */
export function linkFromPath(path: string): Link | null {
  const match = /^\/([a-z0-9]+)-to-([a-z0-9]+)\/?$/.exec(path);
  if (!match) return null;
  const from = bySlug(match[1]!);
  const to = bySlug(match[2]!);
  return from && to && TABLE[from]?.targets.includes(to) ? { from, to } : null;
}

export const linkLine = ({ from, to }: Link) => `Convert ${FORMATS[from].label} to ${FORMATS[to].label} without sending your files anywhere.`;
