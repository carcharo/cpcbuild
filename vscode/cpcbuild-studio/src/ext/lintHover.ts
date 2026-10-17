/**
 * lintHover.ts -- library hover, completion, signature help and lint for
 * Boriel BASIC files inside cpcbuild projects (spec 5.4). Studio claims no
 * `.bas` language (spec 3.3): the providers attach by file pattern, and every
 * one of them returns nothing for a file that has no cpcbuild.json above it.
 */
import * as vscode from 'vscode';
import { Masked, mask, userDefinedNames } from '../core/bastok';
import { sectionFor } from '../core/libdocs';
import { callAt, describeRoutine, describeSetting, HoverParts, paramRanges } from '../core/libhover';
import { LibIndex, LibRoutine } from '../core/libindex';
import { Finding, lint, RULES, RuleId, Severity } from '../core/lint';
import { readSettings } from './config';
import { includedUserNames, invalidateLibraries, LibraryInfo, libraryFor, targetFacts } from './library';

/** Language ids the Boriel / NextBuild extensions use for .bas files; the file pattern covers the rest. */
const LANGUAGES = ['zxbasic', 'boriel', 'boriel-basic', 'cpcbuild-basic'];
export const SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', pattern: '**/*.bas' },
  { scheme: 'file', pattern: '**/*.BAS' },
  ...LANGUAGES.map((language) => ({ scheme: 'file', language })),
];

const isBasic = (d: vscode.TextDocument): boolean => d.uri.scheme === 'file' && (/\.bas$/i.test(d.uri.fsPath) || LANGUAGES.includes(d.languageId));

interface MaskEntry {
  version: number;
  m: Masked;
}
const maskCache = new WeakMap<vscode.TextDocument, MaskEntry>();
function maskOf(doc: vscode.TextDocument): Masked {
  const hit = maskCache.get(doc);
  if (hit && hit.version === doc.version) return hit.m;
  const m = mask(doc.getText());
  maskCache.set(doc, { version: doc.version, m });
  return m;
}

function markdown(p: HoverParts, docsLink?: { name: string; label: string }): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendCodeblock(p.signature, 'vb');
  if (p.doc) md.appendText(p.doc).appendMarkdown('\n\n');
  if (p.notes.length) md.appendMarkdown('*').appendText(p.notes.join(' ')).appendMarkdown('*\n\n');
  if (p.details) md.appendText(p.details.length > 1200 ? p.details.slice(0, 1200) + ' ...' : p.details).appendMarkdown('\n\n');
  md.appendMarkdown('`').appendText(p.source).appendMarkdown('`');
  if (docsLink) {
    md.isTrusted = { enabledCommands: ['cpcbuild.docs.open'] };
    const arg = encodeURIComponent(JSON.stringify([docsLink.name]));
    md.appendMarkdown(` &nbsp;[library.md: ${docsLink.label.replace(/[[\]]/g, '')}](command:cpcbuild.docs.open?${arg})`);
  }
  return md;
}

/** Picks the routine for a name: the Spectrum variant only for Spectrum targets. */
function pick(index: LibIndex, name: string, arch?: string): LibRoutine | undefined {
  const l = index.byName.get(name.toLowerCase());
  if (!l) return undefined;
  const want = arch === 'zx48k' ? 'zx' : undefined;
  return (want && l.find((r) => r.platform === want)) || l.find((r) => r.platform !== 'zx') || l[0];
}

interface Ctx {
  info: LibraryInfo;
  arch?: 'cpc' | 'zx48k';
  own: Set<string>;
}

function ctxFor(doc: vscode.TextDocument): Ctx | undefined {
  if (!isBasic(doc)) return undefined;
  const info = libraryFor(doc.uri.fsPath);
  if (!info) return undefined;
  const text = doc.getText();
  const own = userDefinedNames(maskOf(doc).code);
  for (const n of includedUserNames(doc.uri.fsPath, text)) own.add(n);
  return { info, arch: targetFacts(info, doc.uri.fsPath).arch, own };
}

const SEVERITY: Record<string, vscode.DiagnosticSeverity | undefined> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/** Severity for a rule from `cpcbuild.lint.rules`; undefined = off. */
export function severityFor(rule: RuleId, overrides: Record<string, unknown>): vscode.DiagnosticSeverity | undefined {
  const v = overrides[rule];
  if (typeof v === 'string') {
    const k = v.toLowerCase();
    if (k === 'off') return undefined;
    if (SEVERITY[k] !== undefined) return SEVERITY[k];
  }
  return SEVERITY[RULES[rule].severity as Severity];
}

