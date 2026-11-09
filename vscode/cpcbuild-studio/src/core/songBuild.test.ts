import { describe, expect, it } from 'vitest';
import { SONG_GLOB, songBankName, songOutputs, withSongGlob } from './songBuild';

describe('songBuild', () => {
  it('names go beside the song', () => {
    expect(songOutputs('assets/tune.cpcsong')).toEqual({ vt2: 'assets/tune.vt2', bas: 'assets/tune.bas' });
    expect(songBankName('assets/title-tune.cpcsong')).toBe('title_tune');
    expect(songBankName('a\\b\\2fast.cpcsong')).toBe('_2fast');
  });
  it('the glob is added once, only when no glob covers the song', () => {
    const json = JSON.stringify({ version: 1, name: 'x', assets: ['assets/**/*.cpcimp'] });
    const next = withSongGlob(json, 'assets/tune.cpcsong');
    expect(JSON.parse(next as string).assets).toEqual(['assets/**/*.cpcimp', SONG_GLOB]);
    expect(withSongGlob(next as string, 'assets/tune.cpcsong')).toBeUndefined();
    expect(withSongGlob('not json', 'assets/tune.cpcsong')).toBeUndefined();
    expect(JSON.parse(withSongGlob('{}', 'assets/tune.cpcsong') as string).assets).toEqual([SONG_GLOB]);
  });
});
