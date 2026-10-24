/** Arkos conversion: argument construction, and the output against the repo's own script on Starfall's songs. */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, scratchDir } from '../core/testutil';
import { aksArgv, arkosToolPath, checkMusicOptions, convertMusic, defaultMusicOutput, findArkosTools, previewProgram, type MusicConvertOptions, songLabelOf, songName } from './arkos';

/** The Arkos tools: $AT3_TOOLS, this checkout's, or the main checkout's (a worktree has no tools/arkos/work). */
const TOOLS = [process.env.AT3_TOOLS, path.join(REPO, 'tools/arkos/work/bin'), path.resolve(REPO, '../../tools/arkos/work/bin')].find(
  (d) => d && fs.existsSync(path.join(d, 'SongToAkg')) && fs.existsSync(path.join(d, 'SongToSoundEffects')),
);
const have = TOOLS ? it : it.skip;
const dir = scratchDir('arkos-');
const A = 'games/shooter/assets';
// the project root of the conversions: the inputs mirrored from the repo (paths stay inside it), outputs under out/
fs.mkdirSync(path.join(dir, A), { recursive: true });
fs.cpSync(path.join(REPO, A), path.join(dir, A), { recursive: true });
const O = (n: string): string => path.join(dir, 'out', n);
const S = { pythonPath: 'python3', library: REPO, toolsDir: TOOLS };
const SE = (engine: 'builtin' | 'python') => ({ ...S, engine });

/** The script run the way build_assets.sh runs it (from the repo root, AT3_TOOLS set). */
function script(args: string[]): void {
  const r = spawnSync('python3', ['tools/aks2bas.py', ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, AT3_TOOLS: TOOLS }, timeout: 120000 });
  expect(r.status, r.stderr).toBe(0);
}
const same = (a: string, b: string): void => expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(true);

describe('argument construction', () => {
  it('matches the documented forms', () => {
    expect(aksArgv('a/tune.aks', 'a/tune.bas', {})).toEqual(['a/tune.aks', 'a/tune.bas', '--name', 'tune']);
    expect(aksArgv('tune.aks', 'tune.bas', { name: 'tune', subsongs: '1, 3' })).toEqual(['tune.aks', 'tune.bas', '--name', 'tune', '--subsongs', '1,3']);
    expect(aksArgv('fx.aks', 'fx.bas', { sfx: true, name: 'fx', psg: 'spectrum' })).toEqual(['--sfx', 'fx.aks', 'fx.bas', '--name', 'fx', '--psg', 'spectrum']);
    expect(aksArgv('t.aks', '/dev/null', { name: 'sf_title', at: '0x4000', bin: 'out.bin' })).toEqual(['t.aks', '/dev/null', '--name', 'sf_title', '--at', '0x4000', '--bin', 'out.bin']);
  });
  it('names and outputs', () => {
    expect(songName('my tune-1.aks')).toBe('my_tune_1');
    expect(songName('1up.vt2')).toBe('song_1up');
    expect(defaultMusicOutput('a/b.vt2')).toBe('a/b.bas');
  });
  it('rejects combinations the tool does', () => {
    expect(checkMusicOptions({ sfx: true, at: '0x4000' })).toMatch(/--at is for songs/);
    expect(checkMusicOptions({ bin: 'x.bin' })).toMatch(/--bin goes with --at/);
    expect(checkMusicOptions({ at: 'zzz' })).toMatch(/address/);
    expect(checkMusicOptions({ subsongs: '1;2' })).toMatch(/numbers separated by commas/);
    expect(checkMusicOptions({ name: '9x' })).toMatch(/not a usable name/);
    expect(checkMusicOptions({ name: 'ok', subsongs: '1,2', at: '0x4000', bin: 'o.bin' })).toBeUndefined();
  });
  it('reads the label of a converted include', () => {
    expect(songLabelOf(fs.readFileSync(path.join(REPO, A, 'title.bas'), 'utf8'))).toBe('sf_title');
    expect(songLabelOf(fs.readFileSync(path.join(REPO, A, 'sfx.bas'), 'utf8'))).toBe('sf_sfx');
    expect(songLabelOf('PRINT 1')).toBeUndefined();
  });
  it('the preview program uses the real player', () => {
    const p = previewProgram({ kind: 'song', name: 'sf_title', subsong: 1, effect: 1 }, 'sf_title.bas');
    expect(p).toContain('#include <music/music.bas>');
    expect(p).toContain('#include "sf_title.bas"');
    expect(p).toContain('MusicInit(@sf_title, 1)');
    expect(p).toContain('KEY_ESC');
    const f = previewProgram({ kind: 'sfx', name: 'fx', subsong: 0, effect: 3 }, 'fx.bas');
    expect(f).toContain('SfxInit(@fx)');
    expect(f).toContain('SfxPlay(3, 0, 0)');
  });
});

