/**
 * toolsInstall.ts -- "CPCBuild: Download Tools" without the UI: download the compiler bundle and the Arkos
 * command-line tools from the manifest, verify their SHA-256, extract them with Node built-ins only and move
 * them into <globalStorage>/tools/ atomically (rename), deleting older versions. No vscode import (unit-testable).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArchiveEntry, ArchiveError } from '../core/archive';
import { arkosDirName, isPinned, ToolAsset, ToolPart, ToolsManifest, ToolsPlatform, toolsPlatform, zxbasicDirName } from '../core/tools';
import { readTarGz } from '../core/tar';
import { readZip } from '../core/zip';
import { arkosToolPath, arkosUnavailableText } from './arkos';
import { ChecksumError, download, DownloadError } from './download';
import { CancelToken, runTool, Sink } from './runTool';
import { exeName } from './toolpaths';

export type Part = 'zxbasic' | 'arkos';

/** The tool's name as the messages call it. */
export const partName = (part: Part, m: ToolsManifest): string => (part === 'zxbasic' ? `Boriel BASIC ${m.zxbasic.version}` : `Arkos ${m.arkos.version}`);

/** Where to send the user when the download fails. */
export const RELEASES_URL = { zxbasic: 'https://github.com/carcharo/zxbasic/releases', arkos: 'https://www.julien-nevo.com/arkostracker/' } as const;

/** The manifest has no checksum for this entry yet (scripts/pin-compiler.mjs fills them): downloading it unchecked is refused. */
export class UnpinnedError extends Error {
  constructor(readonly part: Part) {
    super(`the checksum of the ${part === 'zxbasic' ? 'compiler' : 'Arkos'} download is not pinned in this version of Studio`);
  }
}
/** No download for this platform (Arkos on linux-arm64, or an unsupported OS). */
export class NoToolsError extends Error {
  constructor(readonly part: Part, readonly platform: string) {
    super(`no ${part} tools for ${platform}`);
  }
}

export interface InstallOptions {
  manifest: ToolsManifest;
  /** <globalStorage>/tools */
  root: string;
  platform?: NodeJS.Platform;
  arch?: string;
  proxy?: string;
  token?: CancelToken;
  sink?: Sink;
  onProgress?(part: Part, received: number, total: number | undefined): void;
}

export interface Installed {
  dir: string;
  /** zxbc --version, first line (compiler only). */
  version?: string;
  /** Why zxbc --version failed, when it did. */
  versionError?: string;
}

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

export const zxbasicDir = (root: string, m: ToolsManifest): string => path.join(root, zxbasicDirName(m.zxbasic.version));
export const arkosBinDir = (root: string, m: ToolsManifest): string => path.join(root, arkosDirName(m.arkos.version), 'bin');

export function zxbasicInstalled(root: string, m: ToolsManifest, platform: NodeJS.Platform = process.platform): boolean {
  return isFile(path.join(zxbasicDir(root, m), exeName('zxbc', platform)));
}

export function arkosInstalled(root: string, m: ToolsManifest, platform: NodeJS.Platform = process.platform): boolean {
  const d = arkosBinDir(root, m);
  return [exeName('SongToAkg', platform), exeName('SongToSoundEffects', platform)].every((n) => isFile(path.join(d, n)));
}

/** The asset for this machine (throws NoToolsError / UnpinnedError). */
export function assetFor(part: Part, m: ToolsManifest, platform: NodeJS.Platform, arch: string): ToolAsset {
  const key = toolsPlatform(platform, arch);
  const asset = key && (m[part] as ToolPart).assets[key as ToolsPlatform];
  if (!asset) throw new NoToolsError(part, `${platform}-${arch}`);
  if (!isPinned(asset)) throw new UnpinnedError(part);
  return asset;
}

/**
 * Extracts entries below `dest` (created): files with their unix mode, directories, and symlinks whose target
 * stays inside `dest` (macOS PyInstaller bundles link _internal/Python into Python.framework). A link that
 * points outside, or an absolute one, refuses the archive. On Windows links are skipped (none are shipped).
 */
