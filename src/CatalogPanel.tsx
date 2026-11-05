import { memo, useMemo, useState } from 'react';
import type { PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, Layers3, Search, Upload } from 'lucide-react';
import type { Layer } from './types';
import { BASE_LAYER } from './types';
import { STICKERS, STYLE_PRESETS } from './presets';
import ArtworkPreview from './ArtworkPreview';
import SearchField from './SearchField';

const stickerPreviews = new Map(STICKERS.map(s => [s.id, { ...BASE_LAYER, ...s, kind: 'sticker', text: '', fontId: '', x: 0, y: 0 } as Layer]));
type Filter = { query: string; category: string; page: number };
const emptyFilter = (): Filter => ({ query: '', category: '', page: 0 });
type Props = {
  kind: 'styles' | 'stickers'; previewLayer?: Layer;
  onStyle: (id: string) => void; onSticker: (id: string) => void;
  onStickerPointerDown: (id: string, event: PointerEvent<HTMLButtonElement>) => void;
  onImport: () => void;
};

export default memo(function CatalogPanel({ kind, previewLayer, onStyle, onSticker, onStickerPointerDown, onImport }: Props) {
  const [filters, setFilters] = useState({ styles: emptyFilter(), stickers: emptyFilter() });
  const f = filters[kind], styles = kind === 'styles', source = styles ? STYLE_PRESETS : STICKERS;
  const pageSize = styles ? 12 : 24;
  const categories = useMemo(() => [...new Set(source.map(item => item.category))], [source]);
  const filtered = useMemo(() => {
    const terms = f.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return source.filter(item => (!f.category || item.category === f.category) && terms.every(term => `${item.name} ${item.category} ${item.tags.join(' ')} ${'description' in item ? item.description : ''}`.toLocaleLowerCase().includes(term)));
  }, [source, f.query, f.category]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), page = Math.min(f.page, pages - 1);
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const update = (patch: Partial<Filter>) => setFilters(previous => ({ ...previous, [kind]: { ...previous[kind], page: 0, ...patch } }));
  const paginate = (n: number) => { update({ page: n }); document.querySelector('.library-panel')?.scrollTo({ top: 0, behavior: 'instant' }); };
  return <div className="catalog-panel" data-testid={`${kind}-catalog`}>
    <div className="catalog-heading"><b data-testid="catalog-total">{source.length}<small>{styles ? '种文字风格' : '个矢量装饰'}</small></b><span>{categories.length} 个分类</span></div>
    <SearchField className="catalog-search" label={styles ? '搜索风格' : '搜索装饰'} placeholder={styles ? '搜索奶油、金属、万圣…' : '搜索星星、花朵、蝴蝶结…'} value={f.query} onChange={query => update({ query })}/>
    <label className="select-field catalog-category"><span>{styles ? '风格分类' : '装饰分类'}</span><select aria-label={styles ? '风格分类' : '装饰分类'} value={f.category} onChange={event => update({ category: event.target.value })}><option value="">全部分类</option>{categories.map(category => <option key={category} value={category}>{category} · {source.filter(s => s.category === category).length}</option>)}</select></label>
    {!styles && <div className="layer-drop-shortcut" data-sticker-drop="layers" data-testid="layer-drop-shortcut"><Layers3 size={17}/><span>拖到画布或这里，新增图层</span></div>}
    <div className="catalog-results" aria-live="polite"><span>找到 {filtered.length} {styles ? '种风格' : '个装饰'}</span><span>{page + 1} / {pages}</span></div>
    {styles ? <div className="preset-list">{visible.map(item => { const p = STYLE_PRESETS.find(s => s.id === item.id)!; return <button className="preset-card" key={p.id} aria-label={`应用风格 ${p.name}`} onClick={() => onStyle(p.id)}><div className="preset-art">{previewLayer ? <ArtworkPreview layer={previewLayer} style={p.style}/> : <span style={{ color: p.style.fill }}>心动放送</span>}</div><span className="preset-caption"><b>{p.name}</b><span>{p.description}</span></span><span className="preset-arrow">↗</span></button>; })}</div>
      : <div className="sticker-grid">{visible.map(s => <button className="sticker-card" key={s.id} data-sticker-id={s.id} aria-label={`添加装饰 ${s.name}`} onPointerDown={event => onStickerPointerDown(s.id, event)} onClick={() => onSticker(s.id)} draggable={false}><ArtworkPreview layer={stickerPreviews.get(s.id)!}/><span>{s.name}</span></button>)}</div>}
    {!filtered.length && <div className="catalog-empty"><Search size={24}/><b>这次没有找到</b><p>换个关键词，或回到全部分类。</p><button className="outline-button" onClick={() => setFilters(previous => ({ ...previous, [kind]: emptyFilter() }))}>清除筛选</button></div>}
    <nav className="catalog-pagination" aria-label={styles ? '风格分页' : '装饰分页'}><button aria-label="上一页" disabled={page === 0} onClick={() => paginate(page - 1)}><ArrowLeft size={16}/>上一页</button><span>{page + 1} / {pages}</span><button aria-label="下一页" disabled={page + 1 >= pages} onClick={() => paginate(page + 1)}>下一页<ArrowRight size={16}/></button></nav>
    {!styles && <><button className="outline-button full" onClick={onImport}><Upload size={16}/>导入自己的 PNG 装饰</button><div className="library-footnote">点击添加，或拖到画布指定位置。内置图形可换色、缩放、编辑节点。</div><a className="resource-link" href="https://sozaino.site/" target="_blank" rel="noreferrer">打开 OKUMONO 素材网站 ↗</a><a className="resource-link" href="https://www.pinterest.com/pin/692217405262462156/" target="_blank" rel="noreferrer">打开你的 Pinterest 灵感参考 ↗</a></>}
  </div>;
});
