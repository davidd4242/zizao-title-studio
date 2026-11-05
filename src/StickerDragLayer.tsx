import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Layer } from './types';
import { createSticker } from './presets';
import ArtworkPreview from './ArtworkPreview';

export type StickerDrop = { kind: 'canvas'; clientX: number; clientY: number } | { kind: 'layers'; afterId?: string };
export type StickerDragHandle = { begin: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void; consumeClick: () => boolean };
type Visual = { layer: Layer; x: number; y: number; target: 'canvas' | 'layers' | null };
type Session = { id: string; pointer: number; x: number; y: number; active: boolean; layer: Layer };

function targetAt(x: number, y: number): { target: Element | null; drop: StickerDrop | null } {
  const elements = document.elementsFromPoint(x, y);
  for (const element of elements) {
    const target = element.closest('[data-sticker-drop]');
    if (!target) continue;
    if (target.getAttribute('data-sticker-drop') === 'canvas') return { target, drop: { kind: 'canvas', clientX: x, clientY: y } };
    return { target, drop: { kind: 'layers', afterId: element.closest('[data-layer-drop-id]')?.getAttribute('data-layer-drop-id') || undefined } };
  }
  return { target: null, drop: null };
}

export default forwardRef<StickerDragHandle, { onDrop: (id: string, target: StickerDrop) => void; onLayersHover: () => void }>(function StickerDragLayer({ onDrop, onLayersHover }, ref) {
  const [visual, setVisual] = useState<Visual | null>(null);
  const session = useRef<Session | null>(null), suppressed = useRef(false), highlight = useRef<Element | null>(null);
  const callbacks = useRef({ onDrop, onLayersHover }); callbacks.current = { onDrop, onLayersHover };
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null), hoverTab = useRef(false);
  const clearHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = null; hoverTab.current = false; };
  const cleanup = () => {
    clearHover(); highlight.current?.classList.remove('sticker-drop-active'); highlight.current = null;
    document.body.classList.remove('dragging-sticker'); session.current = null; setVisual(null);
  };
  useImperativeHandle(ref, () => ({
    begin(id, event) {
      if (event.button !== 0 || !event.isPrimary) return;
      suppressed.current = false;
      session.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, active: false, layer: createSticker(id, 0, 0) };
    },
    consumeClick() { const value = suppressed.current; suppressed.current = false; return value; },
  }));
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointer) return;
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
      current.active = true; suppressed.current = true; event.preventDefault();
      document.body.classList.add('dragging-sticker');
      const { target, drop } = targetAt(event.clientX, event.clientY);
      if (highlight.current !== target) { highlight.current?.classList.remove('sticker-drop-active'); target?.classList.add('sticker-drop-active'); highlight.current = target; }
      const isTab = Boolean(target?.hasAttribute('data-layers-tab'));
      if (isTab && !hoverTab.current) { hoverTab.current = true; hoverTimer.current = setTimeout(() => { callbacks.current.onLayersHover(); hoverTimer.current = null; }, 350); }
      else if (!isTab) clearHover();
      setVisual({ layer: current.layer, x: event.clientX, y: event.clientY, target: drop?.kind || null });
    };
    const end = (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointer) return;
      const drop = current.active ? targetAt(event.clientX, event.clientY).drop : null;
      if (current.active) event.preventDefault();
      cleanup();
      if (drop) callbacks.current.onDrop(current.id, drop);
    };
    const cancel = () => cleanup();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.current) { suppressed.current = true; cleanup(); } };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key); clearHover(); highlight.current?.classList.remove('sticker-drop-active'); document.body.classList.remove('dragging-sticker'); };
  }, []);
  if (!visual) return null;
  return createPortal(<div className="sticker-drag-preview" data-testid="sticker-drag-preview" data-target={visual.target || 'none'} style={{ left: visual.x, top: visual.y }}><div className="sticker-drag-art"><ArtworkPreview layer={visual.layer}/></div><span>{visual.target === 'canvas' ? '松开，放到这里' : visual.target === 'layers' ? '松开，新增装饰图层' : '拖到画布或图层'}</span></div>, document.body);
});
