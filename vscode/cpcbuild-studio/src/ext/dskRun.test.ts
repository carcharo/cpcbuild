import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Target } from '../core/project';
import { discPickItems, discPickTitle, runFromCatalogue, targetForDsk } from './dskRun';

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

describe('the "which program" pick', () => {
  it('each item says what is typed at the BASIC prompt', () => {
    expect(discPickItems(['PLUS.BIN', 'STARPLUS.BIN'])).toEqual([
      { label: 'PLUS.BIN', description: 'RUN"PLUS.BIN' },
      { label: 'STARPLUS.BIN', description: 'RUN"STARPLUS.BIN' },
    ]);
  });
  it('the title names the machine the disc starts on and the setting that changes it', () => {
    expect(discPickTitle('6128')).toBe('CPC Game Studio: which program to run? (starts on a CPC 6128; change with "cpcbuild.model")');
    expect(discPickTitle('plus')).toContain('starts on a CPC 6128 Plus;');
  });
});
