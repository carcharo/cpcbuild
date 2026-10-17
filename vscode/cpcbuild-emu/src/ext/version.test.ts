import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('CPCEC pin', () => {
  it('matches tools/cpcec/fetch_build.sh', () => {
    const f = path.join(__dirname, '..', '..', '..', '..', 'tools', 'cpcec', 'fetch_build.sh');
    if (!fs.existsSync(f)) return;
    const sha = /^SHA=([0-9a-f]{40})/m.exec(fs.readFileSync(f, 'utf8'))![1];
    expect(fs.readFileSync(path.join(__dirname, 'extension.ts'), 'utf8')).toContain(`CPCEC_COMMIT = '${sha}'`);
  });
});
