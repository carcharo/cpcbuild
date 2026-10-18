/** dskRun.ts -- what to type for a .dsk chosen in the Explorer. No vscode import (unit-testable). */
import * as path from 'node:path';
import { chooseRunnable, readDskCatalogue, RunChoice } from '../core/dsk';
import type { Target } from '../core/project';
import { absFrom } from './toolpaths';

/** The target of a project whose build output is `file` (<root>/<outputDir>/<id>.dsk), if any. */
export function targetForDsk(root: string, outputDir: string, targets: readonly Target[], file: string): Target | undefined {
  const dir = absFrom(root, outputDir);
  const f = path.resolve(file);
  return targets.find((t) => t.package === 'dsk' && path.resolve(dir, `${t.id}.dsk`) === f);
}

/** What to run from the disc's own catalogue; 'unreadable' when the file is not a CPC disc image. */
export function runFromCatalogue(img: Uint8Array): RunChoice | { kind: 'unreadable' } {
  const files = readDskCatalogue(img);
  return files ? chooseRunnable(files) : { kind: 'unreadable' };
}
