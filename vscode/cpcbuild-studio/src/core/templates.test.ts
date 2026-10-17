import { describe, expect, it } from 'vitest';
import { parseProject } from './project';
import { generateTemplate, TEMPLATES } from './templates';

describe('templates', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s: a valid project with its sources', (id) => {
    const r = generateTemplate(id, { name: 'My Game!' });
    expect(r.disc).toBe('MYGAME');
    const p = parseProject(r.files['cpcbuild.json']);
    expect(p.errors).toEqual([]);
    for (const t of p.project!.targets) expect(r.files[t.main]).toBeDefined();
    expect(r.files['.gitignore']).toBe('build/\n');
    expect(r.files['README.md']).toContain('Three things to try');
    expect(Object.keys(r.files).some((f) => f.startsWith('assets/'))).toBe(true);
    // no project-internal jargon or stale promises in what the user receives
    for (const [f, text] of Object.entries(r.files)) {
      expect(text, f).not.toMatch(/later versions|\bPhase \d/);
    }
  });
  it('firmware template points at the Sprite Editor', () => {
    expect(generateTemplate('firmware', { name: 'x' }).files['src/main.bas'] ?? '').toContain('CPCBuild Sprite Editor');
  });
  it('plus has a cartridge and a disc; shared has both machines', () => {
    const plus = parseProject(generateTemplate('plus', { name: 'x' }).files['cpcbuild.json']).project!;
    expect(plus.targets.map((t) => t.package)).toEqual(['cpr', 'dsk']);
    const sh = parseProject(generateTemplate('shared', { name: 'x' }).files['cpcbuild.json']).project!;
    expect(sh.targets.map((t) => t.arch)).toEqual(['cpc', 'cpc', 'zx48k', 'zx48k']);
  });
  it('non-ASCII names give PROG', () => {
    expect(generateTemplate('firmware', { name: '名前' }).disc).toBe('PROG');
  });
});
