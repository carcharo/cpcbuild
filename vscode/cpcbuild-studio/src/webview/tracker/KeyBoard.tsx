/** The keycap board: the note keys of the computer keyboard laid out as on the keyboard, each showing its letter and its note; clicking enters the note. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { rovingNext } from '../shared/roving';
import { BOARD_ROWS, isSharpCode, keyNoteLabel, noteForCode, spokenNote } from './logic';

/** code -> the character that key types on this keyboard layout (AZERTY, QWERTZ ...), from the Keyboard Map API when the page has it. */
export function useLayoutMap(): Map<string, string> | undefined {
  const [map, setMap] = useState<Map<string, string> | undefined>();
  useEffect(() => {
    let live = true;
    try {
      const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
      void kb?.getLayoutMap?.().then((m) => { if (live) setMap(m); }).catch(() => undefined);
    } catch {
      // no layout map: QWERTY letters
    }
    return () => { live = false; };
  }, []);
  return map;
}

export function KeyBoard({ octave, layout, onKey }: { octave: number; layout: Map<string, string> | undefined; onKey(code: string): void }) {
  const flat = BOARD_ROWS.flat();
  const root = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | undefined>();
  const off = (i: number): boolean => noteForCode(flat[i].code, octave) === undefined;
  const first = flat.findIndex((_, i) => !off(i));
  const tabbable = focused !== undefined && !off(focused) ? focused : first;
  const onKeyDown = (e: KeyboardEvent, i: number): void => {
    const n = rovingNext(flat.length, i, e.key, { disabled: off });
    if (n === undefined) return;
    e.preventDefault();
    root.current?.querySelectorAll<HTMLElement>('button')[n]?.focus();
  };
  let at = -1;
  return (
    <div class="tk-board" role="group" aria-label="Computer keyboard note map" ref={root}>
      {BOARD_ROWS.map((row, ri) => (
        <div key={ri} class={`tk-keyrow tk-keyrow-${ri}`}>
          {row.map((k) => {
            at++;
            const i = at;
            const n = noteForCode(k.code, octave);
            const letter = (layout?.get(k.code) ?? k.letter).toUpperCase();
            const unused = n === undefined;
            const label = unused ? `${letter}: no note` : n === 'off' ? `${letter}: note off` : `${letter}: ${spokenNote(n)}`;
            return (
              <button
                key={k.code}
                type="button"
                class={`cb-kbd cb-kbd-big tk-key${unused ? ' cb-kbd-off' : ''}${isSharpCode(k.code) ? ' tk-sharp' : ''}${n === 'off' ? ' tk-offkey' : ''}`}
                aria-label={label}
                aria-disabled={unused ? 'true' : undefined}
                tabIndex={i === tabbable ? 0 : -1}
                onFocus={() => setFocused(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onClick={() => { if (!unused) onKey(k.code); }}
              >
                <span class="tk-key-l" aria-hidden="true">{letter}</span>
                <span class="tk-key-n" aria-hidden="true">{unused ? '' : keyNoteLabel(k.code, octave)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
