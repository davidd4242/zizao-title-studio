import { useId, useMemo, useState } from 'react';
import { ArrowUp, Search } from 'lucide-react';
import type { FontCatalog } from './types';
import SearchField from './SearchField';

type Props = { catalog: FontCatalog; value: string; onChange: (id: string) => void; onManage: () => void };
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();

export default function FontPicker({ catalog, value, onChange, onManage }: Props) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [language, setLanguage] = useState('all');
  const statusId = useId();
  const fonts = useMemo(() => {
    const terms = normalize(query).split(/\s+/u).filter(Boolean);
    return catalog.fonts.filter(font => {
      const text = normalize(`${font.family} ${font.fullName} ${font.subfamily} ${font.postscriptName || ''}`);
      return (source === 'all' || (source === 'bundled' ? font.bundled : !font.bundled))
        && (language === 'all' || (language === 'chinese' ? font.hasChinese : font.languages?.includes(language as 'zh-Hans' | 'zh-Hant' | 'en')))
        && terms.every(term => text.includes(term));
    });
  }, [catalog.fonts, query, source, language]);
  const visible = fonts.slice(0, 300);
  const current = catalog.fonts.find(font => font.id === value);
  const name = current?.fullName || current?.family || '工程内嵌轮廓';
  const outside = !visible.some(font => font.id === value);
  const reset = () => { setQuery(''); setSource('all'); setLanguage('all'); };
  return <div className="font-picker">
    <div className="font-caption"><span id={statusId} aria-live="polite">字体库 · {fonts.length} 款匹配</span><button type="button" onClick={onManage}>管理字体 <ArrowUp size={12}/></button></div>
    <div className="font-filter-row">
      <select aria-label="字体来源" value={source} onChange={event => setSource(event.target.value)}><option value="all">全部字体</option><option value="bundled">内置免费字库</option><option value="local">本机与自选字库</option></select>
      <select aria-label="字体语言" value={language} onChange={event => setLanguage(event.target.value)}><option value="all">所有语言</option><option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option><option value="en">English</option><option value="chinese">中文字体</option></select>
    </div>
    <SearchField label="搜索字体" value={query} onChange={setQuery} placeholder="搜索名称，如 思源 / Noto" clearLabel="清除字体搜索" className="compact" describedBy={statusId}/>
    <p className="current-font" data-testid="current-font"><span>当前使用</span><strong title={name}>{name}</strong></p>
    {!fonts.length && <div className="font-empty" data-testid="font-empty" role="status"><Search size={20} aria-hidden="true"/><b>没有找到匹配字体</b><p>{query.trim() ? `试试其他名称，或重置筛选。` : '当前来源与语言组合没有结果。'}<br/>已用字体保持不变。</p><button type="button" className="outline-button" onClick={reset}>重置筛选</button></div>}
    <select aria-label="选择字体" className="font-select" disabled={!fonts.length} value={value} onChange={event => onChange(event.target.value)}>
      {outside && <optgroup label="当前使用（不在筛选结果中）"><option value={value}>当前使用 · {name}</option></optgroup>}
      {visible.length > 0 && <optgroup label="匹配字体">{visible.map(font => <option key={font.id} value={font.id}>{font.fullName || `${font.family} ${font.subfamily}`}</option>)}</optgroup>}
    </select>
    {fonts.length > visible.length && <p className="field-note">显示前 {visible.length} 款；输入更多关键词可缩小范围。</p>}
  </div>;
}
