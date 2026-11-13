/** Test-only (uses node): a committed generated .bas as the converters write it today. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO } from './testutil';

/**
 * The text of a committed generated include, with the data tables in CPC BASIC (`&FF`). A file not yet regenerated
 * since the converters wrote Boriel BASIC still holds `$FF` in its indented data lines; it is read as its `&` form, so
 * the comparison covers everything but the hex prefix until `make assets` has rewritten it (and is a no-op after).
 */
export function committedText(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/^( {4}.*)$/gm, (l) => l.replace(/\$([0-9A-F]{2})\b/g, '&$1'));
}
