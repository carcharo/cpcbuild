/** The pattern grid: role="grid", three channels, rows numbered by beat; one tab stop, the cursor is aria-activedescendant. */
import { useEffect, useRef } from 'preact/hooks';
import type { SongDoc, SongEvent } from '../../core/songDoc';
import { instrumentOf } from '../../core/songInstruments';
import { songNoteName } from '../../core/songDoc';
import { Icon } from '../shared/components/Icon';
import { idIndex, idVar } from '../shared/theme';
import { CHANNEL_LETTERS, beatLabel, cellName, type Cursor } from './logic';

export const GRID_ID = 'tk-grid';
export const cellId = (row: number, channel: number): string => `tk-cell-${row}-${channel}`;

export interface GridProps {
  doc: SongDoc;
  pattern: number;
  cursor: Cursor;
  /** The playing row of this pattern, or -1. */
  playRow: number;
  narrow: boolean;
  /** Bit 0 = A. */
  mute: number;
  onCursor(c: Cursor): void;
  onToggleMute(channel: number): void;
  onKeyDown(e: KeyboardEvent): void;
  gridRef: { current: HTMLDivElement | null };
}

function Square({ ev, doc, narrow }: { ev: SongEvent; doc: SongDoc; narrow: boolean }) {
  if (ev.note === 'off') return <span class="tk-sq tk-sq-off" aria-hidden="true">off</span>;
  const inst = instrumentOf(doc, ev.inst);
  const id = inst ? idIndex(inst.colour) ?? 11 : 11;
  return (
    <span class="tk-sq" aria-hidden="true" style={{ '--cb-id': idVar(id) } as never}>
      <span class="tk-note">{songNoteName(ev.note)}</span>
      <span class="tk-inst">
        <span class="tk-dot">●</span>
        {narrow ? (inst?.id ?? ev.inst) : (inst?.name ?? ev.inst)}
      </span>
      {ev.vol !== undefined && <span class="tk-vol">vol {ev.vol}</span>}
    </span>
  );
}

export function Grid(p: GridProps) {
  const pat = p.doc.patterns[p.pattern];
  const rpb = p.doc.rowsPerBeat ?? 4;
  const maps = pat.channels.map((ch) => new Map(ch.map((e) => [e.row, e])));
  const scroller = useRef<HTMLDivElement>(null);
  // keep the cursor and the playhead in view (nearest: nothing moves while they are visible)
  useEffect(() => { document.getElementById(cellId(p.cursor.row, p.cursor.channel))?.scrollIntoView({ block: 'nearest' }); }, [p.cursor.row, p.cursor.channel, p.pattern]);
  useEffect(() => { if (p.playRow >= 0) document.getElementById(cellId(p.playRow, 0))?.scrollIntoView({ block: 'nearest' }); }, [p.playRow]);
  const rows: number[] = Array.from({ length: pat.rows }, (_, i) => i);
  return (
    <div class="tk-scroll" ref={scroller}>
      <div
        id={GRID_ID}
        class="tk-grid"
        role="grid"
        tabIndex={0}
        ref={p.gridRef}
        aria-label={`Pattern ${String.fromCharCode(65 + p.pattern)}, ${pat.rows} rows`}
        aria-rowcount={pat.rows + 1}
        aria-colcount={4}
        aria-activedescendant={cellId(p.cursor.row, p.cursor.channel)}
        onKeyDown={p.onKeyDown as never}
      >
        <div class="tk-row tk-head" role="row">
          <div class="tk-rowhead" role="columnheader" aria-label="Beat" />
          {CHANNEL_LETTERS.map((l, c) => {
            const muted = (p.mute & (1 << c)) !== 0;
            return (
              <div key={l} class={`tk-colhead${muted ? ' tk-muted-head' : ''}`} role="columnheader">
                <span class="tk-chan">Channel {l}</span>
                <button type="button" class="cb-pill cb-pill-xs tk-mute" tabIndex={-1} aria-pressed={muted} aria-label={`Mute channel ${l}`} title={`Mute channel ${l} (Alt+M on the cursor's channel)`} onClick={() => p.onToggleMute(c)}>
                  <Icon name={muted ? 'mute' : 'unmute'} />
                  <span>{muted ? 'Muted' : 'Mute'}</span>
                </button>
              </div>
            );
          })}
        </div>
        {rows.map((r) => (
          <div key={r} class="tk-row" role="row" aria-rowindex={r + 2} data-beat={r % rpb === 0 ? 'true' : undefined} aria-current={r === p.playRow ? 'true' : undefined}>
            <div class="tk-rowhead" role="rowheader" aria-label={`Row ${r + 1}`}>
              {r === p.playRow && <Icon name="play" />}
              <span aria-hidden="true">{beatLabel(r, rpb)}</span>
            </div>
            {[0, 1, 2].map((c) => {
              const ev = maps[c].get(r);
              const cur = r === p.cursor.row && c === p.cursor.channel;
              return (
                <div
                  key={c}
                  id={cellId(r, c)}
                  class={`tk-cell${cur ? ' tk-cur' : ''}${(p.mute & (1 << c)) !== 0 ? ' tk-muted' : ''}`}
                  role="gridcell"
                  aria-selected={cur}
                  aria-label={cellName(r, c, ev, p.doc)}
                  onClick={() => { p.onCursor({ row: r, channel: c }); p.gridRef.current?.focus(); }}
                >
                  {ev ? <Square ev={ev} doc={p.doc} narrow={p.narrow} /> : <span class="tk-empty" aria-hidden="true">· · ·</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
