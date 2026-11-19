import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api/client';
import type { PersonDto } from '../api/types';
import { Icon } from '../lib/icons';
import { Modal } from './Modal';

const SOURCE_LABEL: Record<PersonDto['source'], string> = { company: 'Employee', user: 'MGT Sign user', contact: 'Contact' };

/** Debounced search against the user list. */
function usePeople(query: string, enabled: boolean, take = 30) {
  const [list, setList] = useState<PersonDto[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.people(query.trim(), take).then(r => { if (alive) setList(r); }).catch(() => { if (alive) setList([]); }).finally(() => { if (alive) setLoading(false); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query, enabled, take]);
  return { list, loading };
}

function PersonLine({ p }: { p: PersonDto }) {
  return <>
    <span className="pp-name">{p.name}</span>
    <span className="pp-sub">{p.email}{p.department ? ' · ' + p.department : ''}{p.position ? ' · ' + p.position : ''}</span>
  </>;
}

/**
 * Text input with suggestions from the user list (name, email, employee username or department).
 * Typing still works for people outside the list.
 */
export function PersonInput({ value, onChange, onPick, placeholder, ariaLabel, style, type = 'text' }: {
  value: string; onChange: (v: string) => void; onPick: (p: PersonDto) => void;
  placeholder?: string; ariaLabel?: string; style?: React.CSSProperties; type?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false); // only search what the user typed, not a prefilled value
  const { list, loading } = usePeople(typed ? value : '', open);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (p: PersonDto) => { onPick(p); setOpen(false); setTyped(false); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && list[active]) { e.preventDefault(); pick(list[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  return (
    <div className="pp-wrap" ref={wrap} style={style}>
      <input className="inp" type={type} value={value} placeholder={placeholder} aria-label={ariaLabel} autoComplete="off"
        role="combobox" aria-expanded={open} aria-autocomplete="list"
        onFocus={() => setOpen(true)} onKeyDown={onKey}
        onChange={e => { onChange(e.target.value); setTyped(true); setOpen(true); setActive(0); }} />
      {open && (list.length > 0 || loading) && (
        <div className="pp-list" role="listbox">
          {loading && !list.length && <div className="pp-empty">Searching…</div>}
          {list.map((p, i) => (
            <button key={p.email} type="button" role="option" aria-selected={i === active} className={'pp-item' + (i === active ? ' on' : '')}
              onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}>
              <PersonLine p={p} /><span className={'pp-src ' + p.source}>{SOURCE_LABEL[p.source]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Searchable user list. `multi` lets the sender tick several people and add them in one go. */
export function UserListModal({ multi, exclude = [], onPick, onClose, title }: {
  multi?: boolean; exclude?: string[]; title?: string; onPick: (people: PersonDto[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const { list, loading } = usePeople(q, true, 100);
  const [sel, setSel] = useState<Record<string, PersonDto>>({});
  const taken = new Set(exclude.map(e => e.trim().toLowerCase()).filter(Boolean));
  const chosen = Object.values(sel);
  const toggle = (p: PersonDto) => setSel(s => { const n = { ...s }; if (n[p.email]) delete n[p.email]; else n[p.email] = p; return n; });

  return (
    <Modal onClose={onClose} title={<><Icon name="user" size={22} /> {title || 'Choose from the user list'}</>}>
      <div className="search" style={{ width: '100%', marginBottom: 12 }}>
        <Icon name="search" />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, email, employee ID or department" aria-label="Search the user list" />
      </div>
      <div className="pp-table">
        {loading && !list.length ? <div className="pp-empty">Searching…</div>
          : !list.length ? <div className="pp-empty">No one matches “{q}”. You can still type a name and email on the form.</div>
            : list.map(p => {
              const already = taken.has(p.email.toLowerCase());
              return (
                <button key={p.email} type="button" className={'pp-row' + (sel[p.email] ? ' on' : '')} disabled={already}
                  onClick={() => multi ? toggle(p) : onPick([p])}>
                  {multi && <input type="checkbox" readOnly checked={!!sel[p.email] || already} tabIndex={-1} />}
                  <span className="pp-av">{p.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</span>
                  <span className="pp-txt"><PersonLine p={p} /></span>
                  <span className={'pp-src ' + p.source}>{already ? 'Added' : SOURCE_LABEL[p.source]}</span>
                </button>
              );
            })}
      </div>
      <p className="hint">Employees come from the company user list (MGT_Datawarehouse). Showing up to 100 matches — refine the search to find more.</p>
      {multi && <div className="mfoot"><span className="hint left">{chosen.length} selected</span><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!chosen.length} onClick={() => onPick(chosen)}><Icon name="plus" size={16} /> Add {chosen.length || ''} recipient{chosen.length === 1 ? '' : 's'}</button></div>}
    </Modal>
  );
}
