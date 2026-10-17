/** deliver.ts -- hands one event to a listener without letting a stuck listener stall the chain. No vscode import. */

/** How long one listener may take before the chain moves on. */
export const EVENT_TIMEOUT_MS = 2000;

export type Delivery = 'done' | 'timeout' | 'failed';

/** Runs `run(ev)` and waits for it, but never longer than `ms`. Never rejects; the timer is always cleared. */
export async function deliver<E>(ev: E, ms: number, run: (ev: E) => PromiseLike<unknown> | unknown): Promise<Delivery> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = Promise.resolve()
      .then(() => run(ev))
      .then(() => 'done' as const, () => 'failed' as const); // a failing listener must not disturb the emulator
    const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), ms); });
    return await Promise.race([call, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
