import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

describe('emu API contract copy', () => {
  it('carries the SPDX line for a contract shared by an MIT and a GPL package', () => {
    expect(fs.readFileSync(path.join(__dirname, 'emuApi.ts'), 'utf8').split('\n')[0]).toBe(
      '// SPDX-License-Identifier: MIT OR GPL-3.0-or-later -- interface contract shared by cpcbuild-studio and cpcbuild-emu',
    );
  });
  it('src/emuApi.ts is identical to cpcbuild-studio/src/emuApi.ts', () => {
    const mine = fs.readFileSync(path.join(__dirname, 'emuApi.ts'), 'utf8');
    const studio = path.join(__dirname, '..', '..', 'cpcbuild-studio', 'src', 'emuApi.ts');
    if (!fs.existsSync(studio)) return; // the studio package is not part of this checkout (e.g. the source archive)
    expect(mine).toBe(fs.readFileSync(studio, 'utf8'));
  });
});

describe('activation and trust', () => {
  const registered = [...fs.readFileSync(path.join(__dirname, 'ext', 'extension.ts'), 'utf8').matchAll(/reg\('(cpcbuild\.emu\.[A-Za-z]+)'/g)].map((m) => m[1]);
  it('activates on its commands, not at startup, and on every public command', () => {
    expect(pkg.activationEvents).not.toContain('onStartupFinished');
    expect(registered.length).toBeGreaterThan(10);
    for (const c of registered) expect(pkg.activationEvents, c).toContain(`onCommand:${c}`);
  });
  it('declares itself safe in untrusted workspaces (it spawns nothing and runs only the files it is given)', () => {
    expect(pkg.capabilities.untrustedWorkspaces.supported).toBe(true);
  });
});
