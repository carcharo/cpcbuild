import type { BuildResult } from './build';
import type { EmuEvent } from '../emuApi';

export const state: {
  lastBuild?: BuildResult;
  emuEvents: EmuEvent[];
} = { emuEvents: [] };
