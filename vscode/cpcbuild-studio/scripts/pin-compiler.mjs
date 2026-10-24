// pin-compiler.mjs -- writes the compiler's release into tools-manifest.json: version, URLs and SHA-256 of
// every zxbasic asset, taken from the SHA256SUMS file of the fork's GitHub release.
//
//   node scripts/pin-compiler.mjs v1.19.0-cpc.1
//
// Run it before tagging Studio and commit the result: Studio never fetches checksums when it runs.
// The file is a plain list of "<sha256>  <file name>" lines (sha256sum / shasum -a 256 output).
import { readFileSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'https://github.com/carcharo/zxbasic/releases/download';
export const PLATFORMS = ['windows-x64', 'windows-arm64', 'linux-x64', 'linux-arm64', 'macos-arm64', 'macos-x64'];
/** Releases before windows-arm64 existed lack it; Studio then gives Windows on ARM the x64 build. */
export const OPTIONAL = ['windows-arm64'];
const ext = (p) => (p.startsWith('linux') ? 'tar.gz' : 'zip');

/** "<sha>  <name>" lines (a leading * on the name is binary mode) -> Map(name -> sha). */
export function parseSums(text) {
  const m = new Map();
  for (const line of text.split(/\r?\n/)) {
    const x = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (x) m.set(x[2], x[1].toLowerCase());
  }
  return m;
}

/** The manifest object with the zxbasic part for `tag` (assets named zxbasic-<version>-<platform>.<ext>). Throws when a file has no checksum. */
export function pin(manifest, tag, sums) {
  const version = tag.replace(/^v/, '');
  const assets = {};
  const missing = [];
  for (const p of PLATFORMS) {
    const file = `zxbasic-${version}-${p}.${ext(p)}`;
    const sha256 = sums.get(file);
    if (!sha256) {
      if (!OPTIONAL.includes(p)) missing.push(file);
    }
    else assets[p] = { url: `${REPO}/${tag}/${file}`, sha256 };
  }
  if (missing.length) throw new Error(`SHA256SUMS of ${tag} has no entry for: ${missing.join(', ')}`);
  return { ...manifest, zxbasic: { version, assets } };
}

/** The manifest as text, one asset per line (the layout the file is kept in). */
export function format(m) {
  const part = (name, p) => {
    const keys = Object.keys(p.assets);
    const lines = keys.map((k, i) => {
      const a = p.assets[k];
      const v = typeof a === 'string' ? JSON.stringify(a) : `{ "url": ${JSON.stringify(a.url)}, "sha256": ${JSON.stringify(a.sha256)} }`;
      return `      ${JSON.stringify(k)}: ${v}${i < keys.length - 1 ? ',' : ''}`;
    });
    return `  ${JSON.stringify(name)}: {\n    "version": ${JSON.stringify(p.version)},\n    "assets": {\n${lines.join('\n')}\n    }\n  }`;
  };
  return `{\n${part('zxbasic', m.zxbasic)},\n${part('arkos', m.arkos)}\n}\n`;
}

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'cpcbuild-pin-compiler' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects > 8) return reject(new Error('too many redirects'));
        return resolve(fetchText(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tag = process.argv[2];
  if (!tag || !/^v\d/.test(tag)) {
    console.error('usage: node scripts/pin-compiler.mjs <tag>   (e.g. v1.19.0-cpc.1)');
    process.exit(2);
  }
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools-manifest.json');
  try {
    const sums = parseSums(await fetchText(`${REPO}/${tag}/SHA256SUMS`));
    const next = pin(JSON.parse(readFileSync(file, 'utf8')), tag, sums);
    writeFileSync(file, format(next));
    console.log(`pinned zxbasic ${next.zxbasic.version} in ${file}`);
    for (const [k, a] of Object.entries(next.zxbasic.assets)) console.log(`  ${k.padEnd(12)} ${a.sha256}`);
  } catch (e) {
    console.error(`pin-compiler: ${e.message}`);
    process.exit(1);
  }
}