describe('finding the tools', () => {
  it('uses the setting first, then $AT3_TOOLS, then the library', () => {
    if (!TOOLS) return;
    expect(findArkosTools({ setting: TOOLS })).toBe(TOOLS);
    expect(findArkosTools({ env: TOOLS })).toBe(TOOLS);
    expect(findArkosTools({ setting: path.join(dir, 'none'), env: TOOLS })).toBe(TOOLS);
    expect(findArkosTools({ setting: path.join(dir, 'none') })).toBeUndefined();
  });
  it('says how to get them when missing', async () => {
    const r = await convertMusic(dir, `${A}/title.vt2`, { output: 'out/x.bas' }, { pythonPath: 'python3', library: REPO });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sh tools\/arkos\/fetch\.sh/);
  });
});

describe('convertMusic keeps its paths inside the project', () => {
  it('refuses ../, absolute and symlink-escaping input, output and --bin', async () => {
    const outside = scratchDir('arkos-outside-');
    fs.symlinkSync(outside, path.join(dir, 'escape'));
    const cases = [
      ['../song.aks', {}],
      [`${A}/title.vt2`, { output: '../evil.bas' }],
      [`${A}/title.vt2`, { output: path.join(outside, 'abs.bas') }],
      [`${A}/title.vt2`, { output: 'escape/evil.bas' }],
      [`${A}/title.vt2`, { at: '0x4000', bin: '../evil.bin' }],
    ] as const;
    for (const [input, o] of cases) {
      const r = await convertMusic(dir, input, { ...o }, { pythonPath: 'python3', library: REPO, toolsDir: dir });
      expect(r.ok, input + JSON.stringify(o)).toBe(false);
      expect(r.error).toMatch(/outside the project folder|absolute path|symbolic link/);
    }
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(path.join(dir, 'escape'));
  });
});

