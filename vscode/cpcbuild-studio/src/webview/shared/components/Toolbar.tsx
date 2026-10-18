/** <cb-toolbar> (UX 2.1) and the small menu it uses (UX 2.7). One tab stop (roving tabindex); arrows, Home/End move; Esc calls onEscape. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { tipText } from '../tooltip';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onActivate(): void;
}

interface Common {
  id: string;
  /** Accessible name and tooltip base; the shortcut is appended: "Pencil (B)". */
  label: string;
  icon?: string;
  /** Visible text next to (or instead of) the icon. */
  text?: string;
  shortcut?: string;
  disabled?: boolean;
  /** Why it is disabled; shown in the tooltip: "Undo (nothing to undo)". */
  why?: string;
}
export interface ToolbarButton extends Common { kind: 'button'; onActivate(): void; pressed?: boolean }
export interface ToolbarRadio extends Common { kind: 'radio'; checked: boolean; onActivate(): void }
export interface ToolbarMenu extends Common { kind: 'menu'; items: MenuItem[] }
export type ToolbarItem = ToolbarButton | ToolbarRadio | ToolbarMenu;
export interface ToolbarGroup {
  label: string;
  items: ToolbarItem[];
  /** Renders the group as a radiogroup (its items are `radio`s). */
  radio?: boolean;
}

const tip = tipText;

export function Toolbar({ label, groups, onEscape }: { label: string; groups: ToolbarGroup[]; onEscape?: () => void }) {
  const items = groups.flatMap((g) => g.items);
  const checked = items.find((i) => i.kind === 'radio' && i.checked);
  const [active, setActive] = useState<string>(checked?.id ?? items[0]?.id ?? '');
  const root = useRef<HTMLDivElement>(null);
  const tt = useTooltip();
  const focusId = (id: string): void => {
    setActive(id);
    root.current?.querySelector<HTMLElement>(`[data-tb="${CSS.escape(id)}"]`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const cur = items.findIndex((i) => i.id === (e.target as HTMLElement).closest<HTMLElement>('[data-tb]')?.dataset.tb);
    if (cur < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusId(items[(cur + 1) % items.length].id); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusId(items[(cur - 1 + items.length) % items.length].id); }
    else if (e.key === 'Home') { e.preventDefault(); focusId(items[0].id); }
    else if (e.key === 'End') { e.preventDefault(); focusId(items[items.length - 1].id); }
    else if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); }
  };
  return (
    <div class="cb-toolbar" role="toolbar" aria-label={label} aria-orientation="horizontal" ref={root} onKeyDown={onKeyDown as never}>
      {groups.map((g) => (
        <div key={g.label} class="cb-tb-group" role={g.radio ? 'radiogroup' : 'group'} aria-label={g.label}>
          {g.items.map((it) => {
            const common = { 'data-tb': it.id, tabIndex: it.id === active ? 0 : -1, ...tt.props(it.id, tip(it)), onFocus: () => setActive(it.id) };
            const body = (
              <>
                {it.icon && <Icon name={it.icon} />}
                {it.text && <span class="cb-tb-text">{it.text}</span>}
              </>
            );
            if (it.kind === 'menu') return <MenuButton key={it.id} item={it} common={common} body={body} />;
            if (it.kind === 'radio')
              return (
                <button key={it.id} type="button" role="radio" aria-checked={it.checked} aria-label={tip(it)} class={`cb-tb-btn${it.checked ? ' cb-on' : ''}`} {...common} onClick={it.onActivate}>
                  {body}
                </button>
              );
            return (
              <button
                key={it.id}
                type="button"
                aria-label={tip(it)}
                aria-disabled={it.disabled ? 'true' : undefined}
                aria-pressed={it.pressed === undefined ? undefined : it.pressed}
                class={`cb-tb-btn${it.pressed ? ' cb-on' : ''}${it.disabled ? ' cb-disabled' : ''}`}
                {...common}
                onClick={() => !it.disabled && it.onActivate()}
              >
                {body}
              </button>
            );
          })}
        </div>
      ))}
      {tt.node}
    </div>
  );
}

function MenuButton({ item, common, body }: { item: ToolbarMenu; common: Record<string, unknown>; body: preact.ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = (restore = true): void => {
    setOpen(false);
    if (restore) btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled])')?.focus();
    const away = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const menuKey = (e: KeyboardEvent): void => {
    const els = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number): void => { e.preventDefault(); els[(n + els.length) % els.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) {
      const n = els.findIndex((el, k) => k > i && (el.textContent ?? '').trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (n >= 0) go(n);
    }
  };
  return (
    <div class="cb-menu-wrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tip(item)}
        class={`cb-tb-btn${item.disabled ? ' cb-disabled' : ''}`}
        {...common}
        onClick={() => !item.disabled && setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !item.disabled) { e.preventDefault(); e.stopPropagation(); setOpen(true); }
        }}
      >
        {body}
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div class="cb-menu" role="menu" aria-label={item.label} onKeyDown={menuKey as never}>
          {item.items.map((m) => (
            <button
              key={m.id}
              type="button"
              role={m.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={m.checked}
              aria-disabled={m.disabled ? 'true' : undefined}
              tabIndex={-1}
              class="cb-menu-item"
              onClick={() => {
                if (m.disabled) return;
                close();
                m.onActivate();
              }}
            >
              <span class="cb-menu-check">{m.checked ? <Icon name="check" /> : m.icon ? <Icon name={m.icon} /> : null}</span>
              <span>{m.label}</span>
              {m.shortcut && <span class="cb-menu-key">{m.shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
