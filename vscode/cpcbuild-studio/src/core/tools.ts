/**
 * tools.ts -- the tools manifest (tools-manifest.json: where Download Tools gets the compiler and the Arkos
 * command-line tools, and the SHA-256 each download must have) and the platform names it uses. No vscode import.
 */

export type ToolsPlatform = 'windows-x64' | 'linux-x64' | 'linux-arm64' | 'macos-arm64' | 'macos-x64';
export const TOOLS_PLATFORMS: readonly ToolsPlatform[] = ['windows-x64', 'linux-x64', 'linux-arm64', 'macos-arm64', 'macos-x64'];

/** The manifest's platform key for `process.platform` / `process.arch`; undefined where there are no tools. Windows on ARM runs the x64 build. */
export function toolsPlatform(platform: NodeJS.Platform, arch: string): ToolsPlatform | undefined {
  if (platform === 'win32') return arch === 'x64' || arch === 'arm64' ? 'windows-x64' : undefined;
  if (platform === 'linux') return arch === 'x64' ? 'linux-x64' : arch === 'arm64' ? 'linux-arm64' : undefined;
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : arch === 'x64' ? 'macos-x64' : undefined;
  return undefined;
}

export interface ToolAsset {
  url: string;
  /** 64 lowercase hex digits, or "PIN" before scripts/pin-compiler.mjs has filled it in. */
  sha256: string;
}

export interface ToolPart {
  version: string;
  assets: Partial<Record<ToolsPlatform, ToolAsset>>;
}

export interface ToolsManifest {
  zxbasic: ToolPart;
  arkos: ToolPart;
}

export class ManifestError extends Error {}

export const PIN = 'PIN';
export const isPinned = (a: ToolAsset): boolean => /^[0-9a-f]{64}$/.test(a.sha256);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parsePart(name: string, v: unknown): ToolPart {
  if (!isObj(v)) throw new ManifestError(`tools manifest: "${name}" is missing`);
  if (typeof v.version !== 'string' || !/^[\w.+-]+$/.test(v.version)) throw new ManifestError(`tools manifest: "${name}.version" must be a version string`);
  if (!isObj(v.assets)) throw new ManifestError(`tools manifest: "${name}.assets" is missing`);
  const raw = v.assets;
  const assets: Partial<Record<ToolsPlatform, ToolAsset>> = {};
  const one = (key: string, seen: string[]): ToolAsset => {
    const a = raw[key];
    if (typeof a === 'string') {
      // an alias for another platform's entry ("macos-x64": "macos-arm64")
      if (seen.includes(a) || !(TOOLS_PLATFORMS as readonly string[]).includes(a) || !(a in raw)) throw new ManifestError(`tools manifest: ${name}.assets.${key} points at "${a}", which is not an entry`);
      return one(a, [...seen, key]);
    }
    if (!isObj(a) || typeof a.url !== 'string' || typeof a.sha256 !== 'string') throw new ManifestError(`tools manifest: ${name}.assets.${key} needs "url" and "sha256"`);
    if (!/^https:\/\//.test(a.url)) throw new ManifestError(`tools manifest: ${name}.assets.${key}.url must be an https URL`);
    if (a.sha256 !== PIN && !/^[0-9a-f]{64}$/.test(a.sha256)) throw new ManifestError(`tools manifest: ${name}.assets.${key}.sha256 must be 64 lowercase hex digits (or "${PIN}")`);
    return { url: a.url, sha256: a.sha256 };
  };
  for (const key of Object.keys(raw)) {
    if (!(TOOLS_PLATFORMS as readonly string[]).includes(key)) throw new ManifestError(`tools manifest: ${name}.assets has an unknown platform "${key}"`);
    assets[key as ToolsPlatform] = one(key, []);
  }
  return { version: v.version, assets };
}

/** Checks the manifest (parsed JSON) and resolves platform aliases. Throws ManifestError. */
export function parseManifest(json: unknown): ToolsManifest {
  if (!isObj(json)) throw new ManifestError('tools manifest: not an object');
  return { zxbasic: parsePart('zxbasic', json.zxbasic), arkos: parsePart('arkos', json.arkos) };
}

/** Folder names under <globalStorage>/tools/ for a version of each part. */
export const zxbasicDirName = (version: string): string => `zxbasic-${version}`;
export const arkosDirName = (version: string): string => `arkos-${version}`;
