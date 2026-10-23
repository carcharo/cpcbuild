/**
 * assetsGen.ts -- generating the .bas (or .asm / .bin) of .cpcimp recipes: finding recipes by the
 * project's "assets" globs, the stale check, and running one with the chosen engine.
 *
 *   builtin  the TypeScript port (src/core/img2cpc.ts + cpcimp.ts), no Python needed;
 *   python   tools/img2cpc.py of the cpcbuild checkout, run from the project root with the recipe's
 *            command line, so its output is the tool's own.
 *
 * No vscode import (the settings are passed in), so the vitest suite drives both engines.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { encodePng, type RgbaImage } from '../core/image';
import { decodeImage, ImageReadError } from '../core/imageio';
import { Img2cpcError, type CliIo } from '../core/img2cpc';
import {
  argvFor, composeSheet, effectiveOutput, inputsOf, outputsOf, parseRecipe, restyleHeader, RecipeError, runRecipe,
  toolMessage, type HeaderMode, type Recipe,
} from '../core/cpcimp';
import { globBase, matchesAny } from '../core/glob';
import { insideRoot, insideRootFrom, PathEscapeError } from '../core/paths';
import { parseSprite, resolvePalette, type DocType, type SpriteState } from '../core/spriteDoc';
import { exportAsset } from '../core/spriteExport';
import { runTool, type CancelToken, type Sink } from './runTool';

export type AssetEngine = 'builtin' | 'python';

export interface GenSettings {
  engine: AssetEngine;
  header: HeaderMode;
  pythonPath: string;
  /** The cpcbuild checkout (holds tools/img2cpc.py); needed for the python engine. */
  library?: string;
}

export interface GenResult {
  /** The recipe, relative to the root. */
  recipe: string;
  ok: boolean;
  /** Not stale (only with onlyStale). */
  skipped?: boolean;
  /** The tool's message (prefix "img2cpc: " for converter errors). */
  error?: string;
  written: string[];
  /** The entry is a sprite / tile document (not an importer recipe). */
  doc?: boolean;
  /** For a failed document: its (first) output file already exists, so the build can go on with it. */
  outputExists?: boolean;
}

/** What a failed regenerate means for the build: documents with an existing output only warn. */
export function assetFailure(g: GenResult): { fatal: boolean; message: string } {
  const why = g.error ?? 'failed';
  if (!g.doc) return { fatal: true, message: `asset ${g.recipe}: ${why}. Fix the recipe (open it in the importer) or turn off "cpcbuild.assets.regenerateBeforeBuild".` };
  const fix = 'Fix the sprite/tile document or its palette file (open it in the sprite editor)';
  return g.outputExists
    ? { fatal: false, message: `asset ${g.recipe}: ${why}. ${fix}; the build uses the existing output.` }
    : { fatal: true, message: `asset ${g.recipe}: ${why}, and its output does not exist yet. ${fix} or turn off "cpcbuild.assets.regenerateBeforeBuild".` };
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.vscode-test']);

const rel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/');

/** Every file with the extension matched by the project's asset globs, relative to the root, sorted. */
function findByExt(root: string, globs: readonly string[], ext: RegExp): string[] {
  const mine = globs.filter((g) => ext.test(g));
  const found = new Set<string>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs);
      } else if (ext.test(e.name) && matchesAny(mine, rel(root, abs))) found.add(rel(root, abs));
    }
  };
  for (const base of new Set(mine.map(globBase))) walk(path.join(root, base));
  return [...found].sort();
}

/** Every `.cpcimp` matched by the project's asset globs, relative to the root, sorted. */
export function findRecipes(root: string, globs: readonly string[]): string[] {
  return findByExt(root, globs, /\.cpcimp$/);
}

/** Every sprite / tile document (`.cpcspr`, `.cpctil`) matched by the project's asset globs, relative to the root, sorted. */
export function findSpriteDocs(root: string, globs: readonly string[]): string[] {
  return findByExt(root, globs, /\.(cpcspr|cpctil)$/);
}

const mtime = (p: string): number => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return -1;
  }
};

