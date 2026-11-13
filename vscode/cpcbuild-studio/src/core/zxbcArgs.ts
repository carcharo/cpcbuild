/**
 * zxbcArgs.ts -- the one-time migration of the old `cpcbuild.zxbc.args` setting (the Boriel BASIC compiler's
 * command line, removed in CPCBuild 0.2.0) to `cpcbuild.compiler.args` (the cpcbas command line). Pure TypeScript.
 */

export interface ZxbcTranslation {
  /** The value to offer for `cpcbuild.compiler.args`. */
  args: string[];
  /** Dropped on purpose, with the sentence that says what to do instead (`--enable-break`). */
  advice: string[];
  /** Flags that have no equivalent: named in the message, never silently lost. */
  notTranslated: string[];
}

/** Flags the Studio sets itself now: dropped without a word (those that take a value are listed in `TAKES_VALUE`). */
const SILENT = new Set(['--arch', '-f', '--format', '-o', '--output', '-M', '--mmap', '-B', '--BASIC', '-a', '--autorun']);
const TAKES_VALUE = new Set(['--arch', '-f', '--format', '-o', '--output', '-M', '--mmap']);

/** Translates a list of zxbc arguments. */
export function translateZxbcArgs(input: readonly string[]): ZxbcTranslation {
  const out: ZxbcTranslation = { args: [], advice: [], notTranslated: [] };
  const a = [...input];
  const take = (i: number, inline: string | undefined): [string | undefined, number] => (inline !== undefined && inline !== '' ? [inline, i] : [a[i + 1], i + 1]);
  for (let i = 0; i < a.length; i++) {
    const arg = a[i] as string;
    let name = arg;
    let inline: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) { name = arg.slice(0, eq); inline = arg.slice(eq + 1); }
    } else if (/^-[A-Za-z]/.test(arg) && arg.length > 2 && /^-[OHSDIWfoM]/.test(arg)) {
      name = arg.slice(0, 2);
      inline = arg.slice(2);
    }
    if (SILENT.has(name)) {
      if (TAKES_VALUE.has(name) && inline === undefined) i++;
      continue;
    }
    switch (name) {
      case '-O':
      case '--optimize': {
        const [v, j] = take(i, inline);
        i = j;
        const n = Number(v);
        if (v !== undefined && Number.isInteger(n) && n >= 0) out.args.push('-O', String(Math.min(n, 3)));
        else out.notTranslated.push(`${arg}${v !== undefined && inline === undefined ? ` ${v}` : ''}`);
        break;
      }
      case '-H':
      case '--heap-size':
      case '--heap-address':
      case '-S':
      case '--org':
      case '-D':
      case '-I': {
        const [v, j] = take(i, inline);
        i = j;
        const flag = name === '-H' || name === '--heap-size' ? '--heap' : name === '-S' ? '--org' : name;
        if (v === undefined) out.notTranslated.push(arg);
        else out.args.push(flag, v);
        break;
      }
      case '--enable-break':
        out.advice.push('--enable-break is dropped: write ON BREAK STOP in the program');
        break;
      default: {
        // anything else: named as it was written, with its value when the next word is not a flag
        const next = a[i + 1];
        const hasValue = inline === undefined && next !== undefined && !next.startsWith('-') && /^(-W|--array-base|--string-base|--max-syntax-errors|--expect-warnings|-e|--errmsg|-E|-N|-T|--stderr|--ignore-case)$/.test(name);
        out.notTranslated.push(hasValue ? `${arg} ${next}` : arg);
        if (hasValue) i++;
      }
    }
  }
  return out;
}

/** The text of the one-time message. */
export function zxbcMigrationMessage(t: ZxbcTranslation): string {
  const parts = [`CPC Game Studio: "cpcbuild.zxbc.args" is no longer used: the compiler now runs inside the extension and takes "cpcbuild.compiler.args".`];
  parts.push(t.args.length ? `The same options there: ${JSON.stringify(t.args)}.` : 'None of the options carries over.');
  if (t.advice.length) parts.push(`${t.advice.join('; ')}.`);
  if (t.notTranslated.length) parts.push(`Not translated (no equivalent): ${t.notTranslated.join(' ')}.`);
  return parts.join(' ');
}
