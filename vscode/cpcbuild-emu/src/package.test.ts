import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('emu API contract copy', () => {
  it('src/emuApi.ts is identical to cpcbuild-studio/src/emuApi.ts', () => {
    const mine = fs.readFileSync(path.join(__dirname, 'emuApi.ts'), 'utf8');
    const studio = path.join(__dirname, '..', '..', 'cpcbuild-studio', 'src', 'emuApi.ts');
    if (!fs.existsSync(studio)) return; // the studio package is not part of this checkout (e.g. the source archive)
    expect(mine).toBe(fs.readFileSync(studio, 'utf8'));
  });
});
