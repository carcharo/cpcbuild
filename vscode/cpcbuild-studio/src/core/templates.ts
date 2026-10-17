/**
 * templates.ts -- the four project templates of spec 4.5 as plain data:
 * file name -> content. Pure TypeScript; the extension writes them to disk.
 */
import { deriveDiscStem } from './project';

export type TemplateId = 'firmware' | 'baremetal' | 'plus' | 'shared';

export interface TemplateInfo {
  id: TemplateId;
  label: string;
  description: string;
}

export const TEMPLATES: readonly TemplateInfo[] = [
  { id: 'firmware', label: 'Firmware (CPC 464/6128)', description: 'Mode 1 program using the firmware; disc image' },
  { id: 'baremetal', label: 'Bare metal (no firmware)', description: 'Same program with -D CPC_BAREMETAL; disc image' },
  { id: 'plus', label: 'Plus cartridge', description: 'CPC Plus hardware sprites and 12-bit palette; .cpr cartridge and a disc' },
  { id: 'shared', label: 'Shared CPC + Spectrum', description: 'One game, platform layers per machine; .dsk and .tap' },
];

export interface TemplateOptions {
  /** Project name as typed by the user. */
  name: string;
}

export interface TemplateResult {
  /** Relative path (forward slashes) -> text. */
  files: Record<string, string>;
  /** The AMSDOS stem derived from the name, shown to the user. */
  disc: string;
}

const FIRMWARE_MAIN = `' main.bas -- a small CPCBuild program for the firmware: mode 1, four pens,
' one bouncing sprite. ESC quits.
' Build and run: "CPCBuild: Build and Run" (target cpc6128 or cpc464).
#include <cpc.bas>
#include <cpcbuild.bas>

' Pens 0-3 as firmware colours (docs/library.md, Palette): black, bright
' white, bright red, bright green.
DIM pal(3) AS UBYTE = {0, 26, 6, 18}

' A sprite 2 bytes wide (8 pixels in mode 1) and 8 lines high. assets/ball.cpcspr
' is the same picture as a Studio document (the editors come with later
' versions of the extension).
DIM ball(15) AS UBYTE = { _
  $FF, $FF, $8F, $1F, $8F, $1F, $8F, $1F, _
  $8F, $1F, $8F, $1F, $8F, $1F, $FF, $FF }

DIM x, y, dx, dy AS UBYTE

Mode 1
SetPalette(@pal(0), 4)
SetBorder 0
ScreenInit()      ' always call ScreenInit() after Mode
CLS
PRINT AT 1, 1; "HELLO FROM CPCBUILD - ESC QUITS"

x = 10
y = 40
dx = 1
dy = 2
DO
  WaitRetrace(1)
  FillRect(x, y, 2, 8, 0)           ' erase the old picture (x in bytes, y in lines)
  IF x >= 77 THEN dx = 255          ' 255 = -1 in a UBYTE: adding it wraps
  IF x <= 1 THEN dx = 1
  IF y >= 190 THEN dy = 254
  IF y <= 20 THEN dy = 2
  x = x + dx
  y = y + dy
  PutSprite(x, y, 2, 8, @ball(0))
  ScanKeys()
LOOP UNTIL KeyDown(KEY_ESC)
END
`;

const BARE_NOTES = `' BARE METAL: this target is built with -D CPC_BAREMETAL, so the program
' runs without the firmware (no interrupt-driven sound manager, no ROM
' routines). The library keeps working for graphics, keys and text, but it
' refuses these firmware-only calls: SoundQueue, SoundFree, SoundBusy,
' SoundEnvelope and BankLoad. Use the Arkos player (<music/music.bas>) for
' sound instead. See docs/library.md and the Phase 6 notes.
'
`;

const PLUS_MAIN = `' main.bas -- a CPC Plus program: two hardware sprites and a 12-bit palette.
' Targets: plus-cart (a .cpr cartridge, bare metal with its own font) and
' plus-dsk (a disc that runs under the firmware). ESC quits.
' On a CPC without the ASIC it says so and waits for a key.
#include <cpc.bas>
#include <cpcbuild.bas>
#include <cpcplus/cpcplus.bas>

' A 16x16 hardware sprite is 128 bytes packed: two pixels a byte, the left
' one in the high nibble, 0 = transparent, 1-15 = sprite colour.
' assets/sprite.cpcspr and assets/colours.cpcpal12 hold the same data as Studio
' documents. Here the picture is drawn at start-up: a frame in colour 1
' around a centre in colour 2.
DIM spr(127) AS UBYTE

SUB MakeSprite()
  DIM r, c, v AS UBYTE
  FOR r = 0 TO 15
    FOR c = 0 TO 7
      v = $22
      IF r = 0 OR r = 15 THEN v = $11
      IF c = 0 THEN v = (v BAND $0F) BOR $10
      IF c = 7 THEN v = (v BAND $F0) BOR $01
      spr(r * 8 + c) = v
    NEXT c
  NEXT r
END SUB

DIM x0, y0, x1, y1, d0, d1 AS INTEGER

Mode 1
ScreenInit()
CLS
IF PlusAvailable() = 0 THEN
  PRINT AT 5, 5; "THIS NEEDS A CPC PLUS"
  DO
    ScanKeys()
  LOOP UNTIL AnyKeyDown()
  END
END IF

' 12-bit colours: &H0RGB, four bits a channel
SetPalette12(0, $0008)
SetPalette12(1, $0FFF)
SetBorder12($0008)
SpritesHideAll()
SpriteColour(1, $0F80)
SpriteColour(2, $00F8)
MakeSprite()
SpriteSetImagePacked(0, @spr(0))
SpriteSetImagePacked(1, @spr(0))
SpriteMag(0, 2, 2)                  ' sprite 0 twice the size
SpriteMag(1, 1, 1)
PRINT AT 1, 1; "HELLO FROM CPCBUILD (PLUS)"

x0 = 20
y0 = 40
d0 = 2
x1 = 300
y1 = 120
d1 = 0 - 3
DO
  WaitRetrace(1)
  x0 = x0 + d0
  IF x0 > 600 OR x0 < 10 THEN d0 = 0 - d0
  x1 = x1 + d1
  IF x1 > 600 OR x1 < 10 THEN d1 = 0 - d1
  SpriteMove(0, x0, y0)
  SpriteMove(1, x1, y1)
  ScanKeys()
LOOP UNTIL KeyDown(KEY_ESC)
END
`;

