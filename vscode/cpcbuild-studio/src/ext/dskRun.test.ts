import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Target } from '../core/project';
import { runFromCatalogue, targetForDsk } from './dskRun';

const t = (id: string, disc: string, pkg = 'dsk'): Target => ({ id, disc, package: pkg }) as unknown as Target;
const root = path.join(path.sep, 'p', 'lamp');

describe('targetForDsk', () => {
  const targets = [t('lamp6128', 'LAMPLIGH'), t('tape', 'X', 'tap')];
  it('maps build/<id>.dsk back to its target (disc name from cpcbuild.json)', () => {
    expect(targetForDsk(root, 'build', targets, path.join(root, 'build', 'lamp6128.dsk'))?.disc).toBe('LAMPLIGH');
  });
  it('honours an absolute or relative output folder', () => {
    expect(targetForDsk(root, 'out/bin', targets, path.join(root, 'out', 'bin', 'lamp6128.dsk'))?.id).toBe('lamp6128');
  });
  it('ignores other files and non-disc targets', () => {
    expect(targetForDsk(root, 'build', targets, path.join(root, 'other.dsk'))).toBeUndefined();
    expect(targetForDsk(root, 'build', targets, path.join(root, 'build', 'tape.dsk'))).toBeUndefined();
  });
});

describe('runFromCatalogue', () => {
  it('flags a file that is not a disc image', () => {
    expect(runFromCatalogue(new Uint8Array(10))).toEqual({ kind: 'unreadable' });
  });
});
