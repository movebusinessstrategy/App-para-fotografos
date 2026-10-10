import { useEffect, useRef } from 'react';

/** Usa a área realmente visível quando o teclado do celular abre. */
export function useChatViewport(enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const element = ref.current;
    let frame = 0;
    const update = () => {
      if (!element) return;
      const mobile = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
      if (!mobile) {
        element.style.removeProperty('height');
        element.style.removeProperty('top');
        delete element.dataset.keyboardOpen;
        return;
      }
      if (viewport.scale !== 1) return;
      element.style.height = `${viewport.height}px`;
      if (getComputedStyle(element).position === 'fixed') element.style.top = `${viewport.offsetTop}px`;
      element.dataset.keyboardOpen = String(window.innerHeight - viewport.height > 150);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      element?.style.removeProperty('height');
      element?.style.removeProperty('top');
      if (element) delete element.dataset.keyboardOpen;
    };
  }, [enabled]);
  return ref;
}
