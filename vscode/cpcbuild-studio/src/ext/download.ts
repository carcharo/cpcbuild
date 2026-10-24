/**
 * download.ts -- fetching a file over https (or http, for tests) with Node alone: redirects (GitHub release URLs
 * redirect), an optional HTTP proxy (CONNECT for https, as `http.proxy` / HTTPS_PROXY mean it), a streamed
 * SHA-256, progress and cancel. A download that fails its checksum is deleted. No vscode import (unit-testable).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as tls from 'node:tls';
import type { CancelToken } from './runTool';

export class DownloadError extends Error {
  constructor(message: string, readonly cancelled = false) {
    super(message);
  }
}

export class ChecksumError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super(`checksum mismatch: expected ${expected}, got ${actual}`);
  }
}

export interface DownloadOptions {
  url: string;
  /** The file to write (its folder must exist). */
  dest: string;
  /** Lowercase hex; when given the file is deleted and ChecksumError thrown on a mismatch. */
  sha256?: string;
  /** `http://[user:pass@]host:port`; undefined = direct. */
  proxy?: string;
  token?: CancelToken;
  onProgress?(received: number, total: number | undefined): void;
  maxRedirects?: number;
  /** Seconds without data before giving up (default 30). */
  idleSeconds?: number;
}

export interface Downloaded {
  sha256: string;
  bytes: number;
}

/** The proxy to use: the setting (`http.proxy`), else HTTPS_PROXY / HTTP_PROXY; none for hosts in NO_PROXY. */
export function proxyFor(url: string, setting: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const host = new URL(url).hostname.toLowerCase();
  const no = (env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
  if (no.some((n) => n === '*' || host === n || host.endsWith(`.${n}`))) return undefined;
  const p = setting?.trim() || (url.startsWith('https:') ? env.HTTPS_PROXY ?? env.https_proxy : undefined) || env.HTTP_PROXY || env.http_proxy;
  return p?.trim() || undefined;
}

/** An https agent that reaches the server through an HTTP proxy's CONNECT tunnel. */
class TunnelAgent extends https.Agent {
  constructor(private readonly proxy: URL) {
    super({ keepAlive: false });
  }
  // Agent.createSocket calls this with a callback when the socket is not available at once
  createConnection(options: any, cb?: (err: Error | null, socket?: any) => void): any {
    if (!cb) return undefined;
    const auth = this.proxy.username ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(this.proxy.username)}:${decodeURIComponent(this.proxy.password)}`).toString('base64')}` } : {};
    const target = `${options.host}:${options.port || 443}`;
    const req = http.request({ host: this.proxy.hostname, port: Number(this.proxy.port) || 80, method: 'CONNECT', path: target, headers: { Host: target, ...auth } });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return cb(new Error(`the proxy refused the connection to ${target} (HTTP ${res.statusCode})`));
      }
      cb(null, tls.connect({ socket, servername: options.servername || options.host }));
    });
    req.once('error', (e) => cb(new Error(`could not reach the proxy ${this.proxy.host}: ${e.message}`)));
    req.end();
  }
}

/** Starts a GET (through the proxy if any); the callback gets the response. */
function get(url: URL, proxy: URL | undefined, onRes: (res: http.IncomingMessage) => void, onErr: (e: Error) => void): http.ClientRequest {
  const headers = { 'User-Agent': 'cpcbuild-studio', Accept: '*/*' };
  let req: http.ClientRequest;
  if (url.protocol === 'https:') {
    req = https.request(url, { headers, agent: proxy ? new TunnelAgent(proxy) : undefined }, onRes);
  } else if (proxy) {
    // plain http through a proxy: the request line carries the full URL
    const auth = proxy.username ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } : {};
    req = http.request({ host: proxy.hostname, port: Number(proxy.port) || 80, path: url.href, headers: { ...headers, Host: url.host, ...auth } }, onRes);
  } else {
    req = http.request(url, { headers }, onRes);
  }
  req.once('error', onErr);
  req.end();
  return req;
}

export function download(o: DownloadOptions): Promise<Downloaded> {
  const proxy = o.proxy ? new URL(o.proxy) : undefined;
  const idleMs = (o.idleSeconds ?? 30) * 1000;
  return new Promise<Downloaded>((resolve, reject) => {
    let settled = false;
    let current: http.ClientRequest | undefined;
    let out: fs.WriteStream | undefined;
    let sub: { dispose(): void } | undefined;
    let idle: NodeJS.Timeout | undefined;
    const done = (err?: Error, value?: Downloaded): void => {
      if (settled) return;
      settled = true;
      if (idle) clearTimeout(idle);
      sub?.dispose();
      current?.destroy();
      const finish = (): void => (err ? (fs.rmSync(o.dest, { force: true }), reject(err)) : resolve(value as Downloaded));
      if (out && !out.closed) out.once('close', finish).destroy();
      else finish();
    };
    const arm = (): void => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => done(new DownloadError(`no data for ${o.idleSeconds ?? 30} seconds`)), idleMs);
    };
    sub = o.token?.onCancellationRequested(() => done(new DownloadError('cancelled', true)));
    if (o.token?.isCancellationRequested) return done(new DownloadError('cancelled', true));

    const fetch = (url: URL, redirects: number): void => {
      arm();
      current = get(
        url,
        proxy,
        (res) => {
          const code = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
            res.resume();
            if (redirects >= (o.maxRedirects ?? 8)) return done(new DownloadError('too many redirects'));
            let next: URL;
            try {
              next = new URL(res.headers.location, url);
            } catch {
              return done(new DownloadError(`bad redirect to ${res.headers.location}`));
            }
            if (url.protocol === 'https:' && next.protocol !== 'https:') return done(new DownloadError(`refusing a redirect from https to ${next.protocol}`));
            return fetch(next, redirects + 1);
          }
          if (code !== 200) {
            res.resume();
            return done(new DownloadError(`HTTP ${code}${res.statusMessage ? ` ${res.statusMessage}` : ''} from ${url.host}`));
          }
          const total = Number(res.headers['content-length']) || undefined;
          const hash = crypto.createHash('sha256');
          let received = 0;
          out = fs.createWriteStream(o.dest);
          out.once('error', (e) => done(new DownloadError(`cannot write ${o.dest}: ${e.message}`)));
          res.on('data', (c: Buffer) => {
            hash.update(c);
            received += c.length;
            arm();
            o.onProgress?.(received, total);
          });
          res.once('error', (e) => done(new DownloadError(e.message)));
          res.once('aborted', () => done(new DownloadError('the connection was closed early')));
          out.once('finish', () => {
            if (total !== undefined && received !== total) return done(new DownloadError(`the download stopped after ${received} of ${total} bytes`));
            const sha = hash.digest('hex');
            if (o.sha256 && sha !== o.sha256.toLowerCase()) return done(new ChecksumError(o.sha256, sha));
            done(undefined, { sha256: sha, bytes: received });
          });
          res.pipe(out);
        },
        (e) => done(new DownloadError(e.message)),
      );
    };
    try {
      fetch(new URL(o.url), 0);
    } catch (e) {
      done(new DownloadError(`bad URL ${o.url}`));
    }
  });
}
