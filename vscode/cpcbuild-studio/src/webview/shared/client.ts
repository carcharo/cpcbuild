/** client.ts -- the webview's side of the message protocol (src/shared/protocol.ts): typed requests with ids. */
import type { HostToWeb, RequestMap } from '../../shared/protocol';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };

export interface Client<R extends RequestMap<R>, V> {
  /** Ask the host; resolves with the result or rejects with the host's error message. */
  request<K extends keyof R & string>(name: K, args: R[K]['args']): Promise<R[K]['result']>;
  /** Listen to init / view / fatal pushes. Returns the unsubscribe function. */
  subscribe(fn: (m: Exclude<HostToWeb<V>, { type: 'response' }>) => void): () => void;
  /** Tell the host the webview is up (it answers with init and the view). Safe to call again to retry. */
  ready(): void;
  reportError(message: string): void;
  getState<T>(): T | undefined;
  setState(s: unknown): void;
}

export function createClient<R extends RequestMap<R>, V>(): Client<R, V> {
  const api = acquireVsCodeApi();
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  const listeners = new Set<(m: Exclude<HostToWeb<V>, { type: 'response' }>) => void>();
  let nextId = 1;
  window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as HostToWeb<V>;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'response') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error));
      return;
    }
    listeners.forEach((l) => l(m));
  });
  return {
    request(name, args) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        api.postMessage({ type: 'request', id, name, args });
      });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    ready: () => api.postMessage({ type: 'ready' }),
    reportError: (message) => api.postMessage({ type: 'error', message }),
    getState: <T,>() => api.getState() as T | undefined,
    setState: (s) => api.setState(s),
  };
}
