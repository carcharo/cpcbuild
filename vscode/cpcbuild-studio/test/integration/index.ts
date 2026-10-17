import './live.test';
import { runAll } from '../suite/harness';

export async function run(): Promise<void> {
  await runAll();
}
