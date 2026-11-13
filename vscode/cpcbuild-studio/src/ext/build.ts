/**
 * build.ts -- the build pipeline for one target (spec 4.6, design section 3): the cpcbas compiler library runs
 * in this process (no child process) and returns the program, the packaged .dsk or .cpr, the memory map and
 * the diagnostics; then the build report. Stale generated assets (.cpcimp recipes) are regenerated first.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compile, VERSION, type CompileResult, type FileTree } from '@cpcbuild/cpcbas';
import { diskTree, loadRuntime } from '@cpcbuild/cpcbas/node';
import { buildDiagnostics, formatBuildDiagnostic, type BuildDiagnostic } from '../core/buildDiag';
import { formatReport, hex4, MemoryReport, memoryReport, parseMap, programStart } from '../core/map';
import { compileInput, MIN_ORG, Project, Target } from '../core/project';
import { assetFailure, regenerateAll } from './assetsGen';
import { absFrom, bundledLibrary, readSettings, resolveArkos, resolveLibrary, Settings } from './config';
import { soundSetupHint } from '../core/sfxBuild';
import { publishBuildDiagnostics } from './buildProblems';
import { CancelToken, Sink } from './runTool';
import { isTrusted, notifyUntrusted, restrictedText } from './trust';
import type { EmuModel } from '../emuApi';

export interface Artifacts {
  bin?: string;
  map?: string;
  dsk?: string;
  cpr?: string;
}

/** What to hand to an emulator after a successful build. */
export interface RunInfo {
  file: string;
  kind: 'dsk' | 'cpr';
  /** AMSDOS stem to `run"` (dsk). */
  name?: string;
  model: EmuModel;
}

export interface BuildResult {
  ok: boolean;
  root: string;
  targetId: string;
  /** The failure, with the fix. */
  message?: string;
  /** What the compiler reported (errors, warnings, notes), with absolute file paths. */
  diagnostics?: BuildDiagnostic[];
  artifacts: Artifacts;
  report?: MemoryReport;
  reportLines: string[];
  run?: RunInfo;
  ms: number;
}

const fail = (r: BuildResult, message: string, sink: Sink): BuildResult => {
  r.ok = false;
  r.message = message;
  sink.line(`Build failed: ${message}`, true);
  return r;
};

/** The library's runtime tree, read lazily and kept: the bundled files never change while the extension runs. */
const runtimes = new Map<string, FileTree>();
export function runtimeFor(libDir: string): FileTree {
  let t = runtimes.get(libDir);
  if (!t) runtimes.set(libDir, (t = loadRuntime(libDir)));
  return t;
}

/** `YYYY-MM-DD` of the local date: the value of __DATE__ in the program. */
const today = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export interface BuildOptions {
  /** Show the compiler's diagnostics in the Problems panel (default true; the music preview does not). */
  publish?: boolean;
}