const SHARED_MAIN = `' main.bas -- one game, two machines: the CPC and the ZX Spectrum.
' game.bas is the shared logic; platform_cpc.bas and platform_zx.bas are the
' only files that know which machine this is (__CPC__ is defined by the
' compiler for --arch cpc). Same layout as games/shooter.
#ifdef __CPC__
#include "platform_cpc.bas"
#else
#include "platform_zx.bas"
#endif
#include "game.bas"
`;

const SHARED_CPC = `' platform_cpc.bas -- the CPC side: firmware text screen, ESC quits.
#include <cpc.bas>
#include <cpcbuild.bas>

SUB PlatInit()
  Mode 1
  ScreenInit()
  CLS
END SUB

SUB PlatWait()
  WaitRetrace(1)
END SUB

FUNCTION PlatQuit() AS UBYTE
  ScanKeys()
  RETURN KeyDown(KEY_ESC)
END FUNCTION
`;

const SHARED_ZX = `' platform_zx.bas -- the Spectrum side: SPACE quits.
SUB PlatInit()
  BORDER 0
  PAPER 0
  INK 7
  CLS
END SUB

SUB PlatWait()
  PAUSE 1
END SUB

FUNCTION PlatQuit() AS UBYTE
  IF INKEY$ = " " THEN RETURN 1
  RETURN 0
END FUNCTION
`;

const SHARED_GAME = `' game.bas -- the shared logic. Integers and text only, so it behaves the
' same on both machines. The platform layer supplies PlatInit(), PlatWait()
' and PlatQuit().
DIM x, y, dx, dy AS UBYTE

PlatInit()
PRINT AT 0, 0; "HELLO FROM CPCBUILD"
x = 5
y = 5
dx = 1
dy = 1
DO
  PlatWait()
  PRINT AT y, x; " "
  IF x >= 28 THEN dx = 255
  IF x <= 1 THEN dx = 1
  IF y >= 20 THEN dy = 255
  IF y <= 2 THEN dy = 1
  x = x + dx
  y = y + dy
  PRINT AT y, x; "O"
LOOP UNTIL PlatQuit()
END
`;

function json(v: unknown): string {
  return JSON.stringify(v, null, 2) + '\n';
}

const CPC_PAL = '# Firmware colours of pens 0-3: black, bright white, bright red, bright green\n0, 26, 6, 18\n';
const CPC_SPR = {
  format: 'cpcspr', version: 1, kind: 'cpc', mode: 1, name: 'ball', frame: { w: 8, h: 8 }, masked: false,
  palette: { file: 'pens.cpcpal' },
  frames: [['33333333', '32222223', '32222223', '32222223', '32222223', '32222223', '32222223', '33333333']],
  output: 'ball.bas', emitPalette: false,
};
const PLUS_SPR = {
  format: 'cpcspr', version: 1, kind: 'plus', name: 'sprite', frame: { w: 16, h: 16 },
  palette: { file: 'colours.cpcpal12' },
  frames: [['1111111111111111', ...Array.from({ length: 14 }, () => '1222222222222221'), '1111111111111111']],
  output: 'sprite.bas', packed: true,
};

function readme(title: string, lines: string[]): string {
  return `# ${title}\n\nA CPCBuild Studio project. Three things to try:\n\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\n` +
    'Targets and packaging are in `cpcbuild.json`; the build puts its output in `build/`.\n' +
    'Set `cpcbuild.library.path` (and `cpcbuild.zxbc.command`) in the settings if "CPCBuild: Check Environment" reports something missing.\n';
}

