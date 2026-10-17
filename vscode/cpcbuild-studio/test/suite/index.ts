import './studio.test';
import './lint.test';
import './palette.test';
import './sprite.test';
import './importer.test';
import './maps.test';
import './debug.test';
import { runAll } from './harness';

export async function run(): Promise<void> {
  await runAll();
}