/** An output missing, or older than the recipe, the source image or a palette file. */
export function isStale(root: string, recipeRel: string, r: Recipe): boolean {
  const outs = outputsOf(r).map((o) => mtime(path.resolve(root, o)));
  if (outs.some((t) => t < 0)) return true;
  const oldestOut = Math.min(...outs);
  const newestIn = Math.max(mtime(path.resolve(root, recipeRel)), ...inputsOf(r).map((i) => mtime(path.resolve(root, i))));
  return newestIn > oldestOut;
}

// ---------------------------------------------------------------- sprite / tile documents

const docType = (docRel: string): DocType => (/\.cpcspr$/i.test(docRel) ? 'spr' : 'til');

/** The files a sprite / tile document writes (the .bas, or the .bin and the .pal beside it), as absolute paths. */
function spriteOutputs(root: string, docRel: string, s: SpriteState): string[] {
  const out = insideRootFrom(root, path.dirname(path.resolve(root, docRel)), s.output);
  return s.kind === 'plus' && s.plusFormat === 'bin' ? [out, out.replace(/\.[^./\\]*$/, '') + '.pal'] : [out];
}

/** The shared palette file of a document, as an absolute path (undefined: an inline palette, or a path outside the project). */
export function spritePaletteFile(root: string, docRel: string, s: SpriteState): string | undefined {
  if (!('file' in s.palette)) return undefined;
  try {
    return insideRootFrom(root, path.dirname(path.resolve(root, docRel)), s.palette.file);
  } catch {
    return undefined;
  }
}

/** An output missing, or older than the document or its shared palette file (a palette edited elsewhere changes the pens). */
export function isSpriteStale(root: string, docRel: string, s: SpriteState): boolean {
  let outs: number[];
  try {
    outs = spriteOutputs(root, docRel, s).map(mtime);
  } catch {
    return true; // the generate pass reports the bad path
  }
  if (outs.some((t) => t < 0)) return true;
  const pal = spritePaletteFile(root, docRel, s);
  return Math.max(mtime(path.resolve(root, docRel)), pal ? mtime(pal) : -1) > Math.min(...outs);
}

/** Reads and parses a sprite / tile document. */
export function readSpriteDoc(root: string, docRel: string): SpriteState {
  const abs = path.resolve(root, docRel);
  return parseSprite(fs.readFileSync(abs, 'utf8'), docType(docRel), path.basename(abs).replace(/\.[^.]*$/, ''));
}

/** Generates the output of a sprite / tile document straight from disk (no editor needed), like the editor's Generate. */
export function generateSpriteDoc(root: string, docRel: string, s: SpriteState, header: HeaderMode): GenResult {
  const res: GenResult = { recipe: docRel, ok: false, written: [] };
  try {
    const palFile = spritePaletteFile(root, docRel, s);
    let palette = resolvePalette(s);
    if ('file' in s.palette) {
      let text: string | undefined;
      try {
        text = palFile ? fs.readFileSync(palFile, 'utf8') : undefined;
      } catch {
        // resolvePalette says the file could not be read
      }
      palette = resolvePalette(s, text);
    }
    if (palette.problem) throw new Error(palette.problem);
    const ex = exportAsset(s, { source: path.basename(docRel), header, palette });
    const [out, pal] = spriteOutputs(root, docRel, s);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, ex.bin ?? ex.text);
    res.written.push(rel(root, out));
    if (ex.bin && ex.palBin) {
      fs.writeFileSync(pal, ex.palBin);
      res.written.push(rel(root, pal));
    }
    res.ok = true;
  } catch (e) {
    res.error = describeError(e);
  }
  return res;
}

// ---------------------------------------------------------------- io

const cache = new Map<string, { mtimeMs: number; size: number; img: RgbaImage }>();

