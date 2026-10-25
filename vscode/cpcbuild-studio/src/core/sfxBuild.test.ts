import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { quietSongVt2, sfxBankName, sfxConstants, sfxConstName, sfxOutputs, sfxStale, sfxTargetsOf, sfxUseSnippet, SFX_GLOB, withSfxConstants, withSfxGlob } from './sfxBuild';
import { SfxDoc } from './sfxDoc';
import { newBank, presetEffect } from './sfxPresets';
import { toBoriel } from './aks2bas';

const repo = path.resolve(__dirname, '../../../..');
const two = (): SfxDoc => {
  const b = newBank();
  b.effects.push(presetEffect('coin', 'coin'));
  return b;
};

describe('sfxBuild: names', () => {
  it('the bank is the file stem as a BASIC label', () => {
    expect(sfxBankName('assets/sfx.cpcsfx')).toBe('sfx');
    expect(sfxBankName('a\\b\\my-fx.cpcsfx')).toBe('my_fx');
    expect(sfxBankName('assets/2fast.cpcsfx')).toBe('_2fast');
  });
  it('outputs go beside the bank: <stem> for the CPC, <stem>_zx for the Spectrum (as games/shooter)', () => {
    expect(sfxOutputs('assets/sfx.cpcsfx', ['cpc'])).toEqual([{ target: 'cpc', vt2: 'assets/sfx.vt2', bas: 'assets/sfx.bas' }]);
    expect(sfxOutputs('assets/sfx.cpcsfx', ['cpc', 'spectrum', 'cpc']).map((o) => o.bas)).toEqual(['assets/sfx.bas', 'assets/sfx_zx.bas']);
    expect(sfxOutputs('assets/sfx.cpcsfx', ['spectrum'])[0].vt2).toBe('assets/sfx_zx.vt2');
  });
  it('the targets come from the architectures of the project', () => {
    expect(sfxTargetsOf(['cpc', 'cpc'])).toEqual(['cpc']);
    expect(sfxTargetsOf(['cpc', 'zx48k'])).toEqual(['cpc', 'spectrum']);
    expect(sfxTargetsOf(['zx48k'])).toEqual(['spectrum']);
    expect(sfxTargetsOf([])).toEqual(['cpc']);
  });
});

describe('sfxBuild: stale decisions', () => {
  it('missing output, older output, newer or equal output', () => {
    expect(sfxStale(100, [])).toBe(true);
    expect(sfxStale(100, [-1])).toBe(true);
    expect(sfxStale(100, [200, -1])).toBe(true);
    expect(sfxStale(100, [50])).toBe(true);
    expect(sfxStale(100, [200, 50])).toBe(true);
    expect(sfxStale(100, [100])).toBe(false);
    expect(sfxStale(100, [200, 300])).toBe(false);
  });
});

describe('sfxBuild: constants', () => {
  it('one CONST per effect, upper case, numbered from 1', () => {
    expect(sfxConstName('sfx', 'blip')).toBe('SFX_BLIP');
    expect(sfxConstants(two(), 'sfx')).toEqual(['CONST SFX_BLIP AS UBYTE = 1', 'CONST SFX_COIN AS UBYTE = 2']);
  });
  it('they sit right after the guard of the include, and nothing else changes', () => {
    const bas = toBoriel('sfx_Effects:\n    db 1\n', 'sfx', '', 'sfx');
    const out = withSfxConstants(bas, two(), 'sfx');
    expect(out).toContain('#define __AKS_SFX__\n\n\' Effect numbers for SfxPlay');
    expect(out.indexOf('CONST SFX_COIN AS UBYTE = 2')).toBeLessThan(out.indexOf('asm'));
    expect(out.replace(/\n\n' Effect numbers[^\n]*\nCONST [^\n]*\nCONST [^\n]*/, '')).toBe(bas);
  });
  it('an include without a guard is refused', () => {
    expect(() => withSfxConstants('db 1\n', two(), 'sfx')).toThrow(/no #define guard/);
  });
});

describe('sfxBuild: Insert Asset Use', () => {
  it('has the includes, SfxInit and a SfxPlay of the first effect with the library.md 9.9 signatures', () => {
    expect(sfxUseSnippet(two(), 'sfx', 'sfx.bas')).toBe(
      "#include <music/music.bas>\n#include <music/quiet.bas>    ' an empty song, for a program with no music\n#include \"sfx.bas\"\n" +
        "MusicInit(@quiet, 0)    ' effects only advance while a song plays (or start your own song instead)\n" +
        'SfxInit(@sfx)\n' +
        "SfxPlay(SFX_BLIP, 2, 0)    ' effect, channel 0-2 (A, B, C), inverted volume 0 (full) to 16 (mute)\n",
    );
  });
});

describe('sfxBuild: the silent song', () => {
  it('is the bounce_quiet.vt2 of the examples (but for the title)', () => {
    const want = fs.readFileSync(path.join(repo, 'examples/assets/bounce_quiet.vt2'), 'utf8').replace('Title=bounce quiet', 'Title=quiet');
    expect(quietSongVt2()).toBe(want);
  });
});

describe('withSfxGlob', () => {
  it('adds the .cpcsfx glob when no asset glob matches the bank, keeping the rest', () => {
    const before = JSON.stringify({ version: 1, name: 'x', assets: ['assets/**/*.cpcspr'] }, null, 2) + '\n';
    expect(JSON.parse(withSfxGlob(before, 'assets/sfx.cpcsfx') as string).assets).toEqual(['assets/**/*.cpcspr', SFX_GLOB]);
    expect(JSON.parse(withSfxGlob('{"version":1}', 'assets/sfx.cpcsfx') as string).assets).toEqual([SFX_GLOB]);
  });
  it('changes nothing when a glob already matches, or the file is not a JSON object', () => {
    expect(withSfxGlob('{"assets":["assets/**/*.cpcsfx"]}', 'assets/sfx.cpcsfx')).toBeUndefined();
    expect(withSfxGlob('{"assets":["**/*"]}', 'assets/a/b.cpcsfx')).toBeUndefined();
    expect(withSfxGlob('not json', 'assets/sfx.cpcsfx')).toBeUndefined();
    expect(withSfxGlob('[1]', 'assets/sfx.cpcsfx')).toBeUndefined();
  });
});
