import { useMemo } from 'react';
import { Download, Layers3, LoaderCircle } from 'lucide-react';
import type { ExportOptions, Layer, Project } from './types';
import { contentBounds, layerSvg } from './engine';
import { estimatePsdSize } from './psd';
import { psdElementGroups } from './psd-elements';
import { NumberField } from './Controls';
export type ExportFormat = 'png' | 'svg' | 'psd' | 'photoshop-new' | 'photoshop-insert';
export type PngMode = 'composite' | 'selected' | 'layers';
export default function ExportControls({ project, selected, options, onOptions, pngMode, onPngMode, busy, photoshop, onExport }: { project: Project; selected?: Layer; options: ExportOptions; onOptions: (value: ExportOptions) => void; pngMode: PngMode; onPngMode: (mode: PngMode) => void; busy: boolean; photoshop: boolean; onExport: (format: ExportFormat) => void }) {
  const output = pngMode === 'selected' ? { ...project, layers: selected ? [{ ...selected, visible: true }] : [] } : project;
  const rawBounds = options.crop ? contentBounds(output) : { x: 0, y: 0, width: output.width, height: output.height };
  const bounds = rawBounds.width > 0 && rawBounds.height > 0 ? rawBounds : { x: 0, y: 0, width: output.width, height: output.height };
  const width = Math.max(1, Math.ceil((bounds.width + (options.crop ? 2 * options.padding : 0)) * options.scale));
  const height = Math.max(1, Math.ceil((bounds.height + (options.crop ? 2 * options.padding : 0)) * options.scale));
  const psd = useMemo(() => {
    const leafCount = options.psdMode === 'elements' ? psdElementGroups(project).reduce((count, group) => count + group.elements.length, 0) : project.layers.length;
    try {
      const estimate = estimatePsdSize(project, options);
      const error = estimate.estimatedBytes > 512 * 1024 * 1024 ? 'PSD 预计内存超过 512 MB，请降低倍数、开启裁边或拆分图层。' : '';
      return { leafCount, estimate, error };
    } catch (error) { return { leafCount, error: error instanceof Error ? error.message : 'PSD 估算失败，请检查画布和效果参数。' }; }
  }, [project, options]);
  return <>
    <div className="export-preview checker"><svg viewBox={`${bounds.x - 40} ${bounds.y - 40} ${bounds.width + 80} ${bounds.height + 80}`} dangerouslySetInnerHTML={{ __html: output.layers.filter(l => l.visible).map(l => layerSvg({ ...l, id: `export-preview-${l.id}` })).join('') }}/></div>
    <div className="export-settings"><label className="select-field"><span>导出范围</span><select aria-label="导出范围" value={options.crop ? 'crop' : 'canvas'} onChange={e => onOptions({ ...options, crop: e.target.value === 'crop' })}><option value="crop">紧贴作品，自动裁边</option><option value="canvas">完整画布，保持位置</option></select></label><label className="select-field"><span>输出精度</span><select aria-label="输出精度" value={options.scale} onChange={e => onOptions({ ...options, scale: +e.target.value })}><option value="1">1× 原始尺寸</option><option value="2">2× 高清</option><option value="3">3× 超清</option></select></label>{options.crop && <NumberField label="四周留白" value={options.padding} min={0} max={300} onChange={v => onOptions({ ...options, padding: v })}/>}</div>
    <div className="export-info"><span className="transparent-dot"/><span>透明背景 · {width} × {height} px</span><span>不包含参考底图</span></div>
    <label className="select-field"><span>PNG 导出方式</span><select aria-label="PNG导出方式" value={pngMode} onChange={e => onPngMode(e.target.value as PngMode)}><option value="composite">整张合成 · 一张透明 PNG</option><option value="selected" disabled={!selected}>所选图层 · 单独透明 PNG</option><option value="layers">逐层导出 · PNG ZIP 压缩包</option></select></label>
    <label className="select-field"><span>PSD 分层方式</span><select aria-label="PSD分层方式" value={options.psdMode ?? 'layers'} onChange={e => onOptions({ ...options, psdMode: e.target.value as 'layers' | 'elements' })}><option value="layers">按图层 · 保留整体效果</option><option value="elements">逐元素 · 字符与部件独立编辑</option></select></label>
    <p className="field-note export-note" data-testid="psd-estimate">PSD 共 {psd.leafCount} 个叶层（含隐藏元素）{psd.estimate && <> · {psd.estimate.groupCount} 个组 · {psd.estimate.width} × {psd.estimate.height} px · 预计内存 {Math.ceil(psd.estimate.estimatedBytes / 1024 / 1024)} MB · 预计 {psd.estimate.estimatedSeconds.min}–{psd.estimate.estimatedSeconds.max} 秒</>}。耗时为估算，取决于设备、图片与效果复杂度。</p>
    {psd.error && <p className="field-note export-note" role="alert">{psd.error}</p>}
    {options.psdMode === 'elements' && <p className="field-note export-note" data-testid="psd-elements-note">逐元素会分别重算重叠的投影、厚度和材质效果，合成外观可能与按图层不同。</p>}
    <p className="field-note export-note">逐层 PNG 只导出可见图层；按共同画布和裁边范围保留相对位置。PSD 始终保留全部独立图层与显隐，文字效果为栅格层。继续编辑文字和节点请保存字造工程。</p>
    <div className="modal-actions export-actions"><button className="outline-button" onClick={() => onExport('svg')} disabled={busy}>矢量 SVG</button><button className="outline-button" data-testid="download-psd" onClick={() => onExport('psd')} disabled={busy || !!psd.error}><Layers3 size={16}/>分层 PSD</button><button className="primary-button" data-testid="download-png" onClick={() => onExport('png')} disabled={busy || (pngMode === 'selected' && !selected)}>{busy ? <LoaderCircle size={17} className="spin"/> : <Download size={17}/>} {pngMode === 'layers' ? '下载逐层 PNG' : '下载透明 PNG'}</button></div>
    {photoshop && <div className="photoshop-actions"><p>Photoshop 面板已连接</p><button className="primary-button" disabled={busy || !!psd.error} onClick={() => onExport('photoshop-new')}>送入 PS 新文档</button><button className="outline-button" disabled={busy || !!psd.error} onClick={() => onExport('photoshop-insert')}>插入当前 PS 文档</button></div>}
  </>;
}
