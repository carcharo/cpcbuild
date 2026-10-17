/**
 * shapes.ts -- the point sets of the drawing tools (line, rectangle, ellipse) and flood fill, as pure
 * functions on integer pixel coordinates. The webview uses them to preview a gesture and to build the
 * `paint` operation; the document model uses `floodRegion` for the fill operation.
 */

export type Pt = readonly [number, number];

/** Bresenham line, both ends included. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Pt[] {
  const out: Pt[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Snap the end of a line to 0, 45 or 90 degrees from the start (Shift). */
export function snapLine(x0: number, y0: number, x1: number, y1: number): Pt {
  const dx = x1 - x0, dy = y1 - y0;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > 2 * ay) return [x1, y0];
  if (ay > 2 * ax) return [x0, y1];
  const d = Math.max(ax, ay);
  return [x0 + Math.sign(dx) * d, y0 + Math.sign(dy) * d];
}

/** Rectangle between two corners (any order): outline or filled. */
export function rectCells(x0: number, y0: number, x1: number, y1: number, filled: boolean): Pt[] {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  const out: Pt[] = [];
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) if (filled || x === xa || x === xb || y === ya || y === yb) out.push([x, y]);
  return out;
}

/** Ellipse inscribed in the box between two corners (Zingl's midpoint algorithm): outline or filled. */
export function ellipseCells(xa: number, ya: number, xb: number, yb: number, filled: boolean): Pt[] {
  let x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
  const left = x0, top = y0;
  const w = x1 - x0, h = y1 - y0;
  if (w <= 1 || h <= 1) return rectCells(x0, y0, x1, y1, true); // two pixels across or less: the ellipse is its box
  const pts = new Map<number, Pt>();
  const plot = (x: number, y: number): void => void pts.set(y * 100000 + x, [x, y]);
  let a = w, b = h;
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a = 8 * a * a;
  b1 = 8 * b * b;
  do {
    plot(x1, y0); plot(x0, y0); plot(x0, y1); plot(x1, y1);
    const e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; dy += a; err += dy; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; dx += b1; err += dx; }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    plot(x0 - 1, y0); plot(x1 + 1, y0++); plot(x0 - 1, y1); plot(x1 + 1, y1--);
  }
  const list = [...pts.values()].filter(([x, y]) => x >= left && x <= left + w && y >= top && y <= top + h);
  if (!filled) return list;
  // fill: every row from its leftmost to its rightmost outline pixel
  const rows = new Map<number, [number, number]>();
  for (const [x, y] of list) {
    const r = rows.get(y);
    if (!r) rows.set(y, [x, x]);
    else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
  }
  const out: Pt[] = [];
  for (const [y, [lo, hi]] of [...rows.entries()].sort((p, q) => p[0] - q[0])) for (let x = lo; x <= hi; x++) out.push([x, y]);
  return out;
}

/** The 4-connected region of cells equal to the cell at (x, y), optionally inside `box`. */
export function floodRegion(grid: readonly (readonly number[])[], x: number, y: number, box?: { x: number; y: number; w: number; h: number }): Pt[] {
  const h = grid.length, w = h ? grid[0].length : 0;
  const bx0 = box ? Math.max(0, box.x) : 0, by0 = box ? Math.max(0, box.y) : 0;
  const bx1 = box ? Math.min(w, box.x + box.w) : w, by1 = box ? Math.min(h, box.y + box.h) : h;
  if (x < bx0 || x >= bx1 || y < by0 || y >= by1) return [];
  const target = grid[y][x];
  const seen = new Uint8Array(w * h);
  const out: Pt[] = [];
  const stack: Pt[] = [[x, y]];
  seen[y * w + x] = 1;
  while (stack.length) {
    const [cx, cy] = stack.pop() as Pt;
    out.push([cx, cy]);
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as Pt[]) {
      if (nx < bx0 || nx >= bx1 || ny < by0 || ny >= by1) continue;
      const i = ny * w + nx;
      if (seen[i] || grid[ny][nx] !== target) continue;
      seen[i] = 1;
      stack.push([nx, ny]);
    }
  }
  return out;
}

/** Mirror a point about the vertical and/or horizontal centre axis of a w x h frame: the stamps of symmetric drawing. */
export function mirrorPoints(x: number, y: number, w: number, h: number, mx: boolean, my: boolean): Pt[] {
  const out: Pt[] = [[x, y]];
  if (mx) out.push([w - 1 - x, y]);
  if (my) out.push([x, h - 1 - y]);
  if (mx && my) out.push([w - 1 - x, h - 1 - y]);
  return out;
}
