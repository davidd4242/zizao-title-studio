import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { GradientStop, Layer, TextStyle } from './types';
import { gradientRenderStops, gradientStops, layerGeometryBounds } from './engine';
import { gradientMetrics, setGradientMetrics } from './gradient';
import { ColorField, NumberField } from './Controls';
import './gradient.css';

type Props = { layer: Layer; onChange: (patch: Partial<TextStyle>) => void; onPreview: (patch: Partial<TextStyle>) => void; onCommit: (patch: Partial<TextStyle>) => void };
export function GradientGeometryControls({ layer, onChange, editing, onEdit }: Pick<Props, 'layer' | 'onChange'> & { editing: boolean; onEdit: () => void }) {
  const frame = layerGeometryBounds(layer), m = gradientMetrics(layer.style, frame), radial = (layer.style.gradientGeometry?.type ?? layer.style.gradientType) === 'radial';
  const update = (patch: Parameters<typeof setGradientMetrics>[2]) => onChange(setGradientMetrics(layer.style, frame, patch));
  return <div className="gradient-geometry-controls">
    <button type="button" className={`outline-button full ${editing ? 'active' : ''}`} aria-pressed={editing} onClick={onEdit}>在画布编辑渐变</button>
    {!radial ? <div className="two-fields"><NumberField label="渐变角度" value={m.angle} min={-360} max={360} step={1} suffix="°" onChange={angle => update({ angle })}/><NumberField label="渐变长度" value={m.length} min={0.01} max={50000} step={1} suffix="px" onChange={length => update({ length })}/></div>
      : <div className="two-fields"><NumberField label="渐变半径 X" value={m.radiusX} min={0.01} max={50000} suffix="px" onChange={radiusX => update({ radiusX })}/><NumberField label="渐变半径 Y" value={m.radiusY} min={0.01} max={50000} suffix="px" onChange={radiusY => update({ radiusY })}/></div>}
    {radial && <NumberField label="渐变角度" value={m.angle} min={-360} max={360} suffix="°" onChange={angle => update({ angle })}/>}
    <div className="two-fields"><NumberField label="渐变中心 X" value={m.center.x} suffix="px" onChange={centerX => update({ centerX })}/><NumberField label="渐变中心 Y" value={m.center.y} suffix="px" onChange={centerY => update({ centerY })}/></div>
    <p className="field-note">坐标相对图层；拖动端点实时预览，Shift 以 15° 吸附。</p>
  </div>;
}

