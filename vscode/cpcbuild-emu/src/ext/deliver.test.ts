import { describe, expect, it } from 'vitest';
import { deliver } from './deliver';

describe('deliver', () => {
  it('waits for a listener that answers in time', async () => {
    const seen: number[] = [];
    expect(await deliver(1, 500, async (e) => { await new Promise((r) => setTimeout(r, 20)); seen.push(e); })).toBe('done');
    expect(seen).toEqual([1]);
  });
  it('gives up on a stuck listener after the timeout so the next event is not stalled', async () => {
    const t0 = Date.now();
    expect(await deliver(1, 100, () => new Promise(() => {}))).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(1000);
    // the chain continues with the next event
    let chain: Promise<unknown> = Promise.resolve();
    const done: number[] = [];
    chain = chain.then(() => deliver(1, 50, () => new Promise(() => {})));
    chain = chain.then(() => deliver(2, 50, (e) => { done.push(e); }));
    await chain;
    expect(done).toEqual([2]);
  });
  it('a throwing or rejecting listener is contained', async () => {
    expect(await deliver(1, 500, () => { throw new Error('x'); })).toBe('failed');
    expect(await deliver(1, 500, () => Promise.reject(new Error('x')))).toBe('failed');
  });
});
