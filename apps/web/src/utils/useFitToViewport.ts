import { useLayoutEffect, useRef, useState } from 'react';

// Full-screen pages (Live Prediction …): the page is exactly as tall as the room left under the
// header, so the browser never shows a page scrollbar and each panel scrolls inside itself.
// Re-measured whenever something above it changes size (header, a notice bar, fonts loading) and
// on window resize — not only once — so a few pixels added after the first paint can't push the
// page past the screen. `min` keeps a usable height on very short windows.
export function useFitToViewport<T extends HTMLElement>(min = 520) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      // distance from the top of the document to the page, whatever is scrolled
      const top = el.getBoundingClientRect().top + window.scrollY + (el.parentElement?.scrollTop || 0);
      const h = Math.max(min, Math.floor(window.innerHeight - top));
      setHeight(prev => (prev === h ? prev : h));
    };
    measure();
    window.addEventListener('resize', measure);
    // anything above the page changing size (header, notices) moves it down / up
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    if (ro && document.body) ro.observe(document.body);
    const header = ref.current?.parentElement?.parentElement?.previousElementSibling;
    if (ro && header) ro.observe(header);
    // web fonts finishing can change the header's height after the first paint
    (document as any).fonts?.ready?.then?.(measure).catch?.(() => undefined);
    const t = window.setTimeout(measure, 300);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
      window.clearTimeout(t);
    };
  }, [min]);

  return { ref, height };
}