export function extractEntries(entries: readonly ArchiveEntry[], dest: string, strip = 0, platform: NodeJS.Platform = process.platform): { files: number; links: number; skippedLinks: number } {
  fs.mkdirSync(dest, { recursive: true });
  const root = path.resolve(dest);
  const inside = (p: string): boolean => p === root || p.startsWith(root + path.sep);
  let files = 0;
  let skippedLinks = 0;
  const links: [string, string][] = [];
  for (const e of entries) {
    const rel = e.path.split('/').slice(strip).join('/');
    if (!rel) continue;
    const target = path.resolve(root, ...rel.split('/'));
    if (!inside(target)) throw new ArchiveError(`unsafe path in the archive: ${e.path}`);
    if (e.kind === 'symlink') {
      const to = e.linkTarget ?? '';
      if (!to || path.isAbsolute(to) || /^[A-Za-z]:/.test(to) || !inside(path.resolve(path.dirname(target), to))) {
        throw new ArchiveError(`unsafe link in the archive: ${e.path} -> ${to}`);
      }
      if (platform === 'win32') skippedLinks++;
      else links.push([target, to]);
      continue;
    }
    if (e.kind === 'dir') {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data());
    if (platform !== 'win32') fs.chmodSync(target, (e.mode || 0o644) | 0o600);
    files++;
  }
  // links last, so no file is ever written through one
  for (const [at, to] of links) {
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.rmSync(at, { force: true });
    fs.symlinkSync(to, at);
  }
  return { files, links: links.length, skippedLinks };
}

/** The archive's entries (.zip or .tar.gz by the URL's ending). */
export function readArchive(file: string, url: string): ArchiveEntry[] {
  const buf = fs.readFileSync(file);
  return /\.zip$/i.test(new URL(url).pathname) ? readZip(buf) : readTar(buf);
}
const readTar = readTarGz;

/** The one folder every entry lives in (`zxbasic/`), if there is one: how many leading segments to strip. */
export function commonTop(entries: readonly ArchiveEntry[]): number {
  const tops = new Set(entries.map((e) => e.path.split('/')[0]));
  return tops.size === 1 && entries.every((e) => e.path.includes('/') || e.kind === 'dir') ? 1 : 0;
}

/** Moves `staged` to `final`: an existing `final` is moved aside first and removed once the new one is in place. */
function swapIn(staged: string, final: string): void {
  const old = fs.existsSync(final) ? `${final}.old-${process.pid}` : undefined;
  if (old) fs.renameSync(final, old);
  try {
    fs.renameSync(staged, final);
  } catch (e) {
    if (old) fs.renameSync(old, final);
    throw e;
  }
  if (old) fs.rmSync(old, { recursive: true, force: true });
}

/** Deletes `<prefix>*` folders of root other than `keep` (older versions, leftovers). */
function dropOthers(root: string, prefix: string, keep: string): void {
  for (const n of fs.readdirSync(root)) if (n.startsWith(prefix) && n !== keep) fs.rmSync(path.join(root, n), { recursive: true, force: true });
}

/** Downloads `asset` into a fresh staging folder under root; returns the archive path. Cleans up after itself on failure. */
async function fetchAsset(part: Part, asset: ToolAsset, o: InstallOptions, staging: string): Promise<string> {
  const file = path.join(staging, `download${/\.tar\.gz$/i.test(asset.url) ? '.tar.gz' : '.zip'}`);
  await download({ url: asset.url, dest: file, sha256: asset.sha256, proxy: o.proxy, token: o.token, onProgress: (r, t) => o.onProgress?.(part, r, t) });
  return file;
}

const newStaging = (root: string): string => {
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, '.staging-'));
};

