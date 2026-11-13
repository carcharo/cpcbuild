/**
 * settingsMigration.ts -- the old `cpcbuild.zxbc.args` setting (the Boriel BASIC compiler's options) is not read any
 * more. If a workspace or the user still has it and no `cpcbuild.compiler.args`, one message per workspace shows what
 * the same options look like for cpcbas and offers to copy them. Nothing is written without that click.
 */
import * as vscode from 'vscode';
import { translateZxbcArgs, zxbcMigrationMessage } from '../core/zxbcArgs';

export const COPY_BUTTON = 'Copy to cpcbuild.compiler.args';
const SEEN_KEY = 'cpcbuild.zxbcArgsMigration';

export interface MigrationUi {
  show(message: string, ...buttons: string[]): Thenable<string | undefined>;
}

const realUi: MigrationUi = { show: (m, ...b) => vscode.window.showInformationMessage(m, ...b) };
let ui: MigrationUi = realUi;
const shown: { message: string; buttons: string[] }[] = [];

/** What the user's settings hold for the old option, and whether the new one is already set. */
function oldArgs(): { args: string[]; scope: vscode.ConfigurationTarget } | undefined {
  const c = vscode.workspace.getConfiguration('cpcbuild');
  const hasNew = (v: { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined): boolean =>
    !!v && (v.globalValue !== undefined || v.workspaceValue !== undefined || v.workspaceFolderValue !== undefined);
  if (hasNew(c.inspect('compiler.args'))) return undefined;
  const old = c.inspect<unknown>('zxbc.args');
  const pick = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length ? (v as string[]) : undefined);
  const ws = pick(old?.workspaceFolderValue) ?? pick(old?.workspaceValue);
  if (ws) return { args: ws, scope: vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global };
  const g = pick(old?.globalValue);
  return g ? { args: g, scope: vscode.ConfigurationTarget.Global } : undefined;
}

/** Test hooks (reached through the extension's exports). */
export const settingsMigrationTestApi = {
  setUi(u: MigrationUi | undefined): void {
    ui = u ?? realUi;
  },
  shown: (): { message: string; buttons: string[] }[] => [...shown],
  reset(): void {
    shown.length = 0;
  },
  /** Runs the check with a store standing in for workspaceState. */
  offer: (store: Pick<vscode.Memento, 'get' | 'update'>): Promise<boolean> => offerArgsMigration(store),
};

/** Shows the message once per workspace. Returns true when it was shown. */
export async function offerArgsMigration(store: Pick<vscode.Memento, 'get' | 'update'>): Promise<boolean> {
  if (store.get<boolean>(SEEN_KEY)) return false;
  const old = oldArgs();
  if (!old) return false;
  await store.update(SEEN_KEY, true);
  const t = translateZxbcArgs(old.args);
  const message = zxbcMigrationMessage(t);
  const buttons = t.args.length ? [COPY_BUTTON] : [];
  shown.push({ message, buttons });
  void ui.show(message, ...buttons).then(async (pick) => {
    if (pick === COPY_BUTTON) await vscode.workspace.getConfiguration('cpcbuild').update('compiler.args', t.args, old.scope);
  });
  return true;
}
