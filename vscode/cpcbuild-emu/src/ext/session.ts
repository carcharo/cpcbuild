import * as fs from 'fs';
import * as vscode from 'vscode';
import type { EmuModel, EmuState } from '../emuApi';
import type { HostNotice, HostRequest, ResponseMsg, WebviewMessage } from '../shared/protocol';
import { pageHtml } from './html';

type Body = HostRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type SessionEvent = 'paused' | 'resumed' | 'closed';

/** One emulator tab: a webview panel plus the request/response bookkeeping toward it. */
export class Session {
  readonly panel: vscode.WebviewPanel;
  lastState: EmuState | undefined;
  model: EmuModel = '6128';
  closed = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readyResolve!: () => void;
  private readonly ready = new Promise<void>((r) => { this.readyResolve = r; });

  constructor(
    readonly id: string,
    private readonly ext: vscode.Uri,
    private readonly onEvent: (s: Session, e: SessionEvent, st: EmuState | undefined) => void,
    onDispose: (s: Session) => void,
    focus: boolean,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'cpcbuild.emu',
      'CPC Emulator',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: !focus },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(ext, 'dist'), vscode.Uri.joinPath(ext, 'wasm'), vscode.Uri.joinPath(ext, 'media')],
      },
    );
    this.panel.iconPath = new vscode.ThemeIcon('circuit-board');
    this.panel.webview.html = pageHtml(this.panel.webview, ext, runHidden());
    this.panel.webview.onDidReceiveMessage((m: WebviewMessage) => this.receive(m));
    this.panel.onDidChangeViewState(() => this.notice({ kind: 'visibility', visible: this.panel.visible }));
    this.panel.onDidDispose(() => {
      this.closed = true;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('the emulator tab was closed')); }
      this.pending.clear();
      this.onEvent(this, 'closed', this.lastState);
      onDispose(this);
    });
  }

  private receive(m: WebviewMessage): void {
    if (process.env.CPCEMU_LOG) fs.appendFileSync(process.env.CPCEMU_LOG, `${this.id}: got ${m.kind}\n`);
    switch (m.kind) {
      case 'ready':
        this.readyResolve();
        this.notice({ kind: 'config', runHidden: runHidden() });
        this.notice({ kind: 'visibility', visible: this.panel.visible });
        break;
      case 'response': this.settle(m); break;
      case 'event':
        this.lastState = m.state;
        this.onEvent(this, m.event, m.state);
        break;
      case 'log':
        console.log(`[cpcbuild-emu ${this.id}] ${m.text}`);
        if (process.env.CPCEMU_LOG) fs.appendFileSync(process.env.CPCEMU_LOG, `${this.id}: ${m.text}\n`);
        break;
    }
  }

  private settle(m: ResponseMsg): void {
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error ?? 'failed'));
  }

  notice(n: HostNotice): void {
    if (!this.closed) void this.panel.webview.postMessage(n);
  }

  /** Sends a request once the page is up and waits for its answer. */
  async request<T = unknown>(body: Body, timeoutMs = 10000): Promise<T> {
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.ready, new Promise<void>((_, rej) => { startTimer = setTimeout(() => rej(new Error('the emulator page did not start')), 20000); })]);
    } finally {
      if (startTimer) clearTimeout(startTimer);
    }
    if (this.closed) throw new Error('the emulator tab was closed');
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the emulator did not answer ${body.type} within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.panel.webview.postMessage({ ...body, id }).then((ok) => { if (!ok) this.settle({ kind: 'response', id, ok: false, error: 'the emulator page did not accept the message' }); });
    });
  }

  setTitle(file: string): void {
    this.panel.title = 'CPC Emulator - ' + file;
  }
}

export function runHidden(): boolean {
  return vscode.workspace.getConfiguration('cpcbuild.emu').get<boolean>('runHidden', false);
}