export async function installZxbasic(o: InstallOptions): Promise<Installed> {
  const platform = o.platform ?? process.platform;
  const asset = assetFor('zxbasic', o.manifest, platform, o.arch ?? process.arch);
  const staging = newStaging(o.root);
  try {
    const file = await fetchAsset('zxbasic', asset, o, staging);
    const entries = readArchive(file, asset.url);
    const out = path.join(staging, 'out');
    extractEntries(entries, out, commonTop(entries));
    for (const n of ['zxbc', 'zxbasm', 'zxbpp', 'mkdsk']) {
      const exe = path.join(out, exeName(n, platform));
      if (isFile(exe) && platform !== 'win32') fs.chmodSync(exe, 0o755);
    }
    if (!isFile(path.join(out, exeName('zxbc', platform)))) throw new ArchiveError(`the archive holds no ${exeName('zxbc', platform)}`);
    const final = zxbasicDir(o.root, o.manifest);
    swapIn(out, final);
    dropOthers(o.root, 'zxbasic-', path.basename(final));
    const r = await runTool([path.join(final, exeName('zxbc', platform))], ['--version'], { quiet: true, token: o.token, sink: o.sink });
    const line = (r.stdout + r.stderr).trim().split('\n')[0];
    return r.code === 0 && line ? { dir: final, version: line } : { dir: final, versionError: r.error ?? `exited ${r.code}: ${line}` };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function installArkos(o: InstallOptions): Promise<Installed> {
  const platform = o.platform ?? process.platform;
  const asset = assetFor('arkos', o.manifest, platform, o.arch ?? process.arch);
  const staging = newStaging(o.root);
  try {
    const file = await fetchAsset('arkos', asset, o, staging);
    const entries = readArchive(file, asset.url);
    const wanted = ['SongToAkg', 'SongToSoundEffects'] as const;
    const bin = path.join(staging, 'out', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const tool of wanted) {
      // <top>/tools/SongToAkg[.exe]; the tool is a self-contained executable (the Windows zip has no DLLs beside it)
      const hit = entries.find((e) => e.kind === 'file' && /(^|\/)tools\/[^/]+$/.test(e.path) && e.path.split('/').pop()?.replace(/\.exe$/i, '') === tool);
      if (!hit) throw new ArchiveError(`the Arkos archive holds no ${tool}`);
      const dest = path.join(bin, exeName(tool, platform));
      fs.writeFileSync(dest, hit.data());
      if (platform !== 'win32') fs.chmodSync(dest, 0o755);
      if (platform === 'darwin') {
        // as tools/arkos/fetch.sh: as downloaded the tools hang at exec on current macOS until they carry a local signature
        const r = await runTool(['codesign'], ['--force', '--sign', '-', dest], { quiet: true, token: o.token, sink: o.sink });
        if (r.code !== 0) throw new Error(`codesign failed on ${tool}: ${r.error ?? (r.stderr.trim() || `exited ${r.code}`)}`);
      }
    }
    const final = path.join(o.root, arkosDirName(o.manifest.arkos.version));
    swapIn(path.join(staging, 'out'), final);
    dropOthers(o.root, 'arkos-', path.basename(final));
    if (!arkosToolPath(path.join(final, 'bin'), 'SongToAkg') && platform === process.platform) throw new Error('the Arkos tools are not where they were installed');
    return { dir: path.join(final, 'bin') };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** The text for a failed download, per kind of failure (exact wording is part of the spec). */
export function failureText(e: unknown, part: Part, m: ToolsManifest): string {
  const name = part === 'zxbasic' ? `Boriel BASIC ${m.zxbasic.version}` : `Arkos Tracker ${m.arkos.version}`;
  if (e instanceof ChecksumError) return `CPCBuild: the download of ${name} did not match its checksum and was deleted. Try again; if it keeps failing, report it.`;
  if (e instanceof UnpinnedError) return `CPCBuild: this version of Studio has no checksum for the ${name} download yet, so it will not download it. Download the SDK zip from the releases page.`;
  if (e instanceof NoToolsError) return `CPCBuild: ${part === 'arkos' ? arkosUnavailableText(e.platform) : `there are no compiler tools for ${e.platform}. Download the SDK zip from the releases page.`}`;
  if (e instanceof ArchiveError) return `CPCBuild: the download of ${name} could not be unpacked: ${e.message}. Try again; if it keeps failing, report it.`;
  const msg = e instanceof DownloadError || e instanceof Error ? e.message : String(e);
  return `CPCBuild: could not download ${name}: ${msg}. Check the connection or "http.proxy", or download the SDK zip from the releases page.`;
}

export function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export { ChecksumError, DownloadError };