/** Decodes an image once per (file, mtime, size): the live preview calls this on every keystroke. */
export function cachedDecode(abs: string, bytes: Uint8Array): RgbaImage {
  let st: fs.Stats | undefined;
  try {
    st = fs.statSync(abs);
  } catch {
    // not a file on disk: decode without caching
  }
  const hit = cache.get(abs);
  if (st && hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.img;
  const img = decodeImage(bytes);
  if (st) cache.set(abs, { mtimeMs: st.mtimeMs, size: st.size, img });
  return img;
}

/** File access relative to the project root (a missing file is an Img2cpcError, which the callers turn into the tool's text). */
export function rootIo(root: string): CliIo {
  const wrap = <T>(p: string, f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Img2cpcError(`${p}: no such file`);
      throw e;
    }
  };
  return {
    readFile: (p) => wrap(p, () => new Uint8Array(fs.readFileSync(insideRoot(root, p)))),
    readText: (p) => wrap(p, () => fs.readFileSync(insideRoot(root, p), 'utf8')),
    exists: (p) => {
      try {
        return fs.statSync(insideRoot(root, p)).isFile();
      } catch {
        return false;
      }
    },
  };
}

export function decoderFor(root: string): (p: string, bytes: Uint8Array) => RgbaImage {
  return (p, bytes) => cachedDecode(insideRoot(root, p), bytes);
}

