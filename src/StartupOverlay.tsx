import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { LoaderCircle } from 'lucide-react';

type Props = { error: string; onRetry: () => void };

export default function StartupOverlay({ error, onRetry }: Props) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => { card.current?.focus(); }, [error]);
  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const buttons = card.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons?.length) { event.preventDefault(); return; }
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === card.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };
  return <div className="startup-overlay" data-testid="startup-overlay">
    <section ref={card} className="startup-card" role={error ? 'alertdialog' : 'dialog'} aria-modal="true"
      aria-labelledby="startup-title" aria-describedby="startup-detail" tabIndex={-1} onKeyDown={trapFocus}>
      <img className="startup-logo" src="/logo.png" alt="字造"/>
      {!error && <LoaderCircle className="spin" size={24} aria-hidden="true"/>}
      <b id="startup-title">{error ? '加载遇到问题' : '正在加载中'}</b>
      <p id="startup-detail" role={error ? 'alert' : 'status'}>{error || '正在准备字体库与字形轮廓，完成后自动进入工作台。'}</p>
      {error && <div className="startup-actions"><button type="button" className="primary-button" onClick={onRetry}>重新加载</button></div>}
    </section>
  </div>;
}
