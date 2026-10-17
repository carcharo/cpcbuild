import './studio.test';
import './lint.test';
import './palette.test';
import { runAll } from './harness';

export async function run(): Promise<void> {
  await runAll();
}
