/**
 * A VS Code-styled tooltip for icon buttons. The webview's native `title` tooltips do not show, so a button
 * takes `tip.props(id, text)` and the component renders `tip.node` once. It shows after TIP_DELAY on hover and at
 * once on keyboard focus, hides on leave, blur, click and Escape, and the button gets aria-describedby while it is shown.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { anchorLive, placeTip, TIP_DELAY } from '../tooltip';

interface Shown {
  id: string;
  text: string;
  anchor: HTMLElement;
}

let seq = 0;

export function useTooltip() {
  const [shown, setShown] = useState<Shown | undefined>();
  const [pos, setPos] = useState<{ left: number; top: number } | undefined>();
  const timer = useRef<number | undefined>(undefined);
  const el = useRef<HTMLDivElement>(null);
  const uid = useRef(`cb-tip-${++seq}`);
  const clear = (): void => window.clearTimeout(timer.current);
  const hide = (): void => {
    clear();
    setShown(undefined);
    setPos(undefined);
  };
  useEffect(() => clear, []); // also stops a pending show when the owner unmounts
  useEffect(() => {
    if (!shown) return;
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide();
    };
    // the anchor was removed or replaced by a re-render while the tip is up: drop the tip
    const mo = new MutationObserver(() => {
      if (!anchorLive(shown.anchor)) hide();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      mo.disconnect();
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [shown]);
  // measured after it renders (hidden until placed), so it can be kept inside the viewport
  useLayoutEffect(() => {
    if (!shown || !el.current) return;
    if (!anchorLive(shown.anchor)) return hide();
    const a = shown.anchor.getBoundingClientRect();
    const t = el.current.getBoundingClientRect();
    setPos(placeTip({ left: a.left, top: a.top, width: a.width, height: a.height }, { width: t.width, height: t.height }, { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }));
  }, [shown]);

  const show = (id: string, text: string, anchor: HTMLElement, delay: number): void => {
    clear();
    const go = (): void => {
      if (anchorLive(anchor)) setShown({ id, text, anchor });
    };
    if (delay > 0) timer.current = window.setTimeout(go, delay);
    else go();
  };
  return {
    /** Event handlers (and aria-describedby while shown) for the element that carries the tip. */
    props: (id: string, text: string) => ({
      onMouseEnter: (e: MouseEvent) => show(id, text, e.currentTarget as HTMLElement, TIP_DELAY),
      onMouseLeave: hide,
      onMouseDown: hide,
      onPointerDown: hide,
      onClick: hide,
      onFocusIn: (e: FocusEvent) => {
        const t = e.currentTarget as HTMLElement;
        if (t.matches(':focus-visible')) show(id, text, t, 0);
      },
      onFocusOut: hide,
      'aria-describedby': shown?.id === id ? uid.current : undefined,
    }),
    node: shown ? (
      <div ref={el} id={uid.current} class="cb-tooltip" role="tooltip" style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { left: '0', top: '0', visibility: 'hidden' }}>
        {shown.text}
      </div>
    ) : null,
  };
}
