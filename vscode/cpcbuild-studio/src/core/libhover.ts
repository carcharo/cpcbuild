/**
 * libhover.ts -- what hover, completion and signature help show for a library
 * routine, as plain data (the extension turns it into VS Code objects).
 */
import type { DocHeading } from './libdocs';
import type { LibParam, LibRoutine, LibSetting } from './libindex';

export interface HoverParts {
  signature: string;
  doc: string;
  details: string;
  /** One-line facts: restriction, platform, what it links in. */
  notes: string[];
  source: string;
  section?: { text: string; slug: string; line: number };
}

const PLATFORM_NOTE = { cpc: '', plus: 'CPC Plus / GX4000 only (cpcplus.bas); does nothing on other models.', zx: 'ZX Spectrum (--arch zx48k) only.' };

export function describeRoutine(r: LibRoutine, section?: DocHeading): HoverParts {
  const notes: string[] = [];
  if (r.restriction === 'bare') notes.push('Bare-metal builds only (-D CPC_BAREMETAL); a firmware build refuses it at compile time.');
  if (r.restriction === 'firmware') notes.push('Needs the firmware; a bare-metal build (-D CPC_BAREMETAL) refuses it at compile time.');
  if (PLATFORM_NOTE[r.platform]) notes.push(PLATFORM_NOTE[r.platform]);
  if (r.fastcall) notes.push('FASTCALL: the first argument is passed in a register.');
  return {
    signature: r.signature,
    doc: r.doc,
    details: r.details,
    notes,
    source: `${r.file}:${r.line}`,
    ...(section ? { section: { text: section.text.replace(/`/g, ''), slug: section.slug, line: section.line } } : {}),
  };
}

export function describeSetting(s: LibSetting): HoverParts {
  return { signature: `#define ${s.name}`, doc: s.doc, details: '', notes: ['Define it before the first #include that reaches the library module.'], source: `${s.file}:${s.line}` };
}

/** Character ranges of each parameter inside the signature string (for signature help highlighting). */
export function paramRanges(signature: string, params: LibParam[]): [number, number][] {
  const out: [number, number][] = [];
  let from = signature.indexOf('(') + 1;
  for (const p of params) {
    const text = `${p.name}${p.type ? ` AS ${p.type}` : ''}${p.default ? ` = ${p.default}` : ''}`;
    const at = signature.indexOf(text, from);
    if (at < 0) {
      out.push([0, 0]);
      continue;
    }
    out.push([at, at + text.length]);
    from = at + text.length;
  }
  return out;
}

/** The call being typed at the end of `prefix` (masked code up to the cursor): its name and the argument index. */
export function callAt(prefix: string): { name: string; active: number } | undefined {
  let depth = 0;
  let commas = 0;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        const m = /([A-Za-z_]\w*)\s*$/.exec(prefix.slice(0, i));
        return m ? { name: m[1], active: commas } : undefined;
      }
      depth--;
    } else if (c === ',' && depth === 0) commas++;
  }
  return undefined;
}
