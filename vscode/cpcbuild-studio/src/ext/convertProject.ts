/**
 * convertProject.ts -- "CPC Game Studio: Convert Project to CPC BASIC". Runs the compiler package's translator over the
 * project's sources (core/convert.ts does the work), shows the report, and writes only after the user accepts it:
 * the files that changed, and on a yes the project file without its Spectrum targets.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadRuntime, readTree } from '@cpcbuild/cpcbas/node';
import { convertSources, formatReport, hasSpectrumTargets, mustFix, removeSpectrumTargets, targetChecks, type ConvertResult } from '../core/convert';
import { bundledLibrary } from './config';
import { findProjects, PROJECT_FILE } from './projects';
import { findProjectRoot } from './library';

export interface ConvertArgs {
  /** The project folder (default: the one of the active editor or of the clicked cpcbuild.json, else a choice among the workspace's projects). */
  root?: string;
  /** Answers, so that a test (or a script) can run it without the questions. Without `from`, the first question is asked. */
  from?: 'boriel' | 'auto';
  /** Write after the preview without asking. */
  write?: boolean;
  /** Remove the Spectrum targets without asking. */
  removeSpectrum?: boolean;
}

export interface ConvertOutcome {
  root: string;
  dialect: 'boriel' | 'cpcbas';
  /** Project-relative paths written. */
  written: string[];
  removedTargets: string[];
  /** Must-fix findings (W720-W725) left in the converted project. */
  mustFix: number;
  report: string;
}

/** The questions and the report window; the extension-host tests replace these. */
export const convertUi = {
  /** "Is this a 0.1.x (Boriel BASIC) project?" `guess`: the sources read as Boriel BASIC (Yes is then the first choice). */
  async askBoriel(guess: boolean): Promise<'boriel' | 'auto' | undefined> {
    const yes = { label: 'Yes: a 0.1.x (Boriel BASIC) project', description: guess ? 'the sources read as Boriel BASIC' : '', v: 'boriel' as const };
    const no = { label: 'No: it is CPC BASIC already', description: guess ? '' : 'the sources read as CPC BASIC', v: 'auto' as const };
    const pick = await vscode.window.showQuickPick(guess ? [yes, no] : [no, yes], { title: 'Convert Project to CPC BASIC', placeHolder: 'Is this a 0.1.x (Boriel BASIC) project?' });
    return pick?.v;
  },
  async confirmWrite(files: number, mustFix: number): Promise<boolean> {
    const ans = await vscode.window.showInformationMessage(
      `Write the converted files? ${files} file(s) change${mustFix ? `; ${mustFix} finding(s) need you` : ''}. The report is open for you to read first.`,
      { modal: true },
      'Write',
    );
    return ans === 'Write';
  },
  async confirmRemove(ids: string[]): Promise<boolean> {
    const ans = await vscode.window.showInformationMessage(
      `Remove the Spectrum target(s) ${ids.join(', ')} from ${PROJECT_FILE}? CPCBuild 0.2.0 builds for the CPC only; the 0.1.x tools still build them.`,
      { modal: true },
      'Remove',
      'Keep',
    );
    return ans === 'Remove';
  },
  async showReport(text: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true });
  },
};

async function pickRoot(arg: unknown, args?: ConvertArgs): Promise<string | undefined> {
  if (args?.root) return args.root;
  if (arg instanceof vscode.Uri) return path.dirname(arg.fsPath);
  const ed = vscode.window.activeTextEditor?.document.uri;
  const near = ed?.scheme === 'file' ? findProjectRoot(ed.fsPath) : undefined;
  if (near) return near;
  const ps = await findProjects();
  if (ps.length === 1) return ps[0].root;
  if (!ps.length) {
    void vscode.window.showInformationMessage(`CPC Game Studio: no ${PROJECT_FILE} in this workspace.`);
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    ps.map((p) => ({ label: path.basename(p.root), description: p.root, root: p.root })),
    { title: 'Convert Project to CPC BASIC: which project?' },
  );
  return pick?.root;
}

