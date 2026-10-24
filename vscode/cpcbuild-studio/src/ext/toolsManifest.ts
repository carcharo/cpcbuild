/** toolsManifest.ts -- tools-manifest.json as shipped with the extension, checked once (a bad file fails the unit tests, not a user). No vscode import. */
import manifestJson from '../../tools-manifest.json';
import { parseManifest, ToolsManifest } from '../core/tools';

export const manifest: ToolsManifest = parseManifest(manifestJson);
