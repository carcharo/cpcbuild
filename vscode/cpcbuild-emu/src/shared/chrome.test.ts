import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { fitSize, leaveKeys, leaveKeyText, runLabel } from './chrome';

describe('leave-keyboard keycaps', () => {
  it('differ per platform', () => {
    expect(leaveKeys('darwin')).toEqual(['Ctrl', 'Shift', 'Esc']);
    expect(leaveKeys('linux')).toEqual(['Ctrl', 'Shift', 'Esc']);
    expect(leaveKeys('win32')).toEqual(['Ctrl', 'Shift', 'F6']);
    expect(leaveKeyText('win32')).toBe('Ctrl+Shift+F6');
  });
});

describe('run-state chip', () => {
  it('says the state in text', () => {
    expect(runLabel(undefined)).toEqual({ text: 'No program loaded', tone: 'none' });
    expect(runLabel({ paused: false, suspended: false, pc: 0, program: 'game.dsk' })).toEqual({ text: 'Running · game.dsk', tone: 'ok' });
    expect(runLabel({ paused: false, suspended: false, pc: 0 }).text).toBe('Running');
    expect(runLabel({ paused: true, suspended: false, pc: 0x4f2a, program: 'a.dsk' })).toEqual({ text: 'Paused at &4F2A', tone: 'warn' });
    expect(runLabel({ paused: false, suspended: true, pc: 0 }).text).toBe('Suspended');
  });
});

describe('fitSize', () => {
  it('uses integer scale when it wastes little, else fills', () => {
    expect(fitSize(1536, 1072, 768, 536)).toEqual({ width: 1536, height: 1072 });
    expect(fitSize(1700, 1200, 768, 536)).toEqual({ width: 1536, height: 1072 }); // 2.2 -> 2 (91%)
    expect(fitSize(1000, 700, 768, 536)).toEqual({ width: 1000, height: 697 }); // 1.3 -> 1 (77%): fills
    expect(fitSize(400, 300, 768, 536)).toEqual({ width: 400, height: 279 });
    expect(fitSize(0, 300, 768, 536)).toBeUndefined();
  });
  it('the frame chrome is taken off before scaling', () => {
    // 1536 wide stage minus 2 x (8 padding + 1 border) = 1518: no longer a clean 2x
    const s = fitSize(1536 - 18, 1072 - 18, 768, 536)!;
    expect(s.width).toBeLessThanOrEqual(1518);
    expect(s.width).toBe(Math.floor(768 * Math.min(1518 / 768, 1054 / 536)));
  });
});

describe('pod.css', () => {
  const rules = (css: string): string[] => {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) { out.push(css.slice(start, i + 1).replace(/\s+/g, ' ').trim()); start = i + 1; }
    }
    return out;
  };
  const decls = (rule: string): string[] => rule.slice(rule.indexOf('{') + 1, -1).split(';').map((d) => d.trim()).filter(Boolean);
  const here = fs.readFileSync(path.join(__dirname, '../webview/pod.css'), 'utf8');
  const studio = fs.readFileSync(path.join(__dirname, '../../../cpcbuild-studio/src/webview/shared/cb.css'), 'utf8');
  const theirs = rules(studio);

  it('starts with the licence header', () => {
    expect(here.startsWith('/* SPDX-License-Identifier: MIT')).toBe(true);
  });
  it('every rule exists verbatim in the Studio cb.css (:root: every declaration)', () => {
    const root = new Set(theirs.filter((r) => r.startsWith(':root')).flatMap(decls));
    const mine = rules(here);
    expect(mine.length).toBeGreaterThan(10);
    for (const r of mine) {
      if (r.startsWith(':root')) { for (const d of decls(r)) expect(root.has(d), d).toBe(true); }
      else expect(theirs.includes(r), r.slice(0, 80)).toBe(true);
    }
  });
});
