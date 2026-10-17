/**
 * cpcgrid.ts -- the geometry of the importer's grid extraction (margins, spacing, cells, the
 * composed sheet's shape). Pure arithmetic, shared by the host and the importer webview.
 */

export interface GridSpec {
  cellW: number;
  cellH: number;
  marginX: number;
  marginY: number;
  spacingX: number;
  spacingY: number;
  /** Cells per row of the composed sheet; default = the columns found in the source. */
  columns?: number;
  /** Cell indices (reading order over the source grid) left out of the sheet. */
  exclude: number[];
}

export interface GridLayout {
  /** Cells found in the source. */
  cols: number;
  rows: number;
  /** Pixels at the right / bottom that fit no cell. */
  leftoverX: number;
  leftoverY: number;
  /** Indices of the cells in the sheet, in order. */
  selected: number[];
  /** Columns of the composed sheet. */
  sheetCols: number;
  sheetRows: number;
}

export function gridLayout(g: GridSpec, width: number, height: number): GridLayout {
  const fit = (total: number, margin: number, cell: number, spacing: number): number => (cell < 1 || total < margin + cell ? 0 : Math.floor((total - margin + spacing) / (cell + spacing)));
  const cols = fit(width, g.marginX, g.cellW, g.spacingX);
  const rows = fit(height, g.marginY, g.cellH, g.spacingY);
  const used = (n: number, cell: number, spacing: number): number => (n ? n * cell + (n - 1) * spacing : 0);
  const ex = new Set(g.exclude);
  const selected: number[] = [];
  for (let i = 0; i < cols * rows; i++) if (!ex.has(i)) selected.push(i);
  const sheetCols = selected.length ? Math.max(1, Math.min(g.columns ?? cols, selected.length)) : 0;
  return {
    cols,
    rows,
    leftoverX: Math.max(0, width - g.marginX - used(cols, g.cellW, g.spacingX)),
    leftoverY: Math.max(0, height - g.marginY - used(rows, g.cellH, g.spacingY)),
    selected,
    sheetCols,
    sheetRows: sheetCols ? Math.ceil(selected.length / sheetCols) : 0,
  };
}

/** The default grid for a sheet: the frame size if given, else the biggest power-of-two cell dividing both sides. */
export function defaultGrid(width: number, height: number, frame?: string): GridSpec {
  let cw = 0, ch = 0;
  const m = frame ? /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(frame) : null;
  if (m) {
    cw = Number(m[1]);
    ch = Number(m[2]);
  }
  if (!(cw >= 1 && ch >= 1)) {
    let p = 1;
    while (p * 2 <= 64 && width % (p * 2) === 0 && height % (p * 2) === 0) p *= 2;
    cw = ch = p;
  }
  return { cellW: cw, cellH: ch, marginX: 0, marginY: 0, spacingX: 0, spacingY: 0, exclude: [] };
}
