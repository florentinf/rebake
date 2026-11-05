import { dataEngine } from '../engines/data';
import { documentEngine } from '../engines/document';
import { imageEngine } from '../engines/image';
import { mediaEngine } from '../engines/media';
import { pdfEngine } from '../engines/pdf';
import type { Engine, Inspection } from './engine';
import type { FormatId } from './formats';
import { engineIdFor, TABLE, type EngineId, type Row } from './table';

export type Route = Row & { engine: EngineId };

const ENGINES: Record<EngineId, Engine> = {
  image: imageEngine,
  media: mediaEngine,
  document: documentEngine,
  pdf: pdfEngine,
  data: dataEngine,
};

export const ROUTES = TABLE as Partial<Record<FormatId, Route>>;

export const engineOf = (route: Route): Engine => ENGINES[route.engine];
export const engineFor = (route: Route, target: FormatId): Engine => ENGINES[engineIdFor(route, target)];

/**
 * The table's targets, in order, minus anything the engine can't produce here.
 * An inspection narrows that to what this particular file can become.
 */
export function offeredTargets(route: Route, input: FormatId, inspection?: Inspection): FormatId[] {
  return route.targets.filter((target) =>
    engineFor(route, target).targets(input).includes(target)
    && (!inspection || inspection.targets.includes(target)));
}
