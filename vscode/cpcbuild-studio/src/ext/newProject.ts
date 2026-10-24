/** newProject.ts -- "CPC Game Studio: New Project" (spec 4.5). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { generateTemplate, TEMPLATES, TemplateId } from '../core/templates';

export interface NewProjectArgs {
  template?: TemplateId;
  name?: string;
  /** Parent folder; the project goes into <parent>/<name>. */
  parent?: string;
  /** Skip the "folder is not empty" question (tests). */
  force?: boolean;
}

export interface NewProjectResult {
  dir: string;
  disc: string;
  files: string[];
}

export function folderName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || 'myproject';
}

/** Writes a template into <parent>/<name>; throws on an existing non-empty folder unless `force`. */
export function writeTemplate(id: TemplateId, name: string, parent: string, force = false): NewProjectResult {
  const dir = path.join(parent, folderName(name));
  if (!force && fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new Error(`the folder ${dir} is not empty`);
  }
  const t = generateTemplate(id, { name });
  for (const [rel, text] of Object.entries(t.files)) {
    const f = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return { dir, disc: t.disc, files: Object.keys(t.files) };
}

export async function newProjectCommand(args?: NewProjectArgs): Promise<NewProjectResult | undefined> {
  let id = args?.template;
  if (!id) {
    const pick = await vscode.window.showQuickPick(
      TEMPLATES.map((t) => ({ label: t.label, description: t.description, id: t.id })),
      { title: 'CPC Game Studio: New Project', placeHolder: 'Choose a template' },
    );
    if (!pick) return undefined;
    id = pick.id;
  }
  let name = args?.name;
  if (name === undefined) {
    name = await vscode.window.showInputBox({
      title: 'Project name', value: 'mygame', prompt: 'Also the folder name. The disc name is derived from it (upper-case letters and digits, at most 8).',
      validateInput: (v) => (v.trim() ? undefined : 'Enter a name'),
    });
    if (!name) return undefined;
  }
  let parent = args?.parent;
  if (!parent) {
    const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Create project here', title: 'Parent folder for the new project' });
    if (!pick?.length) return undefined;
    parent = pick[0].fsPath;
  }
  let force = args?.force ?? false;
  const dir = path.join(parent, folderName(name));
  if (!force && fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    const ans = await vscode.window.showWarningMessage(`${dir} is not empty. Create the project there anyway? Existing files with the same names are overwritten.`, { modal: true }, 'Create anyway');
    if (ans !== 'Create anyway') return undefined;
    force = true;
  }
  try {
    const r = writeTemplate(id, name, parent, force);
    if (!args) {
      const act = await vscode.window.showInformationMessage(`Created ${r.dir}. Disc name: ${r.disc} (run"${r.disc}).`, 'Open Folder');
      if (act) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(r.dir), { forceNewWindow: false });
    }
    return r;
  } catch (e) {
    void vscode.window.showErrorMessage(`CPC Game Studio: could not create the project: ${(e as Error).message}.`);
    return undefined;
  }
}
