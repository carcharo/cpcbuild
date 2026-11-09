/** The square tools bar above the grid: Copy, Paste, Clear and Transpose (narrow: one "Squares" menu), and a line saying what is selected. */
import { Toolbar, type ToolbarGroup, type ToolbarItem } from '../shared/components/Toolbar';

export interface SquaresBarProps {
  narrow: boolean;
  /** Something has been copied. */
  hasClip: boolean;
  /** "Selected: rows 5-12, channels A-B", or a hint when only the cursor's square is picked. */
  info: string;
  onCopy(): void;
  onPaste(): void;
  onClear(): void;
  onTranspose(semitones: number): void;
  onEscape(): void;
}

const TRANSPOSE: { id: string; label: string; semitones: number; shortcut: string }[] = [
  { id: 'up1', label: 'Up a semitone', semitones: 1, shortcut: 'Ctrl+Up' },
  { id: 'down1', label: 'Down a semitone', semitones: -1, shortcut: 'Ctrl+Down' },
  { id: 'up12', label: 'Up an octave', semitones: 12, shortcut: 'Ctrl+Shift+Up' },
  { id: 'down12', label: 'Down an octave', semitones: -12, shortcut: 'Ctrl+Shift+Down' },
];

export function SquaresBar(p: SquaresBarProps) {
  const transpose = TRANSPOSE.map((t) => ({ id: t.id, label: t.label, shortcut: t.shortcut, onActivate: () => p.onTranspose(t.semitones) }));
  const items: ToolbarItem[] = p.narrow
    ? [
        {
          kind: 'menu',
          id: 'squares',
          label: 'Squares: copy, paste, clear and transpose the selected squares',
          text: 'Squares',
          items: [
            { id: 'copy', label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onActivate: p.onCopy },
            { id: 'paste', label: 'Paste', icon: 'clippy', shortcut: 'Ctrl+V', disabled: !p.hasClip, onActivate: p.onPaste },
            { id: 'clear', label: 'Clear', icon: 'clear-all', shortcut: 'Delete', onActivate: p.onClear },
            ...transpose,
          ],
        },
      ]
    : [
        { kind: 'button', id: 'copy', label: 'Copy the selected squares', text: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onActivate: p.onCopy },
        { kind: 'button', id: 'paste', label: 'Paste the copied squares at the cursor', text: 'Paste', icon: 'clippy', shortcut: 'Ctrl+V', disabled: !p.hasClip, why: 'copy some squares first', onActivate: p.onPaste },
        { kind: 'button', id: 'clear', label: 'Clear the selected squares', text: 'Clear', icon: 'clear-all', shortcut: 'Delete', onActivate: p.onClear },
        { kind: 'menu', id: 'transpose', label: 'Transpose the selected squares', text: 'Transpose', items: transpose },
      ];
  const groups: ToolbarGroup[] = [{ label: 'Squares', items }];
  return (
    <div class="tk-sqbar">
      <Toolbar label="Square tools" groups={groups} look="pills" onEscape={p.onEscape} />
      {!p.narrow && <span class="cb-muted tk-selinfo">{p.info}</span>}
    </div>
  );
}
