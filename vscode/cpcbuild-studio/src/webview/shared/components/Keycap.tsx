/** <cb-kbd>: keycaps for a shortcut ("Ctrl", "Shift", "Esc"; a "+" key is named Plus); the group is named "Ctrl+Shift+Esc" for screen readers. */
export function Keycap({ keys }: { keys: string[] }) {
  return (
    <span class="cb-kbd-group" role="img" aria-label={keys.map((k) => (k === '+' ? 'Plus' : k)).join('+')}>
      {keys.map((k, i) => (
        <kbd key={i} class="cb-kbd" aria-hidden="true">{k}</kbd>
      ))}
    </span>
  );
}