for (const engine of ['builtin', 'python'] as const) describe(`convertMusic (${engine} engine) output is the repo script's, on Starfall's songs`, () => {
  have('a song: title.vt2 == the committed title.bas == the script run directly', async () => {
    const out = O('title.bas');
    const r = await convertMusic(dir, `${A}/title.vt2`, { name: 'sf_title', output: path.relative(dir, out) }, SE(engine));
    expect(r.ok, r.error).toBe(true);
    const direct = O('title-direct.bas');
    script([`${A}/title.vt2`, direct, '--name', 'sf_title']);
    same(out, direct);
    same(out, path.join(REPO, A, 'title.bas'));
  });
  have('the game song', async () => {
    const out = O('gamesong.bas');
    const r = await convertMusic(dir, `${A}/game.vt2`, { name: 'sf_game', output: path.relative(dir, out) }, SE(engine));
    expect(r.ok, r.error).toBe(true);
    same(out, path.join(REPO, A, 'gamesong.bas'));
  });
  have('an effects bank: sfx.vt2 --sfx == the committed sfx.bas', async () => {
    const out = O('sfx.bas');
    const r = await convertMusic(dir, `${A}/sfx.vt2`, { name: 'sf_sfx', sfx: true, output: path.relative(dir, out) }, SE(engine));
    expect(r.ok, r.error).toBe(true);
    same(out, path.join(REPO, A, 'sfx.bas'));
  });
  have('--psg needs an .aks (the tool rewrites the song\'s clock): the tool\'s message comes through for a .vt2', async () => {
    const r = await convertMusic(dir, `${A}/zx/sfx_zx.vt2`, { name: 'sf_sfx', sfx: true, psg: 'spectrum', output: 'out/sfx_zx.bas' }, SE(engine));
    const direct = spawnSync('python3', ['tools/aks2bas.py', '--sfx', `${A}/zx/sfx_zx.vt2`, path.join(dir, 'out', 'd.bas'), '--name', 'sf_sfx', '--psg', 'spectrum'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, AT3_TOOLS: TOOLS } });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(direct.stderr.trim().split('\n').pop());
  });
  have('a 6128 bank song: --at 0x4000 --bin == the committed title_bank.bin', async () => {
    const bin = O('title_bank.bin');
    const r = await convertMusic(dir, `${A}/title.vt2`, { name: 'sf_title', at: '0x4000', bin: 'out/title_bank.bin', output: 'out/bank.bas' }, SE(engine));
    expect(r.ok, r.error).toBe(true);
    same(bin, path.join(REPO, A, 'title_bank.bin'));
  });
  have('a subsong selection reaches the tool', async () => {
    const out = O('sub.bas');
    const r = await convertMusic(dir, `${A}/title.vt2`, { name: 'sf_title', subsongs: '1', output: path.relative(dir, out) }, SE(engine));
    expect(r.ok, r.error).toBe(true);
    const direct = O('sub-direct.bas');
    script([`${A}/title.vt2`, direct, '--name', 'sf_title', '--subsongs', '1']);
    same(out, direct);
  });
  have('a missing song and a tool failure are reported', async () => {
    expect((await convertMusic(dir, 'nope.aks', {}, SE(engine))).error).toBe('nope.aks: not found');
    fs.writeFileSync(path.join(dir, 'bad.aks'), 'not a song');
    const r = await convertMusic(dir, 'bad.aks', { output: 'out/bad.bas', name: 'bad' }, SE(engine));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe('the builtin engine needs no Python', () => {
  have('converts with a Python path that does not exist', async () => {
    const r = await convertMusic(dir, `${A}/title.vt2`, { name: 'sf_title', output: 'out/nopy.bas' }, { ...S, engine: 'builtin', pythonPath: path.join(dir, 'no-python'), library: undefined });
    expect(r.ok, r.error).toBe(true);
    same(O('nopy.bas'), path.join(REPO, A, 'title.bas'));
  });
  have('the full pipeline equals tools/aks2bas.py: song, subsongs, effects, bank image, option errors', async () => {
    const cases: Array<[string, MusicConvertOptions]> = [
      [`${A}/title.vt2`, { name: 'sf_title' }],
      [`${A}/title.vt2`, { name: 'sf_title', subsongs: '1' }],
      [`${A}/game.vt2`, { name: 'g_ame' }],
      [`${A}/sfx.vt2`, { name: 'sf_sfx', sfx: true }],
      [`${A}/title.vt2`, { name: 'sf_title', at: '0x5000', bin: 'out/pipe.bin' }],
    ];
    for (const [input, o] of cases) {
      const b = await convertMusic(dir, input, { ...o, output: 'out/pipe-b.bas', ...(o.bin ? { bin: 'out/pipe-b.bin' } : {}) }, SE('builtin'));
      const p = await convertMusic(dir, input, { ...o, output: 'out/pipe-p.bas', ...(o.bin ? { bin: 'out/pipe-p.bin' } : {}) }, SE('python'));
      expect(b.ok, `${b.error}`).toBe(true);
      expect(p.ok, `${p.error}`).toBe(true);
      // the header names the include's label, not the file, so the two outputs are comparable as they are
      same(O('pipe-b.bas'), O('pipe-p.bas'));
      if (o.bin) same(O('pipe-b.bin'), O('pipe-p.bin'));
    }
    for (const [input, o] of [[`${A}/title.vt2`, { at: '0x8000' }], [`${A}/title.vt2`, { at: '0x3000' }], [`${A}/title.vt2`, { at: '&4000' }]] as const) {
      const b = await convertMusic(dir, input, { ...o, name: 'x', output: 'out/e.bas' }, SE('builtin'));
      const p = await convertMusic(dir, input, { ...o, name: 'x', output: 'out/e.bas' }, SE('python'));
      expect(b.ok).toBe(false);
      expect(b.error, JSON.stringify(o)).toBe(p.error);
    }
  });
  have('a song that does not fit the bank window gives the tool\'s message', async () => {
    const b = await convertMusic(dir, `${A}/title.vt2`, { name: 'x', at: '0x7fff', output: 'out/e.bas' }, SE('builtin'));
    const p = await convertMusic(dir, `${A}/title.vt2`, { name: 'x', at: '0x7fff', output: 'out/e.bas' }, SE('python'));
    expect(b.error).toMatch(/doesn't fit between 0x7fff and 0x7FFF/);
    expect(b.error).toBe(p.error);
  });
});

describe('Arkos tool names on Windows', () => {
  it('accepts SongToAkg.exe and SongToSoundEffects.exe there, the bare names elsewhere', () => {
    const d = scratchDir('arkos-exe-');
    fs.writeFileSync(path.join(d, 'SongToAkg.exe'), '');
    fs.writeFileSync(path.join(d, 'SongToSoundEffects.exe'), '');
    const orig = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(findArkosTools({ setting: d })).toBe(d);
      expect(arkosToolPath(d, 'SongToAkg')).toBe(path.join(d, 'SongToAkg.exe'));
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(findArkosTools({ setting: d })).toBeUndefined();
    } finally {
      Object.defineProperty(process, 'platform', orig);
    }
  });
});
