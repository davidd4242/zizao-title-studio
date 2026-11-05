import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, Minus, Plus } from 'lucide-react';

export function Section({ title, children, open = true, aside, onToggle }: { title: string; children: ReactNode; open?: boolean; aside?: ReactNode; onToggle?: (open: boolean) => void }) {
  return <details className="property-section" open={open} onToggle={event => onToggle?.(event.currentTarget.open)}><summary><span>{title}</span><span className="summary-side">{aside}<ChevronDown size={14}/></span></summary><div className="section-content">{children}</div></details>;
}
export function NumberField({ label, value, onChange, min = -5000, max = 5000, step = 1, suffix = '', disabled = false }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim()) { const n = Number(draft); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); } setDraft(null); };
  return <label className="number-field"><span>{label}</span><div><input aria-label={label} disabled={disabled} type="number" min={min} max={max} step={step} value={draft ?? Math.round(value * 100) / 100} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/>{suffix && <span>{suffix}</span>}</div></label>;
}
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft && /^#[0-9a-f]{6}$/i.test(draft)) onChange(draft); setDraft(null); };
  return <label className="color-field"><span>{label}</span><div><span className="color-chip" style={{ background: value }}><input aria-label={label} type="color" value={value} onChange={e => onChange(e.target.value)}/></span><input aria-label={`${label}色值`} value={draft ?? value.toUpperCase()} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onFocus={e => e.target.select()}/></div></label>;
}
export function RangeField({ label, value, onChange, onPreview, min = 0, max = 100, step = 1, suffix = '' }: { label: string; value: number; onChange: (v: number) => void; onPreview?: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const [draft, setDraft] = useState<number | null>(null);
  const commit = (input: HTMLInputElement) => { if (draft !== null) onChange(+input.value); setDraft(null); };
  return <label className="range-field"><span>{label}<output>{Math.round((draft ?? value) * 100) / 100}{suffix}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={draft ?? value} style={{ '--range': `${((draft ?? value) - min) / (max - min) * 100}%` } as CSSProperties} onChange={e => { const n=+e.target.value; setDraft(n); onPreview?.(n); }} onPointerDown={e => e.currentTarget.setPointerCapture(e.pointerId)} onPointerUp={e => commit(e.currentTarget)} onPointerCancel={e => commit(e.currentTarget)} onBlur={e => commit(e.currentTarget)} onKeyUp={e => commit(e.currentTarget)}/></label>;
}
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) { return <label className="toggle-field"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/><i/></label>; }
export function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) { return <div className="stepper" aria-label={label}><button title={`减小${label}`} onClick={() => onChange(value - 0.1)}><Minus size={14}/></button><span>{Math.round(value * 100)}%</span><button title={`增大${label}`} onClick={() => onChange(value + 0.1)}><Plus size={14}/></button></div>; }
