/**
 * libdocs.ts -- maps routine names to sections of docs/library.md by heading
 * text (never by section number: the numbers in that file drift).
 */

export interface DocHeading {
  /** 0-based line. */
  line: number;
  level: number;
  /** Heading text without the leading #s. */
  text: string;
  /** GitHub-style anchor. */
  slug: string;
}

export interface DocsIndex {
  headings: DocHeading[];
  /** lower-case routine name -> index into headings (the section whose table lists it). */
  byName: Map<string, number>;
  /** lower-case library file path (as written in backticks in a heading) -> heading index. */
  byFile: Map<string, number>;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9 _-]/g, '')
    .trim()
    .replace(/ /g, '-');
}

export function indexDocs(markdown: string): DocsIndex {
  const headings: DocHeading[] = [];
  const byName = new Map<string, number>();
  const byFile = new Map<string, number>();
  let fence = false;
  markdown.split(/\r?\n/).forEach((l, line) => {
    if (/^\s*```/.test(l)) fence = !fence;
    if (fence) return;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) {
      headings.push({ line, level: h[1].length, text: h[2], slug: slugify(h[2]) });
      for (const f of h[2].matchAll(/`([^`]+\.bas)`/g)) if (!byFile.has(f[1].toLowerCase())) byFile.set(f[1].toLowerCase(), headings.length - 1);
      return;
    }
    // table rows: the names in the first cell
    const row = /^\|\s*([^|]+?)\s*\|/.exec(l);
    if (row && headings.length && /`/.test(row[1]) && !/^\|\s*-/.test(l)) {
      for (const n of row[1].matchAll(/`([A-Za-z_]\w*)/g)) {
        const k = n[1].toLowerCase();
        if (!byName.has(k)) byName.set(k, headings.length - 1);
      }
    }
  });
  return { headings, byName, byFile };
}

/** The section documenting a routine: its table row's heading, else the heading naming its file. */
export function sectionFor(docs: DocsIndex, name: string, file?: string): DocHeading | undefined {
  const i = docs.byName.get(name.toLowerCase()) ?? (file ? docs.byFile.get(file.toLowerCase()) : undefined);
  return i === undefined ? undefined : docs.headings[i];
}
