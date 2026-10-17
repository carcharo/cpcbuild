/** A small nearest-neighbour picture of an RGBA block (frame strip, tile sheet, preview). */
import { useEffect, useRef } from 'preact/hooks';

export function Thumb({ rgba, w, h, box, aw = 1, scale, label, class: cls }: { rgba: Uint8ClampedArray; w: number; h: number; box?: number; aw?: number; scale?: number; label?: string; class?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  }, [rgba, w, h]);
  const s = scale ?? Math.max(1, (box ?? 48) / Math.max(w * aw, h));
  return <canvas ref={ref} class={`sp-thumb ${cls ?? ''}`} width={w} height={h} style={{ width: `${Math.round(w * s * aw)}px`, height: `${Math.round(h * s)}px` }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} />;
}
