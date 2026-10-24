import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findZxbasic, gitLsFiles, warnNoZxbasic } from './testutil';
import { loadIndex, stdlibDirOf } from './libfs';
import { BARE_ONLY, Finding, FIRMWARE_ONLY, lint, LintContext, literalValue, RuleId } from './lint';

const REPO = path.resolve(__dirname, '../../../..');
const ZXBASIC = findZxbasic(REPO);
warnNoZxbasic(ZXBASIC);
const d = ZXBASIC ? describe : describe.skip;
const index = loadIndex(REPO, (ZXBASIC ? stdlibDirOf(ZXBASIC) : undefined));

const run = (src: string, ctx: LintContext = {}): Finding[] => lint(src, { index, ...ctx });
const ids = (src: string, ctx?: LintContext): RuleId[] => run(src, ctx).map((f) => f.rule);
const src = (...lines: string[]): string => lines.join('\n') + '\n';

d('CB001 Mode without ScreenInit', () => {
  it('positive: drawing right after Mode', () => {
    const f = run(src('Mode 1', 'FillRect(0, 0, 4, 4, 1)'));
    expect(f.map((x) => x.rule)).toEqual(['CB001']);
    expect(f[0]).toMatchObject({ line: 0, col: 0, endCol: 4 });
  });
  it('positive: parenthesis form and mixed case', () => {
    expect(ids(src('mode(0)', 'putsprite 1, 2, 3, 4, 0'))).toEqual(['CB001']);
  });
  it('negative: ScreenInit in between, on the same line, or in another routine', () => {
    expect(ids(src('Mode 1', 'ScreenInit()', 'FillRect(0, 0, 4, 4, 1)'))).toEqual([]);
    expect(ids(src('Mode 1 : ScreenInit() : ClearScreen(0)'))).toEqual([]);
    expect(ids(src('Mode 1', 'SUB Draw()', 'PutSprite(0, 0, 1, 1, 0)', 'END SUB'))).toEqual([]);
  });
  it('negative: no drawing after the Mode, a comment or string naming the call, an asm block', () => {
    expect(ids(src('Mode 1', "' FillRect(0,0,1,1,1)", 'PRINT "FillRect(0,0,1,1,1)"', 'asm', ' call FillRect', 'end asm'))).toEqual([]);
  });
  it('negative: the program defines its own FillRect', () => {
    expect(ids(src('SUB FillRect(a AS UBYTE)', 'END SUB', 'Mode 1', 'FillRect(1)'))).toEqual([]);
  });
});

