/** theme.ts -- reading VS Code theme variables, and noticing a theme switch (UX 5.3, 5.6). */
import { useEffect, useState } from 'preact/hooks';

/** The current value of a --vscode-* variable (or any CSS variable) on the body. */
export function themeVar(name: string, fallback = ''): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

/** True under a high-contrast theme. */
export function isHighContrast(): boolean {
  return document.body.classList.contains('vscode-high-contrast') || document.body.classList.contains('vscode-high-contrast-light');
}

/** A counter that changes when VS Code switches theme (body class list changes); use it to redraw canvases. */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setV((x) => x + 1));
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return v;
}

/** Colour with alpha from a theme variable holding #rgb/#rrggbb/rgb(): used for grid lines. */
export function withAlpha(colour: string, alpha: number): string {
  const c = colour.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${alpha})`;
  }
  return c;
}
