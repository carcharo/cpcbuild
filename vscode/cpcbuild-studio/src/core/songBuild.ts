/**
 * songBuild.ts -- the pure parts of building a .cpcsong: the names of the files written beside it.
 *
 * `assets/tune.cpcsong` -> `assets/tune.vt2` (the module for the converter) -> `assets/tune.bas` (the CPC BASIC
 * include with the label `tune`, played with MusicInit(@tune, 1)). A song's data does not depend on the
 * machine (the chip clock is not stored in an AKG song), so there is one include for every target.
 *
 * No vscode or node imports.
 */
import { sanitizeName } from './aks2bas';
import { matchesAny } from './glob';

export const SONG_GLOB = 'assets/**/*.cpcsong';

export interface SongOutput {
  /** The Vortex Tracker module written for the converter (project-relative). */
  vt2: string;
  /** The CPC BASIC include the converter writes. */
  bas: string;
}

/** The label of the song: the file stem, made usable as a BASIC name. */
export function songBankName(rel: string): string {
  return sanitizeName(rel.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, ''));
}

export function songOutputs(rel: string): SongOutput {
  const stem = rel.replace(/\.[^./\\]*$/, '');
  return { vt2: `${stem}.vt2`, bas: `${stem}.bas` };
}

/** cpcbuild.json's text with SONG_GLOB added to "assets" when no glob there matches `rel`; undefined when nothing needs to change. */
export function withSongGlob(projectJson: string, rel: string): string | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(projectJson);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const assets = Array.isArray(o.assets) ? o.assets.filter((a): a is string => typeof a === 'string') : [];
  if (matchesAny(assets, rel)) return undefined;
  o.assets = [...assets, SONG_GLOB];
  return JSON.stringify(o, null, 2) + '\n';
}
