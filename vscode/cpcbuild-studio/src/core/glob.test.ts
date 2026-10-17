import { describe, expect, it } from 'vitest';
import { globBase, matchesAny } from './glob';

describe('glob', () => {
  it('matches the cpcbuild.json forms', () => {
    expect(matchesAny(['assets/**/*.cpcimp'], 'assets/hero.cpcimp')).toBe(true);
    expect(matchesAny(['assets/**/*.cpcimp'], 'assets/a/b/hero.cpcimp')).toBe(true);
    expect(matchesAny(['assets/**/*.cpcimp'], 'src/hero.cpcimp')).toBe(false);
    expect(matchesAny(['assets/*.cpcimp'], 'assets/a/hero.cpcimp')).toBe(false);
    expect(matchesAny(['**/*.cpcimp'], 'x.cpcimp')).toBe(true);
    expect(matchesAny(['art/h?ro.cpcimp'], 'art/hero.cpcimp')).toBe(true);
    expect(matchesAny(['./a.b/*.x'], 'a.b/c.x')).toBe(true);
    expect(matchesAny(['a.b/*.x'], 'aXb/c.x')).toBe(false);
  });
  it('finds the literal base', () => {
    expect(globBase('assets/**/*.cpcimp')).toBe('assets');
    expect(globBase('**/*.cpcimp')).toBe('');
    expect(globBase('a/b/c.cpcimp')).toBe('a/b');
  });
});
