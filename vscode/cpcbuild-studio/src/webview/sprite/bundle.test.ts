/** The webview bundle builds (no browser needed): esbuild in memory, JSX through preact, size reported. */
import * as path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

describe('sprite webview bundle', () => {
  it('builds to a browser bundle under 150 KiB minified', async () => {
    const r = await build({
      entryPoints: [path.resolve(__dirname, 'main.tsx')],
      bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic', jsxImportSource: 'preact', minify: true, loader: { '.css': 'css' }, outdir: 'out-test', logLevel: 'silent',
    });
    const js = r.outputFiles.find((f) => f.path.endsWith('.js'));
    expect(js).toBeTruthy();
    expect(js!.contents.length).toBeLessThan(150 * 1024);
    expect(r.outputFiles.some((f) => f.path.endsWith('.css'))).toBe(true);
  });
});