export function generateTemplate(id: TemplateId, opts: TemplateOptions): TemplateResult {
  const name = opts.name.trim() || 'myproject';
  const disc = deriveDiscStem(name);
  const files: Record<string, string> = { '.gitignore': 'build/\n' };
  const common = (title: string, steps: string[]): void => {
    files['README.md'] = readme(title, steps);
  };
  switch (id) {
    case 'firmware': {
      files['cpcbuild.json'] = json({
        version: 1, name,
        targets: [
          { id: 'cpc6128', arch: 'cpc', main: 'src/main.bas', model: '6128', defines: ['CPC6128'], package: 'dsk', disc },
          { id: 'cpc464', arch: 'cpc', main: 'src/main.bas', model: '464', defines: ['CPC464'], package: 'dsk', disc },
        ],
        assets: ['assets/**/*.cpcimp', 'assets/**/*.cpcspr', 'assets/**/*.cpcpal'],
      });
      files['src/main.bas'] = FIRMWARE_MAIN;
      files['assets/pens.cpcpal'] = CPC_PAL;
      files['assets/ball.cpcspr'] = json(CPC_SPR);
      common(name, [
        'Run **CPCBuild: Build and Run** (the status bar shows the target).',
        'Switch target with **CPCBuild: Select Target** (`cpc464` is the same program on a 464).',
        `At the BASIC prompt of a manual emulator session, type \`run"${disc}\`.`,
      ]);
      break;
    }
    case 'baremetal': {
      files['cpcbuild.json'] = json({
        version: 1, name,
        targets: [{ id: 'bare6128', arch: 'cpc', main: 'src/main.bas', model: '6128', defines: ['CPC6128'], bare: true, package: 'dsk', disc }],
        assets: ['assets/**/*.cpcimp', 'assets/**/*.cpcspr', 'assets/**/*.cpcpal'],
      });
      files['src/main.bas'] = BARE_NOTES + FIRMWARE_MAIN;
      files['assets/pens.cpcpal'] = CPC_PAL;
      files['assets/ball.cpcspr'] = json(CPC_SPR);
      common(name, [
        'Run **CPCBuild: Build and Run**: the target is built with `-D CPC_BAREMETAL`.',
        'Read the comment at the top of `src/main.bas` for what a bare program cannot call.',
        'Open the build report (**CPCBuild: Show Build Report**) to see the headroom below the bare limits.',
      ]);
      break;
    }
    case 'plus': {
      files['cpcbuild.json'] = json({
        version: 1, name,
        targets: [
          { id: 'plus-cart', arch: 'cpc', main: 'src/main.bas', model: 'plus', defines: ['PLUS'], bare: true, ownFont: true, package: 'cpr' },
          { id: 'plus-dsk', arch: 'cpc', main: 'src/main.bas', model: 'plus', defines: ['PLUS'], package: 'dsk', disc },
        ],
        assets: ['assets/**/*.cpcimp', 'assets/**/*.cpcspr', 'assets/**/*.cpcpal12'],
      });
      files['src/main.bas'] = PLUS_MAIN;
      files['assets/colours.cpcpal12'] = '# sprite colours 1-15 (12-bit R G B hex triples)\nF80, 08F\n';
      files['assets/sprite.cpcspr'] = json(PLUS_SPR);
      common(name, [
        'Build target `plus-cart` and run the `.cpr` in an emulator set to the Plus model.',
        `Build target \`plus-dsk\` for the disc version (\`run"${disc}\`).`,
        'Compare the two in the build report: the cartridge has no firmware and brings its own font.',
      ]);
      break;
    }
    case 'shared': {
      files['cpcbuild.json'] = json({
        version: 1, name,
        targets: [
          { id: 'cpc6128', arch: 'cpc', main: 'src/main.bas', model: '6128', defines: ['CPC6128'], package: 'dsk', disc },
          { id: 'cpc464', arch: 'cpc', main: 'src/main.bas', model: '464', defines: ['CPC464'], package: 'dsk', disc },
          { id: 'zx128', arch: 'zx48k', main: 'src/main.bas', defines: ['ZX128'], org: 31744, heap: 256, package: 'tap' },
          { id: 'zx48', arch: 'zx48k', main: 'src/main.bas', defines: ['ZX48'], org: 32768, heap: 256, package: 'tap' },
        ],
        assets: ['assets/**/*.png'],
      });
      files['src/main.bas'] = SHARED_MAIN;
      files['src/game.bas'] = SHARED_GAME;
      files['src/platform_cpc.bas'] = SHARED_CPC;
      files['src/platform_zx.bas'] = SHARED_ZX;
      files['assets/cpc/pens.cpcpal'] = CPC_PAL;
      files['assets/zx/.gitkeep'] = '';
      files['assets/README.md'] =
        'Put one source PNG here. `assets/cpc/` is generated from it with `--mode 0` and `assets/zx/` with `--spectrum`\n' +
        '(tools/img2cpc.py), the way games/shooter does it. This template draws text only, so nothing is generated yet.\n';
      common(name, [
        'Build `cpc6128` and run it; build `zx128` for a `.tap` (Spectrum targets are build-only: load the tape in your own Spectrum emulator).',
        'Open `src/game.bas`: the shared logic. Only `platform_cpc.bas` and `platform_zx.bas` know the machine.',
        'Add a graphic: see `assets/README.md`.',
      ]);
      break;
    }
  }
  return { files, disc };
}