export function GradientStopEditor({ layer, onChange, onPreview, onCommit }: Props) {
  const stops = gradientStops(layer.style);
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; kind: 'stop' | 'midpoint'; stops: GradientStop[]; patch: Partial<TextStyle> | null } | null>(null);
  const patchFor = (next: GradientStop[]): Partial<TextStyle> => ({ gradientStops: next, fill: next[0].color, fill2: next.at(-1)!.color });
  const update = (next: GradientStop[]) => onChange(patchFor(next));
  const bounded = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const position = (event: PointerEvent) => { const box = track.current!.getBoundingClientRect(); return bounded((event.clientX - box.left) / box.width); };
  const begin = (event: PointerEvent, index: number, kind: 'stop' | 'midpoint') => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget instanceof HTMLElement && event.currentTarget.focus();
    drag.current = { index, kind, stops: structuredClone(stops), patch: null }; setActive(index); track.current!.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const next = structuredClone(d.stops), i = d.index, value = position(event);
    if (d.kind === 'stop') next[i].offset = bounded(value, next[i - 1]?.offset ?? 0, next[i + 1]?.offset ?? 1);
    else { const span = next[i + 1].offset - next[i].offset; if (span <= 0) return; next[i].midpoint = bounded((value - next[i].offset) / span, 0.01, 0.99); }
    d.patch = patchFor(next); onPreview(d.patch);
  };
  const end = () => { const d = drag.current; drag.current = null; if (d?.patch) onCommit(d.patch); };
  const remove = (index: number) => { if (stops.length <= 2) return; const next = stops.filter((_, i) => i !== index); if (index > 0) delete next[index - 1]?.midpoint; setActive(Math.min(index, next.length - 1)); update(next); };
  const add = (offset?: number) => {
    if (stops.length >= 6) return;
    let interval = 0;
    for (let i = 1; i < stops.length - 1; i++) if (stops[i + 1].offset - stops[i].offset > stops[interval + 1].offset - stops[interval].offset) interval = i;
    const value = offset ?? (stops[interval].offset + stops[interval + 1].offset) / 2;
    const next = [...stops, { offset: value, color: '#fff3bd' }].sort((a, b) => a.offset - b.offset);
    setActive(next.findIndex(s => s.offset === value)); update(next);
  };
  const key = (event: KeyboardEvent, index: number, midpoint: boolean) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation();
      if (midpoint) update(stops.map((s, i) => i === index ? { ...s, midpoint: 0.5 } : s)); else remove(index);
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = structuredClone(stops), amount = (event.shiftKey ? 0.05 : 0.01) * (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1);
      if (midpoint) next[index].midpoint = bounded(event.key === 'Home' ? 0.01 : event.key === 'End' ? 0.99 : (next[index].midpoint ?? 0.5) + amount, 0.01, 0.99);
      else next[index].offset = bounded(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : next[index].offset + amount, next[index - 1]?.offset ?? 0, next[index + 1]?.offset ?? 1);
      update(next);
    }
  };
  const css = gradientRenderStops(layer.style).map(s => `${s.color} ${s.offset * 100}%`).join(',');
  return <div className="gradient-editor" data-gradient-editor>
    <div ref={track} className="gradient-track" data-testid="gradient-stop-track" style={{ background: `linear-gradient(to right,${css})` }} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onDoubleClick={event => { if (event.target === track.current) { const b = track.current.getBoundingClientRect(); add(bounded((event.clientX - b.left) / b.width)); } }}>
      {stops.map((stop, index) => <button type="button" key={`stop-${index}`} className={`gradient-stop-handle ${active === index ? 'selected' : ''}`} data-testid="gradient-stop" aria-label={`色标 ${index + 1}`} title={`颜色 ${index + 1} · ${Math.round(stop.offset * 100)}%`} style={{ left: `${stop.offset * 100}%`, backgroundColor: stop.color }} onFocus={() => setActive(index)} onPointerDown={event => begin(event, index, 'stop')} onKeyDown={event => key(event, index, false)}/>)}
      {stops.slice(0, -1).map((stop, index) => <button type="button" key={`midpoint-${index}`} className="gradient-midpoint-handle" data-testid="gradient-midpoint" aria-label={`中点 ${index + 1}`} title={`中点 ${Math.round((stop.midpoint ?? 0.5) * 100)}%`} style={{ left: `${(stop.offset + (stops[index + 1].offset - stop.offset) * (stop.midpoint ?? 0.5)) * 100}%` }} onPointerDown={event => begin(event, index, 'midpoint')} onKeyDown={event => key(event, index, true)}/>)}
    </div>
    <p className="field-note">双击色带加色；Tab 切换，方向键微调，Delete 删除。至少保留两色。</p>
    <details className="gradient-stop-details"><summary>编辑色标 · {stops.length} 个颜色</summary>
      <div className="gradient-stop-list">{stops.map((s, i) => <div className="gradient-stop-entry" key={i}><div className="gradient-stop-row">
        <ColorField label={`颜色 ${i + 1}`} value={s.color} onChange={color => update(stops.map((t, j) => j === i ? { ...t, color } : t))}/>
        <NumberField label={`位置 ${i + 1}`} value={s.offset * 100} min={(stops[i - 1]?.offset ?? 0) * 100} max={(stops[i + 1]?.offset ?? 1) * 100} suffix="%" onChange={offset => update(stops.map((t, j) => j === i ? { ...t, offset: offset / 100 } : t))}/>
        <button type="button" aria-label={`移除颜色 ${i + 1}`} disabled={stops.length <= 2} onClick={() => remove(i)}><Trash2 size={13}/></button>
      </div>{i < stops.length - 1 && <NumberField label={`中点位置 ${i + 1}`} value={(s.midpoint ?? 0.5) * 100} min={1} max={99} suffix="%" onChange={midpoint => update(stops.map((t, j) => j === i ? { ...t, midpoint: midpoint / 100 } : t))}/>}</div>)}</div>
      <button type="button" className="outline-button full" disabled={stops.length >= 6} onClick={() => add()}><Plus size={14}/>添加中间色</button>
    </details>
  </div>;
}
