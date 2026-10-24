/** The package.json contributions parse, point at files that exist, and match the spec. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const c = pkg.contributes;
const exists = (rel: string): boolean => fs.existsSync(path.join(root, rel));

describe('package.json contributions', () => {
  it('activates on cpcbuild.json', () => {
    expect(pkg.activationEvents).toContain('workspaceContains:**/cpcbuild.json');
  });
  it('has the spec 7.1 commands (and none under .emu.)', () => {
    const ids: string[] = c.commands.map((x: { command: string }) => x.command);
    for (const want of ['newProject', 'newSprite', 'newTileset', 'newPalette', 'newPlusSprite', 'importImage', 'copyImporterCommand', 'regenerateAssets', 'generateAssetFile', 'insertAssetUse', 'build', 'buildAndRun', 'run', 'selectTarget', 'selectEmulator', 'selectModel', 'runFile', 'showBuildReport', 'tmx.generate', 'openInTiled', 'music.convert', 'music.play', 'music.stop', 'music.openTracker', 'symbols.refresh', 'symbols.filter', 'symbols.toggleRuntime', 'memory.show', 'debug.pause', 'debug.resume', 'debug.step', 'debug.stepOver', 'debug.stepOut', 'debug.toggleBreakpoint', 'debug.showRegisters', 'lint.toggle', 'docs.open', 'checkEnvironment', 'openSettings']) {
      expect(ids).toContain('cpcbuild.' + want);
    }
    expect(ids.filter((i) => i.includes('.emu.'))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('contributes the CPC Game Studio view container with the symbols, registers and breakpoints views', () => {
    expect(c.viewsContainers.activitybar.map((v: { id: string }) => v.id)).toContain('cpcbuild');
    expect(c.views.cpcbuild.map((v: { id: string }) => v.id)).toEqual(['cpcbuild.symbols', 'cpcbuild.registers', 'cpcbuild.breakpoints']);
    const ids: string[] = c.commands.map((x: { command: string }) => x.command);
    // every command a menu offers exists, and the watch commands are not contributed (deferred)
    for (const group of Object.values(c.menus) as { command: string }[][]) for (const m of group) expect(ids).toContain(m.command);
    expect(ids).not.toContain('cpcbuild.watch.add');
  });
  it('has every setting of spec 6 under cpcbuild.', () => {
    const keys = Object.keys(c.configuration.properties);
    for (const k of ['zxbc.command', 'zxbc.cwd', 'zxbc.args', 'python.path', 'library.path', 'build.org', 'build.outputDir', 'build.memoryLimits', 'target.default', 'model', 'run.emulator', 'run.caprice32Path', 'run.cpcecPath', 'run.rvmPath', 'run.customCommand', 'run.autorunCommand', 'assets.engine', 'assets.generateOnSave', 'assets.regenerateBeforeBuild', 'assets.header', 'editor.defaultZoom', 'editor.showByteGrid', 'editor.pixelAspect', 'lint.enable', 'lint.rules', 'hover.enable', 'arkos.toolsPath', 'arkos.trackerPath', 'arkos.psg', 'tiled.path', 'emu.pollRateHz', 'keybindings.enable']) {
      expect(keys).toContain('cpcbuild.' + k);
    }
    expect(c.configuration.properties['cpcbuild.zxbc.command'].default).toEqual(['zxbc']);
    expect(c.configuration.properties['cpcbuild.run.emulator'].default).toBe('emu');
  });
  it('the $zxbc matcher matches real zxbc output (spec 4.6)', () => {
    const m = c.problemMatchers.find((x: { name: string }) => x.name === 'zxbc');
    const re = new RegExp(m.pattern.regexp);
    const w = re.exec("bad.bas:3: warning: [W100] Using default implicit type 'float' for 'b'")!;
    expect([w[1], w[2], w[3], w[4], w[5]]).toEqual(['bad.bas', '3', 'warning', 'W100', "Using default implicit type 'float' for 'b'"]);
    const e = re.exec('/p/x/bad.bas:5: error: Unexpected end of line')!;
    expect([e[1], e[2], e[3], e[4], e[5]]).toEqual(['/p/x/bad.bas', '5', 'error', undefined, 'Unexpected end of line']);
    // Windows: a drive-letter colon and backslashes in the path
    const wl = re.exec("C:\\Users\\runner\\ws\\broken\\src\\main.bas:3: error: [E123] Unexpected end of line")!;
    expect([wl[1], wl[2], wl[3], wl[4], wl[5]]).toEqual(['C:\\Users\\runner\\ws\\broken\\src\\main.bas', '3', 'error', 'E123', 'Unexpected end of line']);
    expect(re.exec('D:/a/x/bad.bas:7: warning: w')?.[1]).toBe('D:/a/x/bad.bas');
    expect(re.test('Build failed: something')).toBe(false);
    expect(m.pattern).toMatchObject({ file: 1, line: 2, severity: 3, code: 4, message: 5 });
  });
  it('declares the cpcbuild task type and the schema', () => {
    expect(c.taskDefinitions[0].type).toBe('cpcbuild');
    expect(c.jsonValidation[0]).toMatchObject({ fileMatch: 'cpcbuild.json' });
    expect(exists(c.jsonValidation[0].url)).toBe(true);
    const schema = JSON.parse(fs.readFileSync(path.join(root, c.jsonValidation[0].url), 'utf8'));
    expect(schema.required).toEqual(['version', 'name', 'targets']);
  });
  it('language icons and the icon theme point at existing SVGs', () => {
    const ids = c.languages.map((l: { id: string }) => l.id);
    // .dsk/.cdt/.cpr belong to other Amstrad extensions: Studio gives them icons through the theme only, no language claim
    for (const id of ['cpcbuild-dsk', 'cpcbuild-cdt', 'cpcbuild-cpr']) expect(ids).not.toContain(id);
    for (const l of c.languages) for (const e of l.extensions) expect(['.dsk', '.cdt', '.cpr']).not.toContain(e);
    for (const l of c.languages) {
      expect(l.extensions.length).toBeGreaterThan(0);
      expect(exists(l.icon.light)).toBe(true);
      expect(exists(l.icon.dark)).toBe(true);
    }
    const theme = JSON.parse(fs.readFileSync(path.join(root, c.iconThemes[0].path), 'utf8'));
    for (const d of Object.values(theme.iconDefinitions) as { iconPath: string }[]) {
      expect(fs.existsSync(path.join(root, 'media', d.iconPath))).toBe(true);
    }
    for (const ext of ['dsk', 'cdt', 'cpr', 'cpcspr', 'cpctil', 'cpcpal', 'cpcpal12', 'cpcimp']) expect(theme.fileExtensions[ext]).toBeTruthy();
  });
  it('the icons are our own plain SVGs', () => {
    for (const f of fs.readdirSync(path.join(root, 'media', 'icons'))) {
      const t = fs.readFileSync(path.join(root, 'media', 'icons', f), 'utf8');
      expect(t.startsWith('<svg')).toBe(true);
      expect(t).not.toMatch(/<script|<image|href=/);
    }
  });

  it('limits itself in untrusted workspaces: every setting that names a program or path is restricted', () => {
    const u = pkg.capabilities.untrustedWorkspaces;
    expect(u.supported).toBe('limited');
    expect(u.description).toBeTruthy();
    const keys = Object.keys(c.configuration.properties);
    const restricted: string[] = u.restrictedConfigurations;
    for (const k of restricted) expect(keys).toContain(k);
    const namesProgramOrPath = keys.filter((k) => /(command|cwd|path|args|outputDir|engine)$/i.test(k));
    expect(namesProgramOrPath.length).toBeGreaterThan(8);
    for (const k of namesProgramOrPath) expect(restricted, k).toContain(k);
  });
  it('explorer and editor-title menus only show inside a CPCBuild project', () => {
    for (const m of [...c.menus['explorer/context'], ...c.menus['editor/title']]) expect(m.when, m.command).toMatch(/^cpcbuild\.inProject && /);
  });
});
