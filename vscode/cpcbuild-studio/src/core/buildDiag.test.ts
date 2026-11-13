import * as path from 'node:path';
import { compile } from '@cpcbuild/cpcbas';
import { describe, expect, it } from 'vitest';
import { buildDiagnostics, formatBuildDiagnostic } from './buildDiag';

describe('buildDiagnostics', () => {
  const root = path.resolve('/proj');
  const lib = path.resolve('/ext/bundled/lib');
  it('an error sits at its line and column, in the project file', () => {
    const r = compile({ files: new Map([['src/main.bas', 'PRINT 1\nPRINT 2 +\nPRINT 3\n']]), main: 'src/main.bas', options: { parseOnly: true } });
    expect(r.ok).toBe(false);
    const ds = buildDiagnostics(r, root, lib);
    const e = ds.find((d) => d.severity === 'error')!;
    expect(e.file).toBe(path.join(root, 'src', 'main.bas'));
    expect(e.line).toBe(2);
    expect(e.col).toBeGreaterThan(1);
    expect(e.origin).toBe('user');
    expect(e.code).toMatch(/^E\d{3}$/);
    expect(formatBuildDiagnostic(e, root)).toMatch(/^src\/main\.bas:2:\d+: error E\d{3}: /);
  });
  it('a file outside the project is shown with its full path', () => {
    const d = { file: path.resolve('/elsewhere/a.bas'), line: 1, col: 2, endLine: 1, endCol: 3, severity: 'warning' as const, code: 'W300', message: 'm', hint: 'h', origin: 'user' };
    expect(formatBuildDiagnostic(d, root)).toBe(`${path.resolve('/elsewhere/a.bas')}:1:2: warning W300: m\n  hint: h`);
  });
});