/** Runs the conversion; undefined when the user cancelled or there was nothing to do. */
export async function convertProjectCommand(arg?: unknown, args?: ConvertArgs): Promise<ConvertOutcome | undefined> {
  const root = await pickRoot(arg, args);
  if (!root) return undefined;
  const bundled = bundledLibrary();
  if (!bundled) {
    void vscode.window.showErrorMessage('CPC Game Studio: the bundled library was not found, so the converted project cannot be checked.');
    return undefined;
  }
  const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && d.uri.scheme === 'file' && d.uri.fsPath.startsWith(root + path.sep));
  if (dirty.length && !args) {
    void vscode.window.showWarningMessage(`CPC Game Studio: save the open files of this project first (${dirty.length} unsaved), then convert.`);
    return undefined;
  }
  const projectFile = path.join(root, PROJECT_FILE);
  const projectText = fs.existsSync(projectFile) ? fs.readFileSync(projectFile, 'utf8') : undefined;
  const files = readTree(root);
  if (!files.size) {
    void vscode.window.showInformationMessage('CPC Game Studio: this project has no .bas files.');
    return undefined;
  }

  // 1. Is it Boriel BASIC? A run that reads the sources as it finds them guesses; the user answers (Yes first when the run read Boriel).
  let from = args?.from;
  if (!from) {
    from = await convertUi.askBoriel(convertSources(files, { from: 'auto' }).dialect === 'boriel');
    if (!from) return undefined;
  }

  // 2. The translation and its compile check (the main file and the defines of each target, the bundled library).
  const result: ConvertResult = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Converting to CPC BASIC...' }, async () =>
    convertSources(files, { from: from!, runtime: loadRuntime(path.join(bundled, 'lib')), checks: targetChecks(projectText) }),
  );
  const fix = mustFix(result.report);
  const spectrum = projectText && hasSpectrumTargets(projectText) ? removeSpectrumTargets(projectText) : undefined;
  const reportText = [
    'CPC Game Studio: Convert Project to CPC BASIC',
    `Project: ${root}`,
    '',
    result.changed.size ? `Files that will change (${result.changed.size}):` : 'No file changes.',
    ...[...result.changed.keys()].map((f) => `  ${f}`),
    ...(spectrum ? ['', `cpcbuild.json: the Spectrum target(s) ${spectrum.removed.join(', ')} can be removed.`] : []),
    '',
    fix.length ? `${fix.length} finding(s) must be fixed by hand before this builds (W720-W725):` : 'No finding stops the build.',
    '',
    formatReport(result.report),
  ].join('\n');
  const outcome = (written: string[], removedTargets: string[]): ConvertOutcome => ({ root, dialect: result.dialect, written, removedTargets, mustFix: fix.length, report: reportText });

  // 3. The preview, then the question: nothing is written before the yes.
  await convertUi.showReport(reportText);
  if (!result.changed.size && !spectrum) {
    void vscode.window.showInformationMessage(fix.length ? `CPC Game Studio: nothing to rewrite; ${fix.length} finding(s) need a person (see the report).` : 'CPC Game Studio: this project is already CPC BASIC; nothing to change.');
    return outcome([], []);
  }
  const write = args?.write ?? (await convertUi.confirmWrite(result.changed.size, fix.length));
  if (!write) return undefined;
  const removeSpectrum = spectrum ? (args?.removeSpectrum ?? (await convertUi.confirmRemove(spectrum.removed))) : false;

  const written: string[] = [];
  for (const [rel, text] of result.changed) {
    fs.writeFileSync(path.join(root, ...rel.split('/')), text);
    written.push(rel);
  }
  const removedTargets: string[] = [];
  if (spectrum && removeSpectrum) {
    fs.writeFileSync(projectFile, spectrum.text);
    removedTargets.push(...spectrum.removed);
    written.push(PROJECT_FILE);
  }
  void vscode.window.showInformationMessage(
    `CPC Game Studio: converted ${result.changed.size} file(s)${removedTargets.length ? ` and removed ${removedTargets.join(', ')}` : ''}.` + (fix.length ? ` ${fix.length} finding(s) need you: see the report.` : ' Build to check it.'),
  );
  return outcome(written, removedTargets);
}
