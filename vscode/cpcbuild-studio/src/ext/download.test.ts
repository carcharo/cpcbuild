import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scratchDir } from '../core/testutil';
import { ChecksumError, download, DownloadError, proxyFor } from './download';

const dir = scratchDir('download-');
const body = crypto.randomBytes(300_000);
const sha = crypto.createHash('sha256').update(body).digest('hex');
let server: http.Server;
let base = '';
const seen: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const u = req.url ?? '';
    if (u === '/file') return void res.writeHead(200, { 'Content-Length': body.length }).end(body);
    if (u === '/go') return void res.writeHead(302, { Location: '/hop' }).end();
    if (u === '/hop') return void res.writeHead(307, { Location: `${base}/file` }).end();
    if (u === '/loop') return void res.writeHead(302, { Location: '/loop' }).end();
    if (u === '/missing') return void res.writeHead(404, 'Not Found').end('no');
    if (u === '/short') {
      res.writeHead(200, { 'Content-Length': body.length });
      res.write(body.subarray(0, 1000));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (u === '/slow') {
      res.writeHead(200, { 'Content-Length': body.length });
      res.write(body.subarray(0, 10));
      return; // never ends
    }
    res.writeHead(500).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('download', () => {
  it('saves the file, returns its SHA-256 and reports progress', async () => {
    const dest = path.join(dir, 'a.bin');
    let last = 0;
    let total: number | undefined;
    const r = await download({ url: `${base}/file`, dest, sha256: sha, onProgress: (n, t) => ((last = n), (total = t)) });
    expect(r).toEqual({ sha256: sha, bytes: body.length });
    expect(fs.readFileSync(dest).equals(body)).toBe(true);
    expect([last, total]).toEqual([body.length, body.length]);
  });
  it('follows redirects (relative and absolute, 302 and 307)', async () => {
    const dest = path.join(dir, 'b.bin');
    const r = await download({ url: `${base}/go`, dest, sha256: sha });
    expect(r.bytes).toBe(body.length);
  });
  it('gives up on a redirect loop', async () => {
    await expect(download({ url: `${base}/loop`, dest: path.join(dir, 'c.bin') })).rejects.toThrow(/too many redirects/);
  });
  it('deletes the file and throws ChecksumError on a mismatch', async () => {
    const dest = path.join(dir, 'd.bin');
    const bad = sha.replace(/^./, sha[0] === '0' ? '1' : '0');
    const e = await download({ url: `${base}/file`, dest, sha256: bad }).catch((x) => x);
    expect(e).toBeInstanceOf(ChecksumError);
    expect(e.actual).toBe(sha);
    expect(fs.existsSync(dest)).toBe(false);
  });
  it('reports an HTTP error and leaves no file', async () => {
    const dest = path.join(dir, 'e.bin');
    await expect(download({ url: `${base}/missing`, dest })).rejects.toThrow(/HTTP 404/);
    expect(fs.existsSync(dest)).toBe(false);
  });
  it('notices a connection that ends early', async () => {
    const dest = path.join(dir, 'f.bin');
    const e = await download({ url: `${base}/short`, dest }).catch((x) => x);
    expect(e).toBeInstanceOf(DownloadError);
    expect(fs.existsSync(dest)).toBe(false);
  });
  it('gives up when no data arrives for a while', async () => {
    await expect(download({ url: `${base}/slow`, dest: path.join(dir, 'g.bin'), idleSeconds: 0.2 })).rejects.toThrow(/no data/);
  });
  it('can be cancelled mid-download', async () => {
    const listeners: (() => void)[] = [];
    const token = { isCancellationRequested: false, onCancellationRequested: (l: () => void) => (listeners.push(l), { dispose() {} }) };
    const dest = path.join(dir, 'h.bin');
    const p = download({ url: `${base}/slow`, dest, token });
    setTimeout(() => ((token.isCancellationRequested = true), listeners.forEach((l) => l())), 100);
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(DownloadError);
    expect(e.cancelled).toBe(true);
    expect(fs.existsSync(dest)).toBe(false);
    // already cancelled before it starts
    const e2 = await download({ url: `${base}/file`, dest, token }).catch((x) => x);
    expect(e2.cancelled).toBe(true);
  });
  it('refuses a bad URL', async () => {
    await expect(download({ url: 'not a url', dest: path.join(dir, 'i.bin') })).rejects.toThrow(/bad URL/);
  });
  it('goes through an HTTP proxy for plain http (absolute URL in the request line)', async () => {
    const hits: string[] = [];
    const proxy = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url} ${req.headers['proxy-authorization'] ?? ''}`);
      res.writeHead(200, { 'Content-Length': 3 }).end('abc');
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    try {
      const dest = path.join(dir, 'j.bin');
      const r = await download({ url: 'http://example.invalid/x/y.zip', dest, proxy: `http://u:p%40ss@127.0.0.1:${(proxy.address() as AddressInfo).port}` });
      expect(r.bytes).toBe(3);
      expect(hits).toEqual([`GET http://example.invalid/x/y.zip Basic ${Buffer.from('u:p@ss').toString('base64')}`]);
    } finally {
      proxy.close();
    }
  });
  it('asks an HTTP proxy for a CONNECT tunnel for https, and reports a refusal', async () => {
    const hits: string[] = [];
    const proxy = http.createServer();
    proxy.on('connect', (req, sock) => {
      hits.push(`${req.method} ${req.url}`);
      sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    try {
      const e = await download({ url: 'https://example.invalid/x.zip', dest: path.join(dir, 'k.bin'), proxy: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` }).catch((x) => x);
      expect(hits).toEqual(['CONNECT example.invalid:443']);
      expect(String(e.message)).toMatch(/proxy refused .*403/);
    } finally {
      proxy.close();
    }
  });
});

describe('proxyFor', () => {
  it('prefers the setting, then HTTPS_PROXY for https and HTTP_PROXY, and honours NO_PROXY', () => {
    expect(proxyFor('https://github.com/x', 'http://p:1', { HTTPS_PROXY: 'http://env:2' })).toBe('http://p:1');
    expect(proxyFor('https://github.com/x', '', { HTTPS_PROXY: 'http://env:2' })).toBe('http://env:2');
    expect(proxyFor('https://github.com/x', undefined, { http_proxy: 'http://low:3' })).toBe('http://low:3');
    expect(proxyFor('http://github.com/x', undefined, { HTTPS_PROXY: 'http://env:2' })).toBeUndefined();
    expect(proxyFor('https://github.com/x', undefined, {})).toBeUndefined();
    expect(proxyFor('https://objects.github.com/x', 'http://p:1', { NO_PROXY: 'localhost, .github.com' })).toBeUndefined();
    expect(proxyFor('https://example.org/x', 'http://p:1', { NO_PROXY: 'github.com' })).toBe('http://p:1');
  });
});
