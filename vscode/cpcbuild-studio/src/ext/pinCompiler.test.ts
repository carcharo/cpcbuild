import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPinned, parseManifest } from '../core/tools';
import { PY_LAUNCHER, pythonCmd } from './runTool';

const script = path.join(__dirname, '..', '..', 'scripts', 'pin-compiler.mjs');
const load = (): Promise<any> => import(/* @vite-ignore */ pathToFileURL(script).href);
const shipped = (): any => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools-manifest.json'), 'utf8'));

describe('scripts/pin-compiler.mjs', () => {
  const tag = 'v1.19.0-cpc.2';
  const files = ['windows-x64.zip', 'linux-x64.tar.gz', 'linux-arm64.tar.gz', 'macos-arm64.zip', 'macos-x64.zip'].map((s) => `zxbasic-1.19.0-cpc.2-${s}`);
  const sumsText = files.map((f, i) => `${String(i + 1).repeat(64)}  ${f}`).join('\n') + '\n' + `${'e'.repeat(64)} *other.txt\n`;

  it('reads sha256sum and shasum output (a leading * is binary mode)', async () => {
    const { parseSums } = await load();
    const m = parseSums(sumsText);
    expect(m.get(files[0])).toBe('1'.repeat(64));
    expect(m.get('other.txt')).toBe('e'.repeat(64));
    expect(m.size).toBe(6);
  });
  it('rewrites the zxbasic entries (version, URLs, SHAs), keeps Arkos, and the result is a valid, fully pinned manifest', async () => {
    const { parseSums, pin, format } = await load();
    const out = pin(shipped(), tag, parseSums(sumsText));
    expect(out.zxbasic.version).toBe('1.19.0-cpc.2');
    expect(out.zxbasic.assets['linux-arm64']).toEqual({ url: `https://github.com/carcharo/zxbasic/releases/download/${tag}/zxbasic-1.19.0-cpc.2-linux-arm64.tar.gz`, sha256: '3'.repeat(64) });
    expect(out.arkos).toEqual(shipped().arkos);
    const text = format(out);
    const m = parseManifest(JSON.parse(text));
    expect(Object.values(m.zxbasic.assets).every((a) => isPinned(a!))).toBe(true);
    expect(m.arkos.assets['macos-x64']).toEqual(m.arkos.assets['macos-arm64']);
    expect(JSON.parse(text)).toEqual(out);
  });
  it('pins windows-arm64 when the release has it, and leaves it out (x64 fallback) when it does not', async () => {
    const { parseSums, pin } = await load();
    expect(pin(shipped(), tag, parseSums(sumsText)).zxbasic.assets['windows-arm64']).toBeUndefined();
    const withArm = sumsText + `${'f'.repeat(64)}  zxbasic-1.19.0-cpc.2-windows-arm64.zip\n`;
    expect(pin(shipped(), tag, parseSums(withArm)).zxbasic.assets['windows-arm64'].sha256).toBe('f'.repeat(64));
  });
  it('refuses a release whose SHA256SUMS lacks a platform', async () => {
    const { parseSums, pin } = await load();
    const partial = parseSums(sumsText.split('\n').slice(0, 3).join('\n'));
    expect(() => pin(shipped(), tag, partial)).toThrow(/no entry for: .*macos-arm64\.zip/);
  });
  it('format() reproduces the file as shipped (so a pin changes only the zxbasic lines)', async () => {
    const { format } = await load();
    // (a checkout with CRLF line ends holds the same text)
    expect(format(shipped())).toBe(fs.readFileSync(path.join(__dirname, '..', '..', 'tools-manifest.json'), 'utf8').replace(/\r\n/g, '\n'));
  });
});

describe('pythonCmd', () => {
  it('splits only the Windows launcher default; a path with spaces stays one program', () => {
    expect(pythonCmd(PY_LAUNCHER)).toEqual(['py', '-3']);
    expect(pythonCmd('python3')).toEqual(['python3']);
    expect(pythonCmd('C:\\Program Files\\Python 3\\python.exe')).toEqual(['C:\\Program Files\\Python 3\\python.exe']);
  });
});
