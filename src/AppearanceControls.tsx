import { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { GradientGeometryControls, GradientStopEditor } from './gradient-controls';
import { reverseGradientStops } from './gradient';
import type { GradientStop, Layer, TextStyle } from './types';
import { GRADIENT_PRESETS, MATERIAL_PRESETS } from './presets';
import { layerSvg } from './engine';
import { ColorField, NumberField, RangeField, Section, Toggle } from './Controls';

function hueShift(hex: string, degrees: number): string {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), d = max - min, l = (max + min) / 2;
  let h = 0;
  if (d) h = max === rgb[0] ? ((rgb[1] - rgb[2]) / d + 6) % 6 : max === rgb[1] ? (rgb[2] - rgb[0]) / d + 2 : (rgb[0] - rgb[1]) / d + 4;
  h = ((h * 60 + degrees) % 360 + 360) % 360;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = l - c / 2;
  const channels = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + channels.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
function MaterialPreview({ layer, patch }: { layer: Layer; patch: Partial<TextStyle> }) {
  const id = useId();
  const preview = { ...layer, id: `material-${id}`, x: layer.width / 2 + 42, y: layer.height / 2 + 40, rotation: -4, scaleX: 1, scaleY: 1, style: { ...layer.style, ...patch } };
  return <svg aria-hidden="true" viewBox={`0 0 ${layer.width + 100} ${layer.height + 100}`} dangerouslySetInnerHTML={{ __html: layerSvg(preview) }} />;
}
export default function AppearanceControls({ layer, onChange, onPreview, onCommit, gradientEditing, onEditGradient }: { layer: Layer; onChange: (patch: Partial<TextStyle>) => void; onPreview: (patch: Partial<TextStyle>) => void; onCommit: (patch: Partial<TextStyle>) => void; gradientEditing: boolean; onEditGradient: () => void }) {
  const style = layer.style;
  const stops = style.gradientStops?.length ? style.gradientStops : [{ offset: 0, color: style.fill }, { offset: 1, color: style.fill2 }];
  const updateStops = (next: GradientStop[]) => {
    const ordered = [...next].sort((a, b) => a.offset - b.offset);
    onChange({ gradientStops: ordered, fill: ordered[0].color, fill2: ordered.at(-1)!.color });
  };
  const cssStops = stops.map(s => `${s.color} ${s.offset * 100}%`).join(',');
  return <>
    <Section title="颜色与填充">
      <Toggle label="渐变填充" checked={style.gradient} onChange={v => onChange({ gradient: v })} />
      {!style.gradient ? <ColorField label="填充颜色" value={style.fill} onChange={fill => onChange({ fill })} /> : <>
        <div className="gradient-preview" style={{ background: style.gradientType === 'radial' ? `radial-gradient(ellipse at center,${cssStops})` : `linear-gradient(${style.gradientAngle + 90}deg,${cssStops})` }} />
        <div className="gradient-preset-grid">{GRADIENT_PRESETS.map(p => <button type="button" key={p.id} aria-label={`渐变预设 ${p.name}`} title={p.name} onClick={() => onChange({ gradient: true, gradientGeometry: undefined, gradientType: p.type, gradientAngle: p.angle, gradientStops: structuredClone(p.stops), fill: p.stops[0].color, fill2: p.stops.at(-1)!.color })} style={{ background: `linear-gradient(120deg,${p.stops.map(s => `${s.color} ${s.offset * 100}%`).join(',')})` }}><span>{p.name}</span></button>)}</div>
        <div className="segmented"><button type="button" className={style.gradientType !== 'radial' ? 'active' : ''} onClick={() => onChange({ gradientType: 'linear', gradientGeometry: undefined })}>线性渐变</button><button type="button" className={style.gradientType === 'radial' ? 'active' : ''} onClick={() => onChange({ gradientType: 'radial', gradientGeometry: undefined })}>径向渐变</button></div>
        <GradientGeometryControls layer={layer} onChange={onChange} editing={gradientEditing} onEdit={onEditGradient}/>
        <GradientStopEditor layer={layer} onChange={onChange} onPreview={onPreview} onCommit={onCommit}/>
        <div className="tone-actions"><button onClick={() => updateStops(stops.map(s => ({ ...s, color: hueShift(s.color, -15) })))}>色相 −15°</button><button title="反转颜色方向" aria-label="反转渐变" onClick={() => updateStops(reverseGradientStops([...stops].sort((a, b) => a.offset - b.offset)))}><RotateCcw size={14} /></button><button onClick={() => updateStops(stops.map(s => ({ ...s, color: hueShift(s.color, 15) })))}>色相 +15°</button></div>
      </>}
      <div className="palette-swatches">{['#ff9fc2', '#ffdb7c', '#b8e7e4', '#b7a4ed', '#f7f3eb', '#28252e'].map(c => <button aria-label={`填充颜色 ${c}`} style={{ background: c }} key={c} onClick={() => style.gradient ? updateStops(stops.map((s, i) => i === 0 ? { ...s, color: c } : s)) : onChange({ fill: c })} />)}</div>
    </Section>
    <Section title="文字材质" open={false}>
      <div className="material-grid">{MATERIAL_PRESETS.map(p => <button type="button" key={p.id} aria-label={`应用材质 ${p.name}`} title={p.description} className={(style.material || 'none') === p.id ? 'selected' : ''} onClick={() => onChange({ ...p.style, material: p.id })}><MaterialPreview layer={layer} patch={{ ...p.style, material: p.id }} /><span>{p.name}</span></button>)}</div>
      {style.material && style.material !== 'none' && <RangeField label="材质强度" value={style.materialStrength ?? 0.8} min={0} max={1} step={0.05} onChange={materialStrength => onChange({ materialStrength })} />}
      <p className="field-note">反光、颗粒和光带会随字形一起导出，也可以与多色渐变叠加。</p>
    </Section>
  </>;
}
