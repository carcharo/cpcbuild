/** tasks.ts -- the `cpcbuild` task type: build (and optionally run) a target of cpcbuild.json. */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildTarget } from './build';
import { getChannel, channelSink, tee } from './channel';
import { readSettings } from './config';
import { findProjects, LoadedProject, pickProject, selectedTarget } from './projects';
import { runInEmulator } from './run';
import { Sink } from './runTool';
import { state } from './state';
import { isTrusted, notifyUntrusted, restrictedText } from './trust';
import { runInZxEmulator } from './zxRun';

export const TASK_TYPE = 'cpcbuild';

export interface CpcbuildTaskDefinition extends vscode.TaskDefinition {
  /** Target id; default = the selected target. */
  target?: string;
  /** Run in the emulator after a successful build. */
  run?: boolean;
  /** Folder holding cpcbuild.json (absolute or relative to the workspace folder); default = the project of the active editor. */
  project?: string;
}

function resolveProject(projects: LoadedProject[], def: CpcbuildTaskDefinition, wsFolder?: string): LoadedProject | undefined {
  if (def.project) {
    const root = path.isAbsolute(def.project) ? def.project : path.resolve(wsFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', def.project);
    return projects.find((p) => path.resolve(p.root) === path.resolve(root));
  }
  const within = wsFolder ? projects.filter((p) => p.root === wsFolder || p.root.startsWith(wsFolder + path.sep)) : projects;
  return pickProject(within.length ? within : projects);
}

/** Runs the task body; resolves to the process exit code (0 = built, and ran if asked). */
export async function executeBuild(def: CpcbuildTaskDefinition, sink: Sink, token?: vscode.CancellationToken, wsFolder?: string): Promise<number> {
  const projects = await findProjects();
  const lp = resolveProject(projects, def, wsFolder);
  if (!lp) {
    sink.line(`No ${'cpcbuild.json'} found${def.project ? ` at "${def.project}"` : ' in this workspace'}. Create a project with "CPCBuild: New Project", or add a cpcbuild.json.`, true);
    return 1;
  }
  if (!lp.project) {
    sink.line(`${lp.file} has problems:`, true);
    for (const e of lp.errors) sink.line(`  ${e.path ? e.path + ': ' : ''}${e.message}`, true);
    return 1;
  }
  const s = readSettings(lp.root);
  const target = def.target ? lp.project.targets.find((t) => t.id === def.target) : selectedTarget(lp, s.targetDefault);
  if (!target) {
    sink.line(`Target "${def.target}" is not in ${lp.file}. Targets: ${lp.project.targets.map((t) => t.id).join(', ')}.`, true);
    return 1;
  }
  for (const n of lp.notes) sink.line(`note: ${n.message}`);
  const res = await buildTarget(lp.root, lp.project, target, sink, token, s);
  state.lastBuild = res;
  if (!res.ok) return 1;
  if (def.run) return (await runLast(sink, lp.project.library)) ? 0 : 1;
  return 0;
}

/** Runs the last build's artifact in the selected emulator. */
export async function runLast(sink: Sink, library?: string | null): Promise<boolean> {
  const b = state.lastBuild;
  if (!b || !b.ok) {
    sink.line('Nothing to run: build a target first ("CPCBuild: Build").', true);
    return false;
  }
  if (!b.run && b.artifacts.tap) {
    if (!isTrusted()) {
      notifyUntrusted('Run in a Spectrum emulator');
      sink.line(`Run failed: ${restrictedText('Running in a Spectrum emulator')}`, true);
      return false;
    }
    const out = await runInZxEmulator(readSettings(b.root), b.artifacts.tap, sink);
    if (!out.ok) {
      sink.line(`Target ${b.targetId} built ${path.basename(b.artifacts.tap)}, but ${out.message}`, true);
      return false;
    }
    sink.line(`Started ${path.basename(b.artifacts.tap)} in ${readSettings(b.root).zxEmulator}`);
    return true;
  }
  if (!b.run) {
    sink.line(`Target ${b.targetId} has no disc or cartridge to run (Spectrum and raw .bin targets are build-only).`, true);
    return false;
  }
  const out = await runInEmulator(b.root, b.run, sink, undefined, library);
  if (!out.ok) {
    sink.line(`Run failed: ${out.message}`, true);
    return false;
  }
  sink.line(`Started ${path.basename(b.run.file)} in ${out.used}`);
  return true;
}

class BuildTerminal implements vscode.Pseudoterminal {
  private write = new vscode.EventEmitter<string>();
  private close_ = new vscode.EventEmitter<number>();
  private cancel = new vscode.CancellationTokenSource();
  onDidWrite = this.write.event;
  onDidClose = this.close_.event;

  constructor(private def: CpcbuildTaskDefinition, private wsFolder?: string) {}

  open(): void {
    const term: Sink = { line: (t) => this.write.fire(t.replace(/\r?\n/g, '\r\n') + '\r\n') };
    getChannel().appendLine(`--- ${new Date().toLocaleTimeString()} build ${this.def.target ?? '(selected target)'} ---`);
    executeBuild(this.def, tee(term, channelSink), this.cancel.token, this.wsFolder)
      .then((code) => this.close_.fire(code))
      .catch((e: Error) => {
        term.line(`Internal error: ${e.message}`);
        this.close_.fire(1);
      });
  }

  close(): void {
    this.cancel.cancel();
  }
}

export function createTask(def: CpcbuildTaskDefinition, scope: vscode.WorkspaceFolder | vscode.TaskScope.Workspace, label: string): vscode.Task {
  const folder = typeof scope === 'object' ? scope.uri.fsPath : undefined;
  const task = new vscode.Task(def, scope, label, TASK_TYPE, new vscode.CustomExecution(async () => new BuildTerminal(def, folder)), '$zxbc');
  task.group = vscode.TaskGroup.Build;
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true, showReuseMessage: false };
  return task;
}

export class CpcbuildTaskProvider implements vscode.TaskProvider {
  async provideTasks(): Promise<vscode.Task[]> {
    const tasks: vscode.Task[] = [];
    for (const lp of await findProjects()) {
      if (!lp.project) continue;
      const wf = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(lp.file));
      const scope = wf ?? vscode.TaskScope.Workspace;
      const rel = wf ? path.relative(wf.uri.fsPath, lp.root) : lp.root;
      for (const t of lp.project.targets) {
        const proj = rel === '' ? '.' : rel;
        tasks.push(createTask({ type: TASK_TYPE, target: t.id, ...(proj ? { project: proj } : {}) }, scope, `build ${t.id}`));
        if (t.package === 'dsk' || t.package === 'cpr' || t.package === 'tap') {
          tasks.push(createTask({ type: TASK_TYPE, target: t.id, run: true, ...(proj ? { project: proj } : {}) }, scope, `build and run ${t.id}`));
        }
      }
    }
    return tasks;
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const def = task.definition as CpcbuildTaskDefinition;
    if (def.type !== TASK_TYPE) return undefined;
    const label = `${def.run ? 'build and run' : 'build'} ${def.target ?? '(selected target)'}`;
    const scope = task.scope && typeof task.scope === 'object' ? task.scope : vscode.TaskScope.Workspace;
    return createTask(def, scope, task.name || label);
  }
}
