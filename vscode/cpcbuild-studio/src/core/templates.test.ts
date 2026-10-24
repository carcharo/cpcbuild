import { describe, expect, it } from 'vitest';
import { parseProject } from './project';
import { generateTemplate, TEMPLATES } from './templates';
import { parseSprite, resolvePalette } from './spriteDoc';
import { exportAsset } from './spriteExport';

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
    expect(generateTemplate('firmware', { name: 'x' }).files['src/main.bas'] ?? '').toContain('CPC Sprite Editor');
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

describe('template assets are used by the program', () => {
  it.each(['firmware', 'baremetal'] as const)('%s: main.bas includes the generated ball and uses its palette', (id) => {
    const r = generateTemplate(id, { name: 'x' });
    const main = r.files['src/main.bas'];
    expect(main).toContain('#include "../assets/ball.bas"');
    expect(main).toContain('SetPalette(@ball_pal(0), ball_PENS)');
    expect(main).toContain('@ball(0)');
    expect(main).not.toMatch(/DIM (ball|pal)\(/);
    const spr = parseSprite(r.files['assets/ball.cpcspr'], 'spr', 'ball');
    expect(spr.emitPalette).toBe(true);
    expect(spr.output).toBe('ball.bas');
    const pal = resolvePalette(spr, r.files['assets/pens.cpcpal']);
    expect(pal.pens).toEqual([0, 26, 6, 18]);
    expect(r.files['assets/ball.bas']).toBe(exportAsset(spr, { source: 'ball.cpcspr', palette: pal }).text);
    expect(r.files['assets/ball.bas']).toContain('ball_pal');
  });
  it('plus: main.bas includes the generated sprite, whose text is the exporter output', () => {
    const r = generateTemplate('plus', { name: 'x' });
    expect(r.files['src/main.bas']).toContain('#include "../assets/sprite.bas"');
    expect(r.files['src/main.bas']).toContain('SpritePalette(@sprite_pal(0))');
    const spr = parseSprite(r.files['assets/sprite.cpcspr'], 'spr', 'sprite');
    const pal = resolvePalette(spr, r.files['assets/colours.cpcpal12']);
    expect(r.files['assets/sprite.bas']).toBe(exportAsset(spr, { source: 'sprite.cpcspr', palette: pal }).text);
  });
});

describe('template asset globs', () => {
  it('every template lists globs that Regenerate Assets can find (recipe or palette files)', () => {
    for (const { id } of TEMPLATES) {
      const r = generateTemplate(id, { name: 'demo' });
      const cfg = JSON.parse(r.files['cpcbuild.json']);
      for (const g of cfg.assets) expect(g).toMatch(/\.(cpcimp|cpcspr|cpcpal|cpcpal12)$/);
    }
  });
});