export async function buildTarget(
  root: string,
  project: Project,
  target: Target,
  sink: Sink,
  token?: CancelToken,
  settings: Settings = readSettings(root),
  options: BuildOptions = {},
): Promise<BuildResult> {
  const t0 = Date.now();
  const res: BuildResult = { ok: true, root, targetId: target.id, artifacts: {}, reportLines: [], ms: 0 };
  const done = (): BuildResult => ((res.ms = Date.now() - t0), res);
  if (!isTrusted()) {
    notifyUntrusted('Build');
    return done(), fail(res, restrictedText('Build'), sink);
  }
  sink.line(`Building target ${target.id} of ${project.name} (${target.package}, cpcbas ${VERSION})`);

  const s = settings;
  const bundled = bundledLibrary();
  const libDir = bundled ? path.join(bundled, 'lib') : undefined;
  if (!libDir || !fs.existsSync(path.join(libDir, 'runtime'))) {
    return done(), fail(res, 'the BASIC library inside the extension was not found (bundled/lib). Install CPC Game Studio again.', sink);
  }
  const main = absFrom(root, target.main);
  if (!fs.existsSync(main)) {
    return done(), fail(res, `the main source ${main} does not exist. Fix "main" of target "${target.id}" in cpcbuild.json.`, sink);
  }
  const org = target.org ?? s.buildOrg;
  if (org !== undefined && org < MIN_ORG) {
    return done(), fail(res, `the origin ${hex4(org)} is below &0040, which the compiler refuses on the CPC. Set "cpcbuild.build.org" or the target's "org" to 0x40 or higher.`, sink);
  }

  // 0. stale generated assets (spec 2.3): recipes whose output is older than the image or the recipe
  if (s.regenerateBeforeBuild && project.assets.length) {
    const library = resolveLibrary(root, s, project.library);
    const gen = await regenerateAll(
      root,
      project.assets,
      { engine: s.assetsEngine, header: s.assetsHeader, pythonPath: s.pythonPath, library, toolsDir: resolveArkos(root, s, library) },
      { onlyStale: true, sink, token },
    );
    const fresh = gen.filter((g) => g.ok && !g.skipped);
    if (fresh.length) sink.line(`Regenerated ${fresh.length} asset recipe${fresh.length === 1 ? '' : 's'}.`);
    for (const g of gen.filter((x) => !x.ok)) {
      const f = assetFailure(g);
      if (f.fatal) return done(), fail(res, f.message, sink);
      sink.line(`Warning: ${f.message}`, true);
    }
  }

  const outDir = absFrom(root, s.outputDir);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, target.id);
  const a = res.artifacts;
  for (const f of [`${base}.bin`, `${base}.map`, `${base}.dsk`, `${base}.cpr`]) fs.rmSync(f, { force: true });

  // 1. compile, in this process
  if (token?.isCancellationRequested) return done(), fail(res, 'cancelled.', sink);
  const input = compileInput(target, project, { buildOrg: s.buildOrg, compilerArgs: s.compilerArgs });
  for (const w of input.warnings) sink.line(`Warning: ${w}`, true);
  await new Promise<void>((r) => setImmediate(r)); // let the "Building" line reach the output before the compiler holds the thread
  let cr: CompileResult;
  try {
    cr = compile({
      files: diskTree(root),
      main: input.main,
      includePaths: input.includePaths,
      defines: input.defines,
      runtime: runtimeFor(libDir),
      options: { ...input.options, buildDate: today(), now: () => performance.now() },
    });
  } catch (e) {
    return done(), fail(res, `the compiler stopped with an internal error (cpcbas ${VERSION}): ${(e as Error).message}. Please report it with the program that caused it.`, sink);
  }
  const diags = buildDiagnostics(cr, root, libDir);
  res.diagnostics = diags;
  if (options.publish !== false) publishBuildDiagnostics(root, diags);
  for (const d of diags) sink.line(formatBuildDiagnostic(d, root), d.severity === 'error');
  if (!cr.ok || !cr.binary || !cr.output) {
    const errors = diags.filter((d) => d.severity === 'error').length;
    const sound = soundSetupHint(diags.map((d) => d.message).join('\n'));
    const why = cr.exitCode === 5
      ? 'the program does not fit the memory layout (see the build report for the addresses, and shorten the program, move data with #pragma hidata, or lower the origin).'
      : `the compiler reported ${errors} error${errors === 1 ? '' : 's'} (they are in the Problems panel). ${sound ? `${sound} ` : ''}Fix them and build again.`;
    return done(), fail(res, why, sink);
  }
  sink.line(`Compiled ${cr.stats.codeBytes} bytes of code and ${cr.stats.dataBytes} of data in ${Math.round(cr.stats.timeMs)} ms (cpcbas ${VERSION}).`);

  // 2. the files: the program, the map, the disc or cartridge the compiler packed
  const bin = `${base}.bin`;
  fs.writeFileSync(bin, cr.binary);
  a.bin = bin;
  const mapFile = `${base}.map`;
  if (cr.map === undefined) return done(), fail(res, 'the compiler did not return a memory map.', sink);
  fs.writeFileSync(mapFile, cr.map);
  a.map = mapFile;
  const entries = parseMap(cr.map);
  if (programStart(entries) === undefined) return done(), fail(res, `no .core.__START_PROGRAM in ${mapFile}: cannot tell the program's origin.`, sink);
  const model: EmuModel = s.modelOverride ?? target.model;
  if (target.package === 'dsk') {
    const dsk = `${base}.dsk`;
    fs.writeFileSync(dsk, cr.output);
    a.dsk = dsk;
    res.run = { file: dsk, kind: 'dsk', name: target.disc, model };
  } else if (target.package === 'cpr') {
    const cpr = `${base}.cpr`;
    fs.writeFileSync(cpr, cr.output);
    a.cpr = cpr;
    res.run = { file: cpr, kind: 'cpr', model: 'plus' };
  }

  // 3. report
  try {
    res.report = memoryReport(entries, cr.binary.length, { bare: target.bare, pkg: target.package, extraLimits: s.memoryLimits });
    res.reportLines = formatReport(res.report);
    sink.line(`Build report for ${target.id}:`);
    for (const l of res.reportLines) sink.line(`  ${l}`);
  } catch (e) {
    return done(), fail(res, (e as Error).message, sink);
  }
  sink.line(`Built ${a.dsk ?? a.cpr ?? a.bin}`);
  return done();
}
