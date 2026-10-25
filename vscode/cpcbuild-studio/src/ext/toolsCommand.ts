/** toolsCommand.ts -- "CPC Game Studio: Download Tools": the pick, the progress notification and the messages (toolsInstall.ts does the work). */
import * as vscode from 'vscode';
import { ArchiveError } from '../core/archive';
import { assetForKey, toolsPlatform, ToolsManifest } from '../core/tools';
import { arkosUnavailableText } from './arkos';
import { getChannel } from './channel';
import { manifest as shipped, toolsRoot } from './config';
import { DownloadError, proxyFor, ChecksumError } from './download';
import { arkosInstalled, failureText, installArkos, installZxbasic, NoToolsError, Part, partName, RELEASES_URL, zxbasicInstalled } from './toolsInstall';

/** What the command takes (tests and scripts; a click passes nothing). */
export interface DownloadToolsArgs {
  /** Replaces the manifest that ships with Studio (tests serve a fake archive from a local HTTP server). */
  manifest?: ToolsManifest;
  /** Replaces <globalStorage>/tools. */
  root?: string;
  /** Install these without asking. */
  parts?: Part[];
  /** Never ask or show messages. */
  quiet?: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
}

export interface DownloadToolsResult {
  ok: boolean;
  /** The message that was (or would have been) shown. */
  message: string;
  installed: Part[];
  /** zxbc --version of the installed compiler. */
  version?: string;
  failed?: Part;
}

let running: Promise<DownloadToolsResult> | undefined;

const mb = (n: number): string => (n / 1048576).toFixed(1);

async function run(args: DownloadToolsArgs): Promise<DownloadToolsResult> {
  const root = args.root ?? toolsRoot();
  const m = args.manifest ?? shipped;
  const platform = args.platform ?? process.platform;
  const arch = args.arch ?? process.arch;
  const quiet = !!args.quiet;
  const out = getChannel();
  const fail = (message: string, part?: Part, button?: Part): DownloadToolsResult => {
    out.appendLine(message);
    if (!quiet) {
      void vscode.window.showErrorMessage(message, ...(button ? ['Open Releases Page'] : [])).then((c) => {
        if (c && button) void vscode.env.openExternal(vscode.Uri.parse(RELEASES_URL[button]));
      });
    }
    return { ok: false, message, installed: [], failed: part };
  };
  if (!root) return fail('CPC Game Studio: there is no storage folder to install the tools into.');

  const key = toolsPlatform(platform, arch);
  const hasArkos = !!key && !!assetForKey(m.arkos, key);
  const hasZx = !!key && !!assetForKey(m.zxbasic, key);
  let parts = args.parts;
  if (!parts) {
    const items = [
      ...(hasZx ? [{ part: 'zxbasic' as Part, label: `Boriel BASIC compiler ${m.zxbasic.version} (zxbc, zxbasm, mkdsk)`, installed: zxbasicInstalled(root, m, platform) }] : []),
      ...(hasArkos ? [{ part: 'arkos' as Part, label: `Arkos Tracker ${m.arkos.version} command-line tools (music conversion)`, installed: arkosInstalled(root, m, platform) }] : []),
    ];
    if (!hasArkos && !quiet) void vscode.window.showWarningMessage(`CPC Game Studio: ${arkosUnavailableText(`${platform}-${arch}`)}`);
    if (!items.length) return fail(`CPC Game Studio: there are no tools for ${platform}-${arch}. Download the SDK zip from the releases page.`, 'zxbasic', 'zxbasic');
    if (quiet) parts = items.filter((i) => !i.installed).map((i) => i.part);
    else {
      const picked = await vscode.window.showQuickPick(
        items.map((i) => ({ label: i.label, description: i.installed ? 'installed' : undefined, picked: !i.installed, part: i.part })),
        { canPickMany: true, title: 'CPC Game Studio: Download Tools', placeHolder: 'Choose what to download' },
      );
      if (!picked?.length) return { ok: true, message: 'CPC Game Studio: nothing chosen, nothing downloaded.', installed: [] };
      parts = picked.map((p) => p.part);
    }
  }
  if (!parts.length) return { ok: true, message: 'CPC Game Studio: the tools are already installed.', installed: [] };

  const installed: Part[] = [];
  let version: string | undefined;
  for (const part of parts) {
    const name = partName(part, m);
    out.appendLine(`Downloading ${name}...`);
    try {
      const url = (m[part].assets as Record<string, { url: string } | undefined>)[key ?? '']?.url ?? '';
      const proxy = url ? proxyFor(url, vscode.workspace.getConfiguration('http').get<string>('proxy')) : undefined;
      const work = (onProgress: (part: Part, r: number, t: number | undefined) => void, token?: vscode.CancellationToken) =>
        (part === 'zxbasic' ? installZxbasic : installArkos)({ manifest: m, root, platform, arch, proxy, token, sink: { line: (t) => out.appendLine(t) }, onProgress });
      const res = quiet
        ? await work(() => undefined)
        : await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `CPC Game Studio: downloading ${name}`, cancellable: true }, async (progress, token) => {
            let last = 0;
            return work((_p, r, t) => {
              const pct = t ? Math.floor((r / t) * 100) : 0;
              progress.report({ message: t ? `${mb(r)} of ${mb(t)} MB` : `${mb(r)} MB`, increment: pct - last });
              last = pct;
            }, token);
          });
      installed.push(part);
      if (part === 'zxbasic') {
        version = res.version;
        out.appendLine(res.version ? `Installed ${res.dir}: ${res.version}` : `Installed ${res.dir}`);
        if (res.versionError) {
          const msg = `CPC Game Studio: ${name} was installed, but zxbc could not be started: ${res.versionError}`;
          out.appendLine(msg);
          if (!quiet) void vscode.window.showWarningMessage(msg);
        }
      } else out.appendLine(`Installed ${res.dir}`);
    } catch (e) {
      if (e instanceof DownloadError && e.cancelled) {
        const message = `CPC Game Studio: the download of ${name} was cancelled.`;
        out.appendLine(message);
        return { ok: false, message, installed, failed: part };
      }
      const r = fail(failureText(e, part, m), part, e instanceof ChecksumError || e instanceof ArchiveError || e instanceof NoToolsError ? undefined : part);
      return { ...r, installed };
    }
  }
  const message = `CPC Game Studio: tools installed: ${installed.map((p) => partName(p, m)).join(', ')}.`;
  out.appendLine(message);
  if (!quiet) void vscode.window.showInformationMessage(message);
  return { ok: true, message, installed, version };
}

/** CPC Game Studio: Download Tools. One run at a time (a second click joins the first). */
export function downloadToolsCommand(arg?: DownloadToolsArgs): Promise<DownloadToolsResult> {
  const args = arg && typeof arg === 'object' && !('scheme' in arg) ? arg : {};
  if (running) return running;
  running = run(args).finally(() => (running = undefined));
  return running;
}
