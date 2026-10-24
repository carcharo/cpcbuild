/**
 * build.ts -- the build pipeline for one target (spec 4.6, design section 3):
 * zxbc (with -M map) -> package (mkdsk.py / mkcpr.py / the compiler's own tap)
 * -> build report. Stale generated assets (.cpcimp recipes) are regenerated first.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatReport, hex4, MemoryReport, memoryReport, parseMap, programStart } from '../core/map';
import { MIN_ORG, Project, Target, zxbcArgs } from '../core/project';
import { assetFailure, regenerateAll } from './assetsGen';
import { absFrom, compilerCommand, readSettings, resolveCompilerFor, resolveLibrary, resolveMkdsk, Settings } from './config';
import { makeCpr } from './mkcprGen';
import { CancelToken, runTool, Sink } from './runTool';
import { describeCompiler } from './toolpaths';
import { compilerHint, runZxbc } from './zxbcCommand';
import { isTrusted, notifyUntrusted, restrictedText } from './trust';
import type { EmuModel } from '../emuApi';

export interface Artifacts {
  bin?: string;
  map?: string;
  dsk?: string;
  cpr?: string;
  tap?: string;
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
  /** True when the failure is "no compiler found" (the caller may offer "CPC Game Studio: Download Tools"). */
  compilerMissing?: boolean;
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

