import { useMemo, useState } from 'react';
import type { Layer, TextStyle } from './types';
import { applyLetterform, clearLetterform, LETTERFORM_PRESETS } from './letterforms';
import ArtworkPreview from './ArtworkPreview';
import { RangeField, Section } from './Controls';

const OUTLINE_STYLE: TextStyle = {
  fill: '#000000', fill2: '#000000', gradient: false, gradientAngle: 0,
  stroke: '#000000', strokeWidth: 0, outerStroke: '#000000', outerWidth: 0,
  shadowColor: '#000000', shadowX: 0, shadowY: 0, shadowBlur: 0,
  depth: 0, depthColor: '#000000', material: 'none', materialStrength: 0,
  texture: 'none', textureColor: '#000000', textureOpacity: 0, gloss: false, opacity: 1,
};

function unpainted(layer: Layer): Layer {
  if (!layer.glyphs.some(glyph => glyph.paint)) return layer;
  return { ...layer, glyphs: layer.glyphs.map(glyph => ({ ...glyph, paint: undefined })) };
}

export default function LetterformControls({ layer, onApply }: { layer: Layer; onApply: (next: Layer) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<'flourish' | 'gothic'>('flourish');
  const [previewMode, setPreviewMode] = useState<'outline' | 'appearance'>('outline');
  const editable = layer.kind === 'text' || layer.kind === 'path';
  const hasOutline = layer.glyphs.some(glyph => glyph.commands.length > 0);
  const amount = layer.letterform?.amount ?? 0.65;
  const previews = useMemo(() => {
    if (!expanded || !editable || !hasOutline) return [];
    return LETTERFORM_PRESETS.filter(preset => preset.category === category).map(preset => {
      try { return { preset, layer: applyLetterform(layer, preset.id, amount) }; }
      catch { return { preset, layer: null }; }
    });
  }, [layer, category, amount, expanded, editable, hasOutline]);
  const original = useMemo(() => expanded && editable && hasOutline
    ? layer.letterform ? clearLetterform(layer) : layer
    : null, [layer, expanded, editable, hasOutline]);
  const shownOriginal = useMemo(() => original && previewMode === 'outline' ? unpainted(original) : original, [original, previewMode]);
  const shownPreviews = useMemo(() => previews.map(preview => ({
    ...preview, layer: preview.layer && previewMode === 'outline' ? unpainted(preview.layer) : preview.layer,
  })), [previews, previewMode]);
  const previewStyle = previewMode === 'outline' ? OUTLINE_STYLE : undefined;

  if (!editable) return null;
  return <Section title="花体与哥特字形" open={expanded} onToggle={setExpanded}>
    {expanded && <div className="letterform-controls" data-testid="letterform-controls" data-preview-mode={previewMode}>
      <div className="letterform-preview-mode">
        <span>预览方式</span>
        <div className="segmented" role="group" aria-label="字形预览方式">
          <button type="button" aria-pressed={previewMode === 'outline'} className={previewMode === 'outline' ? 'active' : ''} onClick={() => setPreviewMode('outline')}>纯轮廓</button>
          <button type="button" aria-pressed={previewMode === 'appearance'} className={previewMode === 'appearance' ? 'active' : ''} onClick={() => setPreviewMode('appearance')}>当前外观</button>
        </div>
      </div>
      <p className="field-note letterform-preview-note">纯轮廓仅用于查看形状，应用会保留当前外观。</p>
      {shownOriginal && <div className="letterform-original" data-testid="letterform-original">
        <div className="letterform-original-label"><b>原字形对照</b><span>变形前</span></div>
        <ArtworkPreview layer={shownOriginal} style={previewStyle}/>
      </div>}
      <div className="segmented" role="group" aria-label="字形分类">
        <button type="button" aria-pressed={category === 'flourish'} className={category === 'flourish' ? 'active' : ''} onClick={() => setCategory('flourish')}>花体 · 5 款</button>
        <button type="button" aria-pressed={category === 'gothic'} className={category === 'gothic' ? 'active' : ''} onClick={() => setCategory('gothic')}>哥特 · 5 款</button>
      </div>
      {!hasOutline && <p className="letterform-empty" role="status">当前文字还没有可预览的轮廓。输入文字后可比较字形。</p>}
      {layer.locked && <p className="field-note" role="status">图层已锁定，解锁后可应用字形。</p>}
      <div className="letterform-grid">{shownPreviews.map(({ preset, layer: preview }) => <button
        key={preset.id} type="button" title={preset.description} aria-label={`应用字形 ${preset.name}`}
        data-letterform-id={preset.id} aria-pressed={layer.letterform?.presetId === preset.id}
        className={layer.letterform?.presetId === preset.id ? 'selected' : ''}
        disabled={layer.locked || !preview} onClick={() => onApply(applyLetterform(layer, preset.id, amount))}>
        {preview ? <ArtworkPreview layer={preview} style={previewStyle}/> : <span className="letterform-preview-error">此字形预览暂未就绪</span>}
        <b>{preset.name}</b><span>{preset.description}</span>
      </button>)}</div>
      {layer.letterform && <fieldset className="letterform-adjustments" disabled={layer.locked}>
        <RangeField label="字形变化强度" value={amount} min={0} max={1} step={0.01} onChange={value => onApply(applyLetterform(layer, layer.letterform!.presetId, value))}/>
        <button type="button" className="outline-button full" onClick={() => onApply(clearLetterform(layer))}>恢复原始字形</button>
      </fieldset>}
      <p className="field-note">修改轮廓并转为路径。切换样式、调整强度均从原字形重算；手动改过的节点请先复制图层保留。复杂中文可降低强度。</p>
    </div>}
  </Section>;
}