d('CB002 settings defined after the include', () => {
  it('positive: SPRLIST_MAX and TEXT_QUEUE', () => {
    const f = run(src('#include <cpcbuild.bas>', '#define SPRLIST_MAX 24', '#define TEXT_QUEUE 200'));
    expect(f.map((x) => x.rule)).toEqual(['CB002', 'CB002']);
    expect(f[0].message).toMatch(/Move this #define above the include/);
  });
  it('positive: the single-module include', () => {
    expect(ids(src('#include once <cpcbuild/spritelist.bas>', '#define SPRLIST_MAX 24'))).toEqual(['CB002']);
  });
  it('negative: defined first, or an unrelated module', () => {
    expect(ids(src('#define SPRLIST_MAX 24', '#include <cpcbuild.bas>'))).toEqual([]);
    expect(ids(src('#include <cpcbuild/fill.bas>', '#define SPRLIST_MAX 24'))).toEqual([]);
    expect(ids(src('#include <cpcbuild/spritelist.bas>', "' #define SPRLIST_MAX 24"))).toEqual([]);
  });
});

d('CB003 firmware-only / bare-only calls', () => {
  it('positive: firmware-only in a bare target', () => {
    const f = run(src('SoundQueue(1, 239, 50, 12, 0)', 'x = SoundFree(1)'), { arch: 'cpc', bare: true });
    expect(f.map((x) => x.rule)).toEqual(['CB003', 'CB003']);
  });
  it('positive: bare-only in a firmware target', () => {
    expect(ids(src('RasterIntAt(10, @h)'), { arch: 'cpc', bare: false })).toEqual(['CB003']);
  });
  it('negative: right target, unknown target, or inside #ifdef', () => {
    expect(ids(src('SoundQueue(1, 239, 50, 12, 0)'), { arch: 'cpc', bare: false })).toEqual([]);
    expect(ids(src('RasterIntAt(10, @h)'), { arch: 'cpc', bare: true })).toEqual([]);
    expect(ids(src('SoundQueue(1, 239, 50, 12, 0)'), {})).toEqual([]);
    expect(ids(src('#ifndef CPC_BAREMETAL', 'SoundQueue(1, 239, 50, 12, 0)', '#endif'), { arch: 'cpc', bare: true })).toEqual([]);
  });
  it('the rule lists match the index (derived from the refusal stubs)', () => {
    const fw = index.routines.filter((r) => r.restriction === 'firmware').map((r) => r.name).sort();
    const bare = index.routines.filter((r) => r.restriction === 'bare').map((r) => r.name).sort();
    expect([...FIRMWARE_ONLY].sort()).toEqual(fw);
    expect([...BARE_ONLY].sort()).toEqual(bare);
  });
});

d('CB004 12-bit palette before Mode', () => {
  it('positive', () => {
    const f = run(src('SetPalette12(0, &H0F00)', 'Mode 1'));
    expect(f.map((x) => x.rule)).toEqual(['CB004']);
    expect(f[0].line).toBe(1);
  });
  it('negative: set again after, bare target, or a user routine called after', () => {
    expect(ids(src('SetPalette12(0, &H0F00)', 'Mode 1', 'SetPalette12(0, &H0F00)'))).toEqual([]);
    expect(ids(src('SetBorder12(&H0F00)', 'Mode 1'), { arch: 'cpc', bare: true })).toEqual([]);
    expect(ids(src('SUB Pal()', 'END SUB', 'SetPalette12(0, &H0F00)', 'Mode 1', 'Pal()'))).toEqual([]);
    expect(ids(src('Mode 1', 'SetPalette12(0, &H0F00)'))).toEqual([]);
  });
});

d('CB005 Plus program ends without SpritesHideAll', () => {
  const head = '#include <cpcplus/cpcplus.bas>';
  it('positive', () => {
    const f = run(src(head, 'SpriteMove(0, 10, 10)', 'END'));
    expect(f.map((x) => x.rule)).toEqual(['CB005']);
    expect(f[0]).toMatchObject({ line: 2, col: 0, endCol: 3 });
  });
  it('negative: hidden, no sprites used, no Plus include, END IF is not END', () => {
    expect(ids(src(head, 'SpriteMove(0, 10, 10)', 'SpritesHideAll()', 'END'))).toEqual([]);
    expect(ids(src(head, 'SetPalette12(0, 1)', 'END'))).toEqual([]);
    expect(ids(src('SpriteMove(0, 10, 10)', 'END'))).toEqual([]);
    expect(ids(src(head, 'SpriteMove(0, 10, 10)', 'IF a THEN', 'b = 1', 'END IF'))).toEqual([]);
  });
});

d('CB006 AY owners mixed', () => {
  it('positive: AyWrite then MusicInit; Play with its include', () => {
    expect(ids(src('AyWrite 7, 62', 'MusicInit(@tune, 0)'))).toEqual(['CB006']);
    expect(ids(src('#include <play.bas>', 'Play "O4C"', 'AyWrite 7, 62'))).toEqual(['CB006']);
  });
  it('negative: one owner, or Play without the include (a user variable)', () => {
    expect(ids(src('AyWrite 7, 62', 'AyWrite 8, 15'))).toEqual([]);
    expect(ids(src('MusicInit(@tune, 0)', 'MusicStop()'))).toEqual([]);
    expect(ids(src('Play "O4C"', 'AyWrite 7, 62'))).toEqual([]);
  });
});

d('CB007 literal out of range', () => {
  it('positive: UBYTE 256, negative into UBYTE, UINTEGER 70000', () => {
    const f = run(src('FillRect(0, 0, 4, 4, 256)', 'KeyDown(-1)', 'SetTileSet(70000)'));
    expect(f.map((x) => x.rule)).toEqual(['CB007', 'CB007', 'CB007']);
    expect(f[0].message).toMatch(/outside UBYTE/);
  });
  it('positive: hex literals, SetInk pen/colour, SetBorder', () => {
    expect(ids(src('PokeScreen(1, 2, &H1FF)'))).toEqual(['CB007']);
    expect(ids(src('SetInk 16, 3'))).toEqual(['CB007']);
    expect(ids(src('SetInk(1, 40)', 'SetBorder 30'))).toEqual(['CB007', 'CB007']);
  });
  it('positive: a pen above the literal mode maximum', () => {
    expect(ids(src('Mode 1', 'ScreenInit()', 'FillRect(0, 0, 4, 4, 5)'))).toEqual(['CB007']);
    expect(ids(src('Mode 2', 'ScreenInit()', 'ClearScreen(2)'))).toEqual(['CB007']);
  });
  it('negative: in range, expressions, variables, unknown mode, other scope, INTEGER negatives', () => {
    expect(ids(src('FillRect(-5, 300, 4, 4, 255)'))).toEqual([]); // x, y are INTEGER
    expect(ids(src('FillRect(0, 0, 4, 4, n + 300)', 'KeyDown(k)'))).toEqual([]);
    expect(ids(src('Mode 0', 'ScreenInit()', 'FillRect(0, 0, 4, 4, 15)'))).toEqual([]);
    expect(ids(src('Mode n', 'ScreenInit()', 'FillRect(0, 0, 4, 4, 9)'))).toEqual([]);
    expect(ids(src('Mode 1', 'ScreenInit()', 'SUB D()', 'FillRect(0, 0, 4, 4, 9)', 'END SUB'))).toEqual([]);
    expect(ids(src('SetInk 15, 26', 'SetBorder 26'))).toEqual([]);
    expect(ids(src("PRINT \"FillRect(0,0,1,1,999)\" ' FillRect(0,0,1,1,999)"))).toEqual([]);
  });
  it('literalValue forms', () => {
    expect(['12', '-3', '0x1F', '$1F', '&H1F', '&1f', '%101', '1.5', 'a', '1+2'].map(literalValue)).toEqual([12, -3, 31, 31, 31, 31, 5, undefined, undefined, undefined]);
  });
});

d('CB008 Spectrum-only modules under a CPC target', () => {
  it('positive', () => {
    const f = run(src('#include <print42.bas>', '#include once <attr.bas>'), { arch: 'cpc' });
    expect(f.map((x) => x.rule)).toEqual(['CB008', 'CB008']);
    expect(f[0]).toMatchObject({ line: 0, col: 10 });
  });
  it('negative: other targets, unknown target, other modules, guarded by #ifdef, screen.bas (now implemented)', () => {
    expect(ids(src('#include <print42.bas>'), { arch: 'zx48k' })).toEqual([]);
    expect(ids(src('#include <print42.bas>'), {})).toEqual([]);
    expect(ids(src('#include <point.bas>', '#include <screen.bas>'), { arch: 'cpc' })).toEqual([]);
    expect(ids(src('#ifdef __ZX48K__', '#include <print64.bas>', '#endif'), { arch: 'cpc' })).toEqual([]);
  });
});

d('CB009 sprite sizes', () => {
  it('positive: 0, above 255, SprListDraw above 8', () => {
    const f = run(src('PutSprite(0, 0, 0, 8, @s)', 'PutSpriteMasked(0, 0, 4, 256, @s)', 'GetBlock(0, 0, 0, 1, @b)', 'SprListDraw(1, 2, 9, 8, @s)'));
    expect(f.map((x) => x.rule)).toEqual(['CB009', 'CB009', 'CB009', 'CB009']);
    expect(f[3].message).toMatch(/at most 8/);
  });
  it('negative: 1-255, SprListDraw 8, variables', () => {
    expect(ids(src('PutSprite(0, 0, 1, 255, @s)', 'SprListDraw(1, 2, 8, 255, @s)', 'PutSprite(0, 0, w, h, @s)'))).toEqual([]);
  });
});

d('CB011 #if defined()', () => {
  it('positive: #if, #elif, with || and a space', () => {
    const f = run(src('#if defined(A) || defined(B)', '#endif', '#if defined (A)', '#endif'));
    expect(f.map((x) => x.rule)).toEqual(['CB011', 'CB011']);
    expect(f[0].message).toMatch(/zxbpp has no defined\(\) operator/);
    expect(f[0]).toMatchObject({ line: 0, col: 4, endCol: 11 });
  });
  it('negative: #ifdef, a defined word without a call, comments and strings', () => {
    expect(ids(src('#ifdef A', '#endif', '#if DEFINED_X > 1', '#endif', "' #if defined(A)", 'a$ = "#if defined(A)"'))).toEqual([]);
  });
});

d('shadowing, includes and lines', () => {
  it('a user routine with a library name silences every rule on it', () => {
    expect(ids(src('FUNCTION KeyDown(k AS UBYTE) AS UBYTE', 'RETURN 0', 'END FUNCTION', 'x = KeyDown(300)'))).toEqual([]);
    expect(ids(src('x = KeyDown(300)'), { userNames: new Set(['keydown']) })).toEqual([]);
  });
  it('every rule has a distinct id and findings come out in source order', () => {
    const f = run(src('#if defined(A)', '#endif', 'PutSprite(0, 0, 0, 1, 0)', 'KeyDown(999)'));
    expect(f.map((x) => x.line)).toEqual([0, 2, 3]);
  });
});

/**
 * The repo's own programs (examples, games, tests): no diagnostics at all, except these
 * deliberate edge-case conformance tests, which feed the library out-of-range values on purpose
 * (so the lint is right about them; the tests are about the library's handling).
 */
d('corpus: the repo programs', () => {
  const deliberate: Record<string, RuleId[]> = {
    'tests/conformance/cb_fill.bas': ['CB007'], // PenByte(3) in mode 2: the masking test
    'tests/conformance/cb_palette.bas': ['CB007', 'CB007', 'CB007'], // SetInk(16,..), SetInk(1,30), SetBorder(40): the "ignored" tests
    'tests/conformance/cb_sprites.bas': ['CB009', 'CB009', 'CB009'], // PutSprite w/h = 0: the "draws nothing" tests
    'tests/conformance/play.bas': ['CB006'], // Play after AyWrite register tests
    'tests/conformance/plus_none_state.bas': ['CB005'], // the program that checks state when no sprite is hidden
  };
  const files = gitLsFiles('*.bas').filter((f) => !f.startsWith('lib/'));
  it('finds the corpus', () => expect(files.length).toBeGreaterThan(150));
  it('produces no unexpected finding (target unknown: CB003 and CB008 need the target)', () => {
    const bad: string[] = [];
    for (const f of files) {
      const got = lint(fs.readFileSync(path.join(REPO, f), 'utf8'), { index }).map((x) => x.rule);
      const want = deliberate[f] ?? [];
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${f}: ${got.join(',')} (expected ${want.join(',')})`);
    }
    expect(bad).toEqual([]);
  });
  it('the examples are clean under their real build modes (plusdemo is bare-metal)', () => {
    // plusdemo builds in firmware mode, the others in the mode their Makefile names; CB003 must stay quiet for the right mode
    const firmware = ['examples/plusdemo.bas', 'examples/bounce.bas'].filter((f) => files.includes(f));
    for (const f of firmware) {
      const got = lint(fs.readFileSync(path.join(REPO, f), 'utf8'), { index, arch: 'cpc', bare: f.includes('plusdemo') ? true : false });
      expect(got.filter((x) => x.rule !== 'CB005'), f).toEqual([]);
    }
  });
});
