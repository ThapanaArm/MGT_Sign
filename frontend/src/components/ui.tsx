import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../lib/icons';
import { Modal } from './Modal';

/* ---------- types ---------- */
export interface MenuItem { label: string; icon?: IconName; bad?: boolean; run: () => void }
interface ConfirmOpts { title: string; text: string; okLabel: string; danger?: boolean; withReason?: boolean }
interface PromptOpts { title: string; text: string; label: string; value?: string; minLength?: number; area?: boolean; maxLength?: number; password?: boolean }
interface UiApi {
  toast: (msg: string) => void;
  menu: (anchor: Element, items: MenuItem[], header?: string) => void;
  /** Resolves to the reason ('' when no reason asked) or null when cancelled. */
  confirm: (o: ConfirmOpts) => Promise<string | null>;
  /** Resolves to the entered text or null when cancelled. */
  prompt: (o: PromptOpts) => Promise<string | null>;
}
const UiCtx = createContext<UiApi | null>(null);
export function useUi() { const c = useContext(UiCtx); if (!c) throw new Error('UiProvider missing'); return c; }

/* ---------- provider ---------- */
export function UiProvider({ children }: { children: ReactNode }) {
  const [toastMsg, setToastMsg] = useState<{ msg: string; n: number } | null>(null);
  const [menuState, setMenuState] = useState<{ rect: DOMRect; items: MenuItem[]; header?: string } | null>(null);
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [promptState, setPromptState] = useState<(PromptOpts & { resolve: (v: string | null) => void }) | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(t => ({ msg, n: (t?.n || 0) + 1 }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), 3200);
  }, []);
  const menu = useCallback((anchor: Element, items: MenuItem[], header?: string) => setMenuState({ rect: anchor.getBoundingClientRect(), items, header }), []);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<string | null>(resolve => setConfirmState({ ...o, resolve })), []);
  const prompt = useCallback((o: PromptOpts) => new Promise<string | null>(resolve => setPromptState({ ...o, resolve })), []);
  const closeMenu = useCallback(() => setMenuState(null), []);
  const api = useMemo(() => ({ toast, menu, confirm, prompt }), [toast, menu, confirm, prompt]);

  return (
    <UiCtx.Provider value={api}>
      {children}
      {menuState && <MenuPop {...menuState} onClose={closeMenu} />}
      {confirmState && <ConfirmDialog o={confirmState} toast={toast} done={v => { confirmState.resolve(v); setConfirmState(null); }} />}
      {promptState && <PromptDialog o={promptState} toast={toast} done={v => { promptState.resolve(v); setPromptState(null); }} />}
      {toastMsg && createPortal(<div className="toast" key={toastMsg.n} role="status">{toastMsg.msg}</div>, document.body)}
    </UiCtx.Provider>
  );
}

function MenuPop({ rect, items, header, onClose }: { rect: DOMRect; items: MenuItem[]; header?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    const mw = m.offsetWidth, mh = m.offsetHeight;
    setPos({
      left: Math.max(8, Math.min(rect.right - mw, window.innerWidth - mw - 8)),
      top: rect.bottom + mh + 6 > window.innerHeight ? Math.max(8, rect.top - mh - 6) : rect.bottom + 6,
    });
  }, [rect]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = window.setTimeout(() => document.addEventListener('mousedown', down), 0);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    return () => { window.clearTimeout(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  return createPortal(
    <div className="menu" ref={ref} role="menu" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>
      {header && <div className="mh">{header}</div>}
      {items.map((it, i) => (
        <button key={i} role="menuitem" className={it.bad ? 'bad' : ''} onClick={() => { onClose(); it.run(); }}>
          {it.icon && <Icon name={it.icon} size={16} />}{it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function ConfirmDialog({ o, done, toast }: { o: ConfirmOpts; done: (v: string | null) => void; toast: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const ok = () => { const r = reason.trim(); if (o.withReason && !r) { toast('Please enter a reason.'); return; } done(r); };
  return (
    <Modal onClose={() => done(null)} size="sm" title={o.title}>
      <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>{o.text}</p>
      {o.withReason && <>
        <label className="l">Reason <span className="req">*</span></label>
        <textarea className="inp" style={{ minHeight: 80 }} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
      </>}
      <div className="mfoot">
        <button className="btn ghost" onClick={() => done(null)}>Cancel</button>
        <button className={'btn ' + (o.danger === false ? 'primary' : 'danger')} onClick={ok}>{o.okLabel}</button>
      </div>
    </Modal>
  );
}

function PromptDialog({ o, done, toast }: { o: PromptOpts; done: (v: string | null) => void; toast: (m: string) => void }) {
  const [v, setV] = useState(o.value || '');
  const min = o.minLength ?? 1;
  const ok = () => { const t = v.trim(); if (t.length < min) { toast(min > 1 ? `Use at least ${min} characters.` : 'Enter a value.'); return; } done(t); };
  return (
    <Modal onClose={() => done(null)} size="sm" title={o.title}>
      <p className="hint" style={{ marginTop: -8 }}>{o.text}</p>
      <label className="l">{o.label}</label>
      {o.area
        ? <textarea className="inp" maxLength={o.maxLength ?? 1000} value={v} onChange={e => setV(e.target.value)} autoFocus />
        : <input className="inp" type={o.password ? 'password' : 'text'} maxLength={o.maxLength ?? 50} value={v} onChange={e => setV(e.target.value)} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') ok(); }} />}
      <div className="mfoot">
        <button className="btn ghost" onClick={() => done(null)}>Cancel</button>
        <button className="btn primary" onClick={ok}>Save</button>
      </div>
    </Modal>
  );
}

/* ---------- small shared pieces ---------- */
export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="loading"><span className="spin" />{text}</div>;
}
export function Empty({ icon, title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return <div className="empty">{icon && <div className="eic"><Icon name={icon} size={22} /></div>}<b>{title}</b>{children}</div>;
}
export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <div className="err"><Icon name="info" size={16} /><span style={{ flex: 1 }}>{error}</span>{onRetry && <button className="btn sm" onClick={onRetry}>Retry</button>}</div>;
}
export function PageHead({ eb, title, desc, actions }: { eb: string; title: ReactNode; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ph">
      <div><div className="eb">{eb}</div><h1>{title}</h1>{desc && <p>{desc}</p>}</div>
      {actions && <div className="act-r">{actions}</div>}
    </div>
  );
}
