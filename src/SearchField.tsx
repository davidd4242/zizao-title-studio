import { useRef } from 'react';
import { Search, X } from 'lucide-react';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel?: string;
  className?: string;
  describedBy?: string;
};

export default function SearchField({ label, value, onChange, placeholder, clearLabel = '清除搜索', className = '', describedBy }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const clear = () => { onChange(''); input.current?.focus(); };
  return <div className={`search-field ${className}`}>
    <Search size={16} aria-hidden="true"/>
    <input ref={input} type="search" aria-label={label} aria-describedby={describedBy} value={value}
      placeholder={placeholder} autoComplete="off" spellCheck={false}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Escape' && value && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation(); clear();
        }
      }}/>
    {value && <button type="button" className="search-clear" aria-label={clearLabel} title={clearLabel} onClick={clear}><X size={16} aria-hidden="true"/></button>}
  </div>;
}
