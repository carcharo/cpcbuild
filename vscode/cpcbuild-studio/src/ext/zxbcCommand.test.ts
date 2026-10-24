import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from './runTool';
import { compilerHint, DOWNLOAD_HINT, findPoetry, isDefaultZxbc, poetryFallback } from './zxbcCommand';

const home = path.join(path.sep, 'home', 'u');
const local = path.join(home, '.local', 'bin', 'poetry');
const pyproject = path.join(path.sep, 'zx', 'pyproject.toml');
const has = (...files: string[]) => (p: string) => files.includes(p);

describe('zxbc fallback', () => {
  it('knows the default command', () => {
    expect(isDefaultZxbc(['zxbc'])).toBe(true);
    expect(isDefaultZxbc(['poetry', 'run', 'zxbc'])).toBe(false);
  });
  it('finds poetry on PATH first, then ~/.local/bin', () => {
    const onPath = path.join(path.sep, 'opt', 'bin', 'poetry');
    expect(findPoetry({ env: { PATH: `/x:/opt/bin` }, home, platform: 'linux', exists: has(onPath, local) })).toBe(onPath);
    expect(findPoetry({ env: { PATH: '/x' }, home, platform: 'linux', exists: has(local) })).toBe(local);
    expect(findPoetry({ env: { PATH: '/x' }, home, platform: 'linux', exists: has() })).toBeUndefined();
  });
  it('finds poetry under %APPDATA% on Windows', () => {
    const p = path.join('C:\\Users\\u\\AppData\\Roaming', 'Python', 'Scripts', 'poetry.exe');
    expect(findPoetry({ env: { Path: '', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, home, platform: 'win32', exists: has(p) })).toBe(p);
  });
  it('falls back only for the default command in a Poetry project', () => {
    const o = { env: { PATH: '' }, home, platform: 'linux' as const, exists: has(pyproject, local) };
    expect(poetryFallback(['zxbc'], path.dirname(pyproject), o)).toEqual([local, 'run', 'zxbc']);
    expect(poetryFallback(['myzxbc'], path.dirname(pyproject), o)).toBeUndefined();
    expect(poetryFallback(['zxbc'], path.join(path.sep, 'other'), o)).toBeUndefined();
    expect(poetryFallback(['zxbc'], path.dirname(pyproject), { ...o, exists: has(pyproject) })).toBeUndefined();
  });
  it('suggests the exact setting with the full poetry path', () => {
    const o = { env: { PATH: '' }, home, platform: 'linux' as const, exists: has(local) };
    const t = compilerHint('"zxbc" was not found', ['zxbc'], path.dirname(pyproject), o);
    expect(t).toContain(JSON.stringify([local, 'run', 'zxbc']));
    expect(t).toContain('"cpcbuild.zxbc.cwd" to your zxbasic checkout');
  });
  it('ends with the Download Tools hint, and keeps the Poetry advice for developers (zxbc.cwd set) only', () => {
    const user = compilerHint('"zxbc" was not found');
    expect(user).toBe(`"zxbc" was not found. ${DOWNLOAD_HINT}`);
    expect(DOWNLOAD_HINT).toBe('Run "CPC Game Studio: Download Tools".');
    expect(user).not.toContain('poetry');
    const dev = compilerHint('"zxbc" was not found', ['zxbc'], '/zx', { env: { PATH: '' }, home, platform: 'linux', exists: has() });
    expect(dev).toContain('poetry');
    expect(dev.endsWith(DOWNLOAD_HINT)).toBe(true);
    expect(compilerHint('x', ['./mine'])).toContain('Check "cpcbuild.zxbc.command"');
  });
  it('does not offer poetry.cmd / poetry.bat on Windows (they cannot be spawned without a shell)', () => {
    const d = 'C:\\bin';
    const cmd = path.join(d, 'poetry.cmd');
    expect(findPoetry({ env: { Path: d }, home, platform: 'win32', exists: has(cmd, path.join(d, 'poetry.bat')) })).toBeUndefined();
  });
  it('names the platform-specific location in the hint', () => {
    const base = { env: { PATH: '' }, home, exists: has() };
    expect(compilerHint('x', ['zxbc'], '/zx', { ...base, platform: 'linux' })).toContain('~/.local/bin');
    const w = compilerHint('x', ['zxbc'], '/zx', { ...base, platform: 'win32' });
    expect(w).not.toContain('~/.local/bin');
    expect(w).toContain('%APPDATA%');
  });
  it('runTool flags a missing program with notFound, which the fallback keys on', async () => {
    const r = await runTool(['/no/such/zxbc-program'], []);
    expect(r.notFound).toBe(true);
    expect(r.error).toMatch(/was not found/);
    const bad = await runTool([process.execPath, '-e', 'process.exit(3)'], []);
    expect(bad.notFound).toBeUndefined();
  });
});
