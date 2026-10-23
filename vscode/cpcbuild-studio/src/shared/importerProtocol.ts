/**
 * importerProtocol.ts -- the host <-> webview messages of the image importer (.cpcimp). It builds
 * on the generic parts of protocol.ts (requests, views, versions) and lives in its own file so the
 * other editors' protocol edits do not collide with it.
 *
 * The webview holds the recipe it is sent and edits it by operations (`RecipeOp`); it never
 * quantises or encodes pixels: the host's converter answers `preview` with pen indices and the
 * palette (docs/phase8-design.md section 3).
 */
import type { Preview, Recipe, RecipeOp } from '../core/cpcimp';
import type { BaseRequests, HostToWeb, ViewBase, WebToHost } from './protocol';

export type { Preview, Recipe, RecipeOp };

export interface GenerateOutcome {
  ok: boolean;
  written: string[];
  error?: string;
  /** Epoch ms. */
  at: number;
}

export interface ImporterView extends ViewBase {
  recipe: Recipe;
  /** Recipe path relative to the project root, forward slashes. */
  recipePath: string;
  /** The folder the recipe's paths are relative to. */
  root: string;
  /** Changes when the source image file does (path, size, mtime): refetch `sourceImage`. */
  sourceKey: string;
  /** The default name and output, which the form shows as placeholders. */
  defaultName: string;
  defaultOutput: string;
  /** The recipe with what it leaves out filled in from the sidecar: the values the form shows. */
  effective: Recipe;
  /** The sidecar beside the source image (file name) that supplies those values. */
  sidecar?: string;
  /** The recipe fields the sidecar gives, and which of them the recipe overrides. */
  sidecarFields?: Partial<Recipe>;
  overridden: string[];
  /** The sidecar's error message when it cannot be read (the converter reports the same). */
  sidecarError?: string;
  /** The exact command (python3 tools/img2cpc.py ...), or why there is none. */
  command?: string;
  commandReason?: string;
  engine: 'builtin' | 'python';
  header: 'img2cpc' | 'studio' | 'none';
  /** Files a run writes (project-relative) and whether the first is older than its inputs. */
  outputs: string[];
  outputExists: boolean;
  stale: boolean;
  generated?: GenerateOutcome;
  saveProblem?: string;
}

export type SourceImage =
  | { ok: true; width: number; height: number; format: string; /** RGBA, base64. */ rgba: string }
  | { ok: false; error: string; empty?: boolean };

export type PreviewResponse =
  | { ok: true; version: number; preview: Preview; truncated: boolean }
  | { ok: false; version: number; error: string; empty?: boolean };

export type PickWhich = 'palette' | 'plusPalette' | 'writePalette' | 'output';

export interface ImporterRequests extends BaseRequests {
  edit: { args: { baseVersion: number; op: RecipeOp }; result: { version: number } };
  sourceImage: { args: Record<string, never>; result: SourceImage };
  preview: { args: { version: number }; result: PreviewResponse };
  generate: { args: Record<string, never>; result: GenerateOutcome };
  /** The open dialog for the source image; edits the recipe when a file is chosen. */
  pickSource: { args: { baseVersion: number }; result: { picked: boolean } };
  pickFile: { args: { baseVersion: number; which: PickWhich }; result: { picked: boolean } };
  /** "Import recipe from command line": a pasted build_assets.sh line. */
  importCommand: { args: { baseVersion: number; line: string }; result: { ok: boolean; unrecognised: string[]; error?: string } };
  copyCommand: { args: Record<string, never>; result: { copied: boolean; reason?: string } };
  /** Switch cpcbuild.assets.engine to python after the user confirms. */
  useEngine: { args: { engine: 'python' }; result: { changed: boolean } };
  /** Write the composed grid sheet as a PNG beside the recipe. */
  savePreprocessed: { args: Record<string, never>; result: { file?: string; error?: string } };
  openPalette: { args: Record<string, never>; result: { ok: boolean } };
}

export type ImporterToHost = WebToHost<ImporterRequests>;
export type ImporterToWeb = HostToWeb<ImporterView>;