export function registerLintAndHover(context: vscode.ExtensionContext, reg: (id: string, fn: (...a: any[]) => unknown) => void): { runs(uri: vscode.Uri): number } {
  const diag = vscode.languages.createDiagnosticCollection('cpcbuild-lint');
  const timers = new Map<string, NodeJS.Timeout>();
  context.subscriptions.push(diag, { dispose: () => timers.forEach((t) => clearTimeout(t)) });

  /** Lint passes per document (the extension-host tests wait on this instead of sleeping past the debounce). */
  const runs = new Map<string, number>();

  function lintNow(doc: vscode.TextDocument): void {
    if (!isBasic(doc)) return;
    runs.set(doc.uri.toString(), (runs.get(doc.uri.toString()) ?? 0) + 1);
    const cfg = vscode.workspace.getConfiguration('cpcbuild');
    const ctx = cfg.get<boolean>('lint.enable', true) ? ctxFor(doc) : undefined;
    if (!ctx) {
      diag.delete(doc.uri);
      return;
    }
    const facts = targetFacts(ctx.info, doc.uri.fsPath);
    const overrides = cfg.get<Record<string, unknown>>('lint.rules') ?? {};
    const findings: Finding[] = lint(doc.getText(), { index: ctx.info.index, arch: facts.arch, bare: facts.bare, userNames: ctx.own });
    const ds: vscode.Diagnostic[] = [];
    for (const f of findings) {
      const sev = severityFor(f.rule, overrides);
      if (sev === undefined) continue;
      const d = new vscode.Diagnostic(new vscode.Range(f.line, f.col, f.line, f.endCol), f.message, sev);
      d.source = 'cpcbuild';
      d.code = f.rule;
      ds.push(d);
    }
    diag.set(doc.uri, ds);
  }

  function schedule(doc: vscode.TextDocument, ms = 300): void {
    if (!isBasic(doc)) return;
    const k = doc.uri.toString();
    clearTimeout(timers.get(k));
    timers.set(
      k,
      setTimeout(() => {
        timers.delete(k);
        lintNow(doc);
      }, ms),
    );
  }

  const relintAll = (): void => vscode.workspace.textDocuments.forEach((d) => lintNow(d));

  // library files change: rebuild the indexes (watch the library folders that are in use)
  const watched = new Set<string>();
  function watch(info?: LibraryInfo): void {
    for (const dir of [info?.libDir, info?.stdlibDir]) {
      if (!dir || watched.has(dir)) continue;
      watched.add(dir);
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), '**/*.{bas,md}'));
      const bump = (): void => {
        invalidateLibraries();
        relintAll();
      };
      context.subscriptions.push(w, w.onDidChange(bump), w.onDidCreate(bump), w.onDidDelete(bump));
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => {
      if (isBasic(d)) {
        watch(libraryFor(d.uri.fsPath));
        schedule(d, 20);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      clearTimeout(timers.get(d.uri.toString()));
      timers.delete(d.uri.toString());
      diag.delete(d.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cpcbuild')) {
        invalidateLibraries();
        relintAll();
      }
    }),
  );
  relintAll();
  vscode.workspace.textDocuments.forEach((d) => isBasic(d) && watch(libraryFor(d.uri.fsPath)));

  // ---- hover
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(doc, pos) {
        if (!vscode.workspace.getConfiguration('cpcbuild').get<boolean>('hover.enable', true)) return undefined;
        const ctx = ctxFor(doc);
        if (!ctx) return undefined;
        const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
        if (!range) return undefined;
        const line = maskOf(doc).code[pos.line] ?? '';
        const inCode = line[range.start.character] !== undefined && line[range.start.character].trim() !== '';
        const word = doc.getText(range);
        const lower = word.toLowerCase();
        if (ctx.own.has(lower)) return undefined; // the program's own routine shadows the library's
        const r = inCode ? pick(ctx.info.index, word, ctx.arch) : undefined;
        if (r) {
          const sec = ctx.info.docs && sectionFor(ctx.info.docs, r.name, r.file);
          return new vscode.Hover(markdown(describeRoutine(r, sec), sec ? { name: r.name, label: sec.text.replace(/`/g, '') } : undefined), range);
        }
        // a setting named in a comment or a #define
        const st = ctx.info.index.settings.find((s) => s.name === word);
        if (st) return new vscode.Hover(markdown(describeSetting(st)), range);
        return undefined;
      },
    }),
    vscode.languages.registerCompletionItemProvider(SELECTOR, {
      provideCompletionItems(doc, pos) {
        if (!vscode.workspace.getConfiguration('cpcbuild').get<boolean>('hover.enable', true)) return undefined;
        const ctx = ctxFor(doc);
        if (!ctx) return undefined;
        const code = maskOf(doc).code[pos.line] ?? '';
        const raw = doc.lineAt(pos.line).text;
        const at = Math.max(0, pos.character - 1);
        // not inside a comment or a string: the character before the cursor is code, or the line is blank there
        if (raw[at] !== undefined && code[at] !== undefined && code[at].trim() === '' && raw[at].trim() !== '') return undefined;
        if (/^\s*#/.test(raw) || /\.\w*$/.test(raw.slice(0, pos.character))) return undefined;
        const items: vscode.CompletionItem[] = [];
        const seen = new Set<string>();
        for (const r of ctx.info.index.routines) {
          const k = r.name.toLowerCase();
          if (seen.has(k) || ctx.own.has(k)) continue;
          if (!r.doc && /^(_|Cb[A-Z]|Zxs[A-Z])/.test(r.name)) continue; // library internals
          if (r.platform === 'zx' && ctx.arch !== 'zx48k') continue;
          seen.add(k);
          const it = new vscode.CompletionItem({ label: r.name, description: r.file }, vscode.CompletionItemKind.Function);
          it.detail = r.signature;
          const sec = ctx.info.docs && sectionFor(ctx.info.docs, r.name, r.file);
          it.documentation = markdown(describeRoutine(r, sec));
          it.insertText = r.name;
          it.filterText = r.name;
          items.push(it);
        }
        return items;
      },
    }),
    vscode.languages.registerSignatureHelpProvider(
      SELECTOR,
      {
        provideSignatureHelp(doc, pos) {
          if (!vscode.workspace.getConfiguration('cpcbuild').get<boolean>('hover.enable', true)) return undefined;
          const ctx = ctxFor(doc);
          if (!ctx) return undefined;
          const code = (maskOf(doc).code[pos.line] ?? '').slice(0, pos.character);
          const call = callAt(code);
          if (!call || ctx.own.has(call.name.toLowerCase())) return undefined;
          const r = pick(ctx.info.index, call.name, ctx.arch);
          if (!r) return undefined;
          const sig = new vscode.SignatureInformation(r.signature, r.doc ? new vscode.MarkdownString().appendText(r.doc) : undefined);
          sig.parameters = paramRanges(r.signature, r.params).map(([a, b]) => new vscode.ParameterInformation([a, b]));
          const help = new vscode.SignatureHelp();
          help.signatures = [sig];
          help.activeSignature = 0;
          help.activeParameter = Math.min(call.active, Math.max(0, r.params.length - 1));
          return help;
        },
      },
      '(',
      ',',
    ),
  );

  // ---- commands
  reg('cpcbuild.lint.toggle', async () => {
    const cfg = vscode.workspace.getConfiguration('cpcbuild');
    const on = !cfg.get<boolean>('lint.enable', true);
    await cfg.update('lint.enable', on, vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`CPCBuild lint is now ${on ? 'on' : 'off'}.`);
    return { enabled: on };
  });
  reg('cpcbuild.docs.open', async (name?: unknown) => {
    const ed = vscode.window.activeTextEditor;
    const file = ed && isBasic(ed.document) ? ed.document.uri.fsPath : undefined;
    const info = file ? libraryFor(file) : undefined;
    if (!info?.index || !info.docs || !info.docsFile) {
      void vscode.window.showInformationMessage('CPCBuild: library docs not found. Open a .bas file in a cpcbuild project, or set "cpcbuild.library.path".');
      return undefined;
    }
    let target = typeof name === 'string' ? name : undefined;
    if (!target && ed) {
      const r = ed.document.getWordRangeAtPosition(ed.selection.active, /[A-Za-z_]\w*/);
      const w = r && ed.document.getText(r);
      if (w && info.index.byName.has(w.toLowerCase())) target = w;
    }
    if (!target) {
      const pickItem = await vscode.window.showQuickPick(
        info.index.routines.filter((r) => r.doc).map((r) => ({ label: r.name, description: r.signature, detail: r.doc.split('\n')[0] })),
        { title: 'CPCBuild: library routine', matchOnDescription: true },
      );
      target = pickItem?.label;
    }
    if (!target) return undefined;
    const r = info.index.byName.get(target.toLowerCase())?.[0];
    const sec = sectionFor(info.docs, target, r?.file);
    if (!sec) {
      void vscode.window.showInformationMessage(`CPCBuild: ${target} is not in docs/library.md; its header in ${r?.file ?? 'the library'} is the reference.`);
      return undefined;
    }
    const pos = new vscode.Position(sec.line, 0);
    await vscode.window.showTextDocument(vscode.Uri.file(info.docsFile), { selection: new vscode.Range(pos, pos), preview: true });
    return { file: info.docsFile, line: sec.line, heading: sec.text };
  });
  return { runs: (uri) => runs.get(uri.toString()) ?? 0 };
}