/** The message to show for anything a run throws. */
export function describeError(e: unknown): string {
  if (e instanceof Img2cpcError || e instanceof ImageReadError) return toolMessage(e);
  if (e instanceof RecipeError || e instanceof PathEscapeError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Every path a recipe names (inputs and outputs) must stay inside the project folder, whatever the engine. */
export function checkRecipePaths(root: string, recipeRel: string, r: Recipe): void {
  for (const p of [...inputsOf(r), ...outputsOf(r)]) {
    try {
      insideRoot(root, p);
    } catch (e) {
      if (e instanceof PathEscapeError) throw new RecipeError(`${recipeRel}: ${e.message}`);
      throw e;
    }
  }
}

// ---------------------------------------------------------------- engines

function writeFiles(root: string, files: { path: string; data: string | Uint8Array }[]): string[] {
  const written: string[] = [];
  for (const f of files) {
    const abs = insideRoot(root, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.data);
    written.push(f.path);
  }
  return written;
}

/** Runs one recipe (already parsed) with the chosen engine and writes its files. */
export async function generate(
  root: string,
  recipeRel: string,
  r: Recipe,
  s: GenSettings,
  extra: { sink?: Sink; token?: CancelToken } = {},
): Promise<GenResult> {
  const res: GenResult = { recipe: recipeRel, ok: false, written: [] };
  try {
    if (!r.source) throw new RecipeError(`${recipeRel}: no source image yet. Choose one in the importer.`);
    checkRecipePaths(root, recipeRel, r);
    if (s.engine === 'builtin') {
      const out = runRecipe(r, rootIo(root), { header: s.header, recipePath: recipeRel, decode: decoderFor(root) });
      res.written = writeFiles(root, out.files);
      res.ok = true;
      return res;
    }
    return await generatePython(root, recipeRel, r, s, res, extra);
  } catch (e) {
    res.error = describeError(e);
    return res;
  }
}

async function generatePython(root: string, recipeRel: string, r: Recipe, s: GenSettings, res: GenResult, extra: { sink?: Sink; token?: CancelToken }): Promise<GenResult> {
  const script = s.library ? path.join(s.library, 'tools', 'img2cpc.py') : '';
  if (!script || !fs.existsSync(script)) {
    res.error = 'tools/img2cpc.py was not found. Set "cpcbuild.library.path" to your cpcbuild checkout (the folder holding lib/ and tools/), or set "cpcbuild.assets.engine" to "builtin".';
    return res;
  }
  let tmpDir: string | undefined;
  let tmpPng: string | undefined;
  let argv = argvFor(r, rootIo(root));
  if (r.grid) {
    // pre-processing has no flag: compose the sheet here and hand the tool a temporary PNG
    const img = composeSheet(decodeImage(rootIo(root).readFile(r.source)), r.grid);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcimp-'));
    tmpPng = path.join(tmpDir, path.basename(r.source).replace(/\.[^.]*$/, '') + '.png');
    fs.writeFileSync(tmpPng, encodePng(img));
    argv = argv.map((w) => (w === r.source ? (tmpPng as string) : w));
  }
  try {
    const t = await runTool([s.pythonPath], [script, ...argv], { cwd: root, token: extra.token, sink: extra.sink, quiet: true });
    if (t.cancelled) {
      res.error = 'cancelled';
      return res;
    }
    if (t.error) {
      res.error = `${t.error}. Set "cpcbuild.python.path" to a Python 3 with Pillow, or set "cpcbuild.assets.engine" to "builtin".`;
      return res;
    }
    if (t.code !== 0) {
      res.error = (t.stderr.trim() || `img2cpc.py exited with ${t.code}`).split('\n').pop() as string;
      return res;
    }
    const out = effectiveOutput(r);
    const abs = insideRoot(root, out);
    const isBin = r.target.startsWith('plus') && r.plus?.format === 'bin';
    if (!isBin) {
      let text = fs.readFileSync(abs, 'utf8');
      if (tmpPng) text = text.split(tmpPng).join(r.source);
      const styled = restyleHeader(text, s.header, recipeRel);
      if (styled !== text || tmpPng) fs.writeFileSync(abs, styled);
    }
    res.written = outputsOf(r);
    res.ok = true;
    return res;
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Reads, parses and generates one recipe file. */
export async function generateFile(root: string, recipeRel: string, s: GenSettings, extra: { sink?: Sink; token?: CancelToken } = {}): Promise<GenResult> {
  let r: Recipe;
  try {
    r = parseRecipe(fs.readFileSync(path.resolve(root, recipeRel), 'utf8'));
  } catch (e) {
    return { recipe: recipeRel, ok: false, written: [], error: `${recipeRel}: ${describeError(e)}` };
  }
  return generate(root, recipeRel, r, s, extra);
}

export interface RegenOptions {
  /** Only recipes whose output is older than their inputs (the pre-build pass). */
  onlyStale?: boolean;
  sink?: Sink;
  token?: CancelToken;
}

/** Regenerates every recipe the globs match. Stops at nothing: all failures are reported. */
export async function regenerateAll(root: string, globs: readonly string[], s: GenSettings, o: RegenOptions = {}): Promise<GenResult[]> {
  const results: GenResult[] = [];
  for (const recipeRel of findRecipes(root, globs)) {
    let r: Recipe;
    try {
      r = parseRecipe(fs.readFileSync(path.resolve(root, recipeRel), 'utf8'));
    } catch (e) {
      const res = { recipe: recipeRel, ok: false, written: [], error: `${recipeRel}: ${describeError(e)}` };
      o.sink?.line(res.error, true);
      results.push(res);
      continue;
    }
    if (o.onlyStale && r.source && !isStale(root, recipeRel, r)) {
      results.push({ recipe: recipeRel, ok: true, skipped: true, written: [] });
      continue;
    }
    const res = await generate(root, recipeRel, r, s, { sink: o.sink, token: o.token });
    if (res.ok) o.sink?.line(`${recipeRel} -> ${res.written.join(', ')}`);
    else o.sink?.line(`${recipeRel}: ${res.error}`, true);
    results.push(res);
    if (o.token?.isCancellationRequested) break;
  }
  // sprite and tile documents the globs list: written from the document and its shared palette file, editor open or not
  for (const docRel of findSpriteDocs(root, globs)) {
    if (o.token?.isCancellationRequested) break;
    let state: SpriteState;
    try {
      state = readSpriteDoc(root, docRel);
    } catch (e) {
      const res = { recipe: docRel, ok: false, written: [], error: `${docRel}: ${describeError(e)}`, doc: true, outputExists: false };
      o.sink?.line(res.error, true);
      results.push(res);
      continue;
    }
    if (o.onlyStale && !isSpriteStale(root, docRel, state)) {
      results.push({ recipe: docRel, ok: true, skipped: true, written: [] });
      continue;
    }
    const res = generateSpriteDoc(root, docRel, state, s.header);
    res.doc = true;
    if (!res.ok) {
      try {
        res.outputExists = mtime(spriteOutputs(root, docRel, state)[0]) >= 0;
      } catch {
        res.outputExists = false;
      }
    }
    if (res.ok) o.sink?.line(`${docRel} -> ${res.written.join(', ')}`);
    else o.sink?.line(`${docRel}: ${res.error}`, true);
    results.push(res);
  }
  return results;
}