export async function buildTarget(
  root: string,
  project: Project,
  target: Target,
  sink: Sink,
  token?: CancelToken,
  settings: Settings = readSettings(root),
): Promise<BuildResult> {
  const t0 = Date.now();
  const res: BuildResult = { ok: true, root, targetId: target.id, artifacts: {}, reportLines: [], ms: 0 };
  const done = (): BuildResult => ((res.ms = Date.now() - t0), res);
  if (!isTrusted()) {
    notifyUntrusted('Build');
    return done(), fail(res, restrictedText('Build'), sink);
  }
  sink.line(`Building target ${target.id} of ${project.name} (${target.arch}, ${target.package})`);

  const s = settings;
  const library = resolveLibrary(root, s, project.library);
  if (!library) {
    return done(), fail(res, `the cpcbuild library was not found (looked for lib/cpcbuild.bas${s.libraryPath ? ` under "${s.libraryPath}"` : ' above the project'}). Set "cpcbuild.library.path" to your cpcbuild checkout (the folder holding lib/ and tools/), then run "CPC Game Studio: Check Environment".`, sink);
  }
  const main = absFrom(root, target.main);
  if (!fs.existsSync(main)) {
    return done(), fail(res, `the main source ${main} does not exist. Fix "main" of target "${target.id}" in cpcbuild.json.`, sink);
  }
  const org = target.org ?? s.buildOrg;
  if (target.arch === 'cpc' && org !== undefined && org < MIN_ORG) {
    return done(), fail(res, `the origin ${hex4(org)} is below &0040, which the compiler refuses on the CPC. Set "cpcbuild.build.org" or the target's "org" to 0x40 or higher.`, sink);
  }

  // 0. stale generated assets (spec 2.3): recipes whose output is older than the image or the recipe
  if (s.regenerateBeforeBuild && project.assets.length) {
    const gen = await regenerateAll(
      root,
      project.assets,
      { engine: s.assetsEngine, header: s.assetsHeader, pythonPath: s.pythonPath, library },
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
  const isTap = target.package === 'tap';
  const bin = isTap ? undefined : `${base}.bin`;
  const map = target.arch === 'cpc' ? `${base}.map` : undefined;
  const out = isTap ? `${base}.tap` : (bin as string);
  for (const f of [`${base}.bin`, `${base}.map`, `${base}.dsk`, `${base}.cpr`, `${base}.tap`]) fs.rmSync(f, { force: true });

  // 1. compile
  const args = zxbcArgs(target, { libraryDir: library, main, out, map, defaultOrg: s.buildOrg, extra: s.zxbcArgs });
  const zxCwd = s.zxbcCwd ? absFrom(root, s.zxbcCwd) : root;
  const comp = resolveCompilerFor(root, s);
  if (comp.kind === 'none' && comp.problem) {
    res.compilerMissing = true;
    return done(), fail(res, `${comp.problem}. Fix the setting or clear it, then run "CPC Game Studio: Check Environment".`, sink);
  }
  const cr = await runZxbc(compilerCommand(comp, s), args, { cwd: zxCwd, token, sink });
  if (cr.cancelled) return done(), fail(res, 'cancelled.', sink);
  if (cr.error) {
    res.compilerMissing = !!cr.notFound;
    return done(), fail(res, compilerHint(cr.error, s.zxbcCommand, s.zxbcCwd ? zxCwd : undefined), sink);
  }
  sink.line(`Compiler: ${cr.used.join(' ')}${cr.fellBack ? ' (fallback)' : comp.kind !== 'none' ? ` (${describeCompiler(comp).split(':')[0]})` : ''}`);
  if (cr.code !== 0 || !fs.existsSync(out)) {
    return done(), fail(res, `zxbc exited with ${cr.code} (the errors above are in the Problems panel). Fix them and build again.`, sink);
  }
  if (isTap) {
    a.tap = out;
    const size = fs.statSync(out).size;
    res.reportLines = [`${path.basename(out)}: ${size} bytes${org !== undefined ? `, origin ${org}` : ''}`];
    sink.line(`Build report: ${res.reportLines[0]}`);
    sink.line(`Built ${out}`);
    return done();
  }
  a.bin = bin;
  const binSize = fs.statSync(bin as string).size;
  if (target.package === 'bin' && !map) {
    sink.line(`Built ${bin}`);
    return done();
  }

  // 2. map -> origin
  let start: number | undefined;
  let entries: ReturnType<typeof parseMap> = [];
  if (map) {
    if (!fs.existsSync(map)) return done(), fail(res, `zxbc did not write the memory map ${map}. Check "cpcbuild.zxbc.args" for options that suppress it.`, sink);
    a.map = map;
    entries = parseMap(fs.readFileSync(map, 'utf8'));
    start = programStart(entries);
    if (start === undefined) return done(), fail(res, `no .core.__START_PROGRAM in ${map}: cannot tell the program's origin.`, sink);
  }
  const loadHex = '0x' + (start ?? 0x40).toString(16).toUpperCase();

  // 3. package
  const model: EmuModel = s.modelOverride ?? target.model;
  if (target.package === 'dsk') {
    const mkdsk = resolveMkdsk(s, root, library, comp);
    if (!mkdsk) {
      return done(), fail(res, `mkdsk was not found (it comes with the compiler tools: run "CPC Game Studio: Download Tools"; or set "cpcbuild.zxbc.cwd" to your zxbasic checkout, which holds tools/cpc/mkdsk.py), then run "CPC Game Studio: Check Environment".`, sink);
    }
    const dsk = `${base}.dsk`;
    const r = await runTool(mkdsk, ['-o', dsk, '--load', loadHex, '--exec', loadHex, '--name', `${target.disc}.BIN`, bin as string], { cwd: root, token, sink });
    if (r.cancelled) return done(), fail(res, 'cancelled.', sink);
    if (r.error || r.code !== 0 || !fs.existsSync(dsk)) {
      const py = mkdsk[0] === s.pythonPath || mkdsk[0] === 'py';
      return done(), fail(res, r.error ? `${r.error}.${py ? ' Set "cpcbuild.python.path" to a Python 3.' : ' Run "CPC Game Studio: Download Tools" again.'}` : `mkdsk exited with ${r.code}.`, sink);
    }
    a.dsk = dsk;
    res.run = { file: dsk, kind: 'dsk', name: target.disc, model };
  } else if (target.package === 'cpr') {
    const cpr = `${base}.cpr`;
    const r = await makeCpr(bin as string, start ?? 0x40, cpr, { engine: s.assetsEngine, pythonPath: s.pythonPath, library }, { cwd: root, token, sink });
    if (!r.ok) return done(), fail(res, r.error ?? 'mkcpr failed.', sink);
    a.cpr = cpr;
    res.run = { file: cpr, kind: 'cpr', model: 'plus' };
  }

  // 4. report
  try {
    res.report = memoryReport(entries, binSize, { bare: target.bare, pkg: target.package, extraLimits: s.memoryLimits });
    res.reportLines = formatReport(res.report);
    sink.line(`Build report for ${target.id}:`);
    for (const l of res.reportLines) sink.line(`  ${l}`);
  } catch (e) {
    return done(), fail(res, (e as Error).message, sink);
  }
  sink.line(`Built ${a.dsk ?? a.cpr ?? a.bin}`);
  return done();
}
