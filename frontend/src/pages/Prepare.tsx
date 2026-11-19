import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, saveBlob } from '../api/client';
import type { AuditDto, EnvelopeDetail, FieldDto, FieldInput, FieldType, RecipientDto } from '../api/types';
import { AttachmentsModal } from '../components/Attachments';
import { Modal } from '../components/Modal';
import { PdfPages, usePdf, type PageBox } from '../components/PdfPages';
import { ErrorNote, Loading, useUi } from '../components/ui';
import { FIELD_DEFS, PALETTE, isRequiredByDefault, TEXT_INPUT_FIELDS } from '../lib/fields';
import { Icon } from '../lib/icons';
import { errMsg, fmt, initials, isSignerRole, uid } from '../lib/format';
import { PAGE_WIDTH } from '../lib/pdf';

type EdField = Omit<FieldInput, 'id'> & { key: string; id?: string | null };
const toEd = (f: FieldDto): EdField => ({ ...f, key: f.id });
const tint = (c: string) => `color-mix(in srgb, ${c} 20%, transparent)`;

export function PreparePage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const ui = useUi();
  const [env, setEnv] = useState<EnvelopeDetail | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const { pdf, error: pdfErr } = usePdf(() => api.document(id, 'original'), [id]);
  const [fields, setFields] = useState<EdField[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [selRid, setSelRid] = useState<string>('');
  const [zoom, setZoom] = useState(() => Math.max(0.5, Math.min(1, (window.innerWidth - 420) / PAGE_WIDTH) || 1));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [showAtt, setShowAtt] = useState(false);
  const [audit, setAudit] = useState<AuditDto[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off = false;
    api.envelope(id).then(e => {
      if (off) return;
      setEnv(e); setFields(e.fields.map(toEd));
      const s = e.recipients.filter(r => isSignerRole(r.role));
      setSelRid(s[0]?.id || '');
    }).catch(e => { if (!off) setLoadErr(errMsg(e)); });
    return () => { off = true; };
  }, [id]);

  const self = env?.type === 'self';
  const signers = env ? env.recipients.filter(r => isSignerRole(r.role)) : [];
  const owner = (f: EdField): RecipientDto | undefined => env?.recipients.find(r => r.id === f.recipientId);

  const update = useCallback((key: string, patch: Partial<EdField>) => { setFields(fs => fs.map(f => f.key === key ? { ...f, ...patch } : f)); setDirty(true); }, []);
  const remove = useCallback((key: string) => { setFields(fs => fs.filter(f => f.key !== key)); setSel(null); setDirty(true); }, []);

  // Delete / Backspace removes the selected field (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!sel || t.closest('input,textarea,select') || document.querySelector('.overlay')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(sel); }
      if (e.key === 'Escape') setSel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sel, remove]);

  const addField = (type: FieldType, page: number, cx: number, cy: number) => {
    if (!pdf || !env) return;
    const rid = self ? env.recipients[0]?.id : selRid;
    if (!rid) { ui.toast('Add a signer first.'); return; }
    const s = pdf.sizes[page]; const def = FIELD_DEFS[type];
    const w = def.w / PAGE_WIDTH, h = def.h / (PAGE_WIDTH * s.h / s.w);
    const f: EdField = {
      key: uid(), id: null, recipientId: rid, type, page,
      x: Math.max(0, Math.min(1 - w, cx - w / 2)), y: Math.max(0, Math.min(1 - h, cy - h / 2)), width: w, height: h,
      required: isRequiredByDefault(type), label: null, tooltip: null, value: null,
    };
    setFields(fs => [...fs, f]); setSel(f.key); setDirty(true);
  };

  const placeInView = (type: FieldType) => {
    const b = box.current; if (!b) return;
    const mid = b.getBoundingClientRect().top + b.clientHeight / 2;
    let best: HTMLElement | null = null, bd = 1e9;
    b.querySelectorAll<HTMLElement>('.page').forEach(p => { const r = p.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - mid); if (d < bd) { bd = d; best = p; } });
    if (!best) return;
    const el: HTMLElement = best;
    const r = el.getBoundingClientRect();
    addField(type, Number(el.dataset.p), 0.5, Math.max(0.08, Math.min(0.92, (mid - r.top) / r.height)));
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const t = e.dataTransfer.getData('text/mgt-field') as FieldType; const pg = (e.target as HTMLElement).closest<HTMLElement>('.page');
    if (!t || !pg || !FIELD_DEFS[t]) return;
    e.preventDefault();
    const r = pg.getBoundingClientRect();
    addField(t, Number(pg.dataset.p), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  const startDrag = (e: RPointerEvent<HTMLDivElement>, f: EdField) => {
    const target = e.target as HTMLElement;
    if (target.closest('.ftb')) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget, layer = (el.closest('.layer') || el.parentElement!).getBoundingClientRect();
    const resizing = target.classList.contains('rz');
    const sx = e.clientX, sy = e.clientY, o = { ...f }; let moved = false;
    el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / layer.width, dy = (ev.clientY - sy) / layer.height;
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
      if (!moved) return;
      if (resizing) update(f.key, { width: Math.max(0.02, Math.min(1 - o.x, o.width + dx)), height: Math.max(0.012, Math.min(1 - o.y, o.height + dy)) });
      else update(f.key, { x: Math.max(0, Math.min(1 - o.width, o.x + dx)), y: Math.max(0, Math.min(1 - o.height, o.y + dy)) });
    };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); setSel(f.key); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };

  const payload = (): FieldInput[] => fields.map(f => ({
    id: f.id || null, recipientId: f.recipientId, type: f.type, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height,
    required: f.required, label: f.label || null, tooltip: f.tooltip || null, value: f.value || null,
  }));
  const save = async (): Promise<EnvelopeDetail | null> => {
    try {
      const r = await api.saveFields(id, { fields: payload() });
      setEnv(r); setFields(r.fields.map(toEd)); setSel(null); setDirty(false);
      return r;
    } catch (e) { ui.toast(errMsg(e)); return null; }
  };

  const send = async () => {
    if (!env) return;
    if (self) {
      if (!fields.some(f => f.type === 'signature')) { ui.toast('Add at least one Signature field.'); return; }
    } else {
      const lacking = signers.filter(r => !fields.some(f => f.recipientId === r.id && f.type === 'signature'));
      if (lacking.length) { ui.toast('Add a Signature field for: ' + lacking.map(r => r.name).join(', ')); return; }
    }
    setBusy(true);
    try {
      if (!(await save())) return;
      const sent = await api.send(id);
      if (self) {
        const token = sent.actions.signToken || (await api.envelope(id)).actions.signToken;
        if (token) nav('/sign/' + token, { replace: true });
        else { ui.toast('Fields saved. Open the envelope to sign it.'); nav('/envelopes/' + id, { replace: true }); }
      } else {
        ui.toast(sent.status === 'pendingApproval' ? 'Envelope sent for approval.' : 'Envelope sent.');
        nav('/agreements/progress', { replace: true });
      }
    } catch (e) { ui.toast(errMsg(e)); } finally { setBusy(false); }
  };

  const finishLater = async () => {
    if (dirty && !(await save())) return;
    ui.toast('Saved to Drafts.'); nav('/agreements/drafts');
  };
  const close = async () => {
    if (!env || !editable) { nav(-1); return; }
    await finishLater();
  };
  const discard = async () => {
    if (!env) return;
    if (await ui.confirm({ title: 'Discard this document?', text: env.actions.canVoid ? 'The envelope will be voided and kept in Voided & Declined for the record.' : 'The draft will move to the Deleted folder.', okLabel: 'Discard' }) === null) return;
    try {
      if (env.actions.canVoid) await api.voidEnvelope(id, { reason: 'Discarded by sender' });
      else await api.deleteEnvelope(id);
      ui.toast('Discarded.'); nav('/agreements/all');
    } catch (e) { ui.toast(errMsg(e)); }
  };
  const openHistory = async () => { try { setAudit(await api.audit(id)); } catch (e) { ui.toast(errMsg(e)); } };
  const download = async () => { try { saveBlob(await api.document(id, 'original'), env?.documents.find(d => d.kind === 'original')?.fileName || 'document.pdf'); } catch (e) { ui.toast(errMsg(e)); } };

  const editable = !!env && env.status === 'draft' && env.actions.canEditFields;

  if (loadErr) return <div className="ed"><div className="edbar"><button className="icon-btn" onClick={() => nav(-1)} aria-label="Close"><Icon name="x" size={22} /></button><div className="ttl">Envelope</div></div><div style={{ padding: 24 }}><ErrorNote error={loadErr} /></div></div>;
  if (!env) return <div className="ed"><Loading /></div>;

  const overlay = (p: PageBox) => fields.filter(f => f.page === p.index).map(f => {
    const o = owner(f), col = o?.color || '#999', def = FIELD_DEFS[f.type];
    const fs = Math.max(9, f.height * p.H * 0.62);
    let inner;
    if (f.type === 'checkbox') inner = <div className="cb" style={{ fontSize: fs, borderColor: col }} />;
    else if (f.value) inner = <div className="txtv" style={{ fontSize: fs }}>{f.value}</div>;
    else if (f.type === 'signature' || f.type === 'initial') inner = <span className="lbl col" style={{ fontSize: Math.min(14, Math.max(9, fs * 0.5)) }}>{f.type === 'signature' ? 'Sign' : 'Initial'}<Icon name="sign" size={Math.min(26, Math.max(12, fs * 0.7))} /></span>;
    else inner = <span className="lbl" style={{ fontSize: Math.min(13, Math.max(9, fs * 0.8)) }}>{f.label || (f.type === 'name' ? 'Full Name' : def.label)}</span>;
    const isSel = sel === f.key;
    return (
      <div key={f.key} style={{ display: 'contents' }}>
        <div className={'fld movable ' + (f.type === 'checkbox' ? 'filled ' : '') + (isSel ? 'sel' : '')}
          title={[f.tooltip, (f.label || def.label) + (o ? ' · ' + o.name : '')].filter(Boolean).join(' — ')}
          style={{ left: f.x * 100 + '%', top: f.y * 100 + '%', width: f.width * 100 + '%', height: f.height * 100 + '%', borderColor: col, background: tint(col) }}
          onPointerDown={editable ? e => startDrag(e, f) : undefined}>
          {inner}
          {f.required && <span className="req-star">*</span>}
          {editable && <div className="rz" />}
        </div>
        {isSel && editable && (
          <div className="ftb" style={{ left: Math.min(f.x * 100, 70) + '%', top: `calc(${(f.y + f.height) * 100}% + 8px)` }} onPointerDown={e => e.stopPropagation()}>
            {!self && <><button title="Assign to recipient" onClick={e => ui.menu(e.currentTarget, signers.map(r => ({ label: (r.id === f.recipientId ? '✓ ' : ' ') + r.name, icon: 'user' as const, run: () => update(f.key, { recipientId: r.id }) })), 'Assign to')}>
              <span className="av" style={{ background: col }}>{initials(o?.name)}</span><Icon name="chev" size={14} /></button><i className="sep" /></>}
            <label className="tgl" title="Recipient must complete this field"><input type="checkbox" checked={f.required} onChange={e => update(f.key, { required: e.target.checked })} /><span />Required</label><i className="sep" />
            <button title="Duplicate" onClick={() => { const c: EdField = { ...f, key: uid(), id: null, y: Math.min(1 - f.height, f.y + f.height + 0.01) }; setFields(fs2 => [...fs2, c]); setSel(c.key); setDirty(true); }}><Icon name="copy" size={17} /></button>
            <button title="Delete" onClick={() => remove(f.key)}><Icon name="trash" size={17} /></button><i className="sep" />
            <button title="Field settings" onClick={() => setSettingsFor(f.key)}><Icon name="gear" size={17} /></button>
          </div>
        )}
      </div>
    );
  });

  const selR = env.recipients.find(r => r.id === selRid);
  const settingsField = fields.find(f => f.key === settingsFor) || null;

  return (
    <div className="ed">
      <div className="edbar">
        <button className="icon-btn" style={{ color: '#fff' }} onClick={close} title="Save and close" aria-label="Close"><Icon name="x" size={22} /></button>
        <div className="ttl">{env.subject}<small>{!editable ? 'This envelope can no longer be edited · ' + env.code : self ? 'Place your signature and other fields, then click Sign' : 'Place fields for each recipient, then send'}{dirty ? ' · unsaved changes' : ''}</small></div>
        <div className="split">
          {editable ? <>
            <button className="btn main-act" disabled={busy} onClick={send}>{busy ? 'Working…' : self ? 'Sign' : 'Send'}</button>
            <button className="btn dd" aria-label="Other actions" onClick={e => ui.menu(e.currentTarget, [
              { label: 'Save', icon: 'check', run: () => void save().then(r => { if (r) ui.toast('Saved.'); }) },
              { label: 'Finish Later', icon: 'clock', run: () => void finishLater() },
              { label: 'Discard', icon: 'ban', bad: true, run: () => void discard() },
            ], 'Other Actions')}><Icon name="chev" size={16} /></button>
          </> : <button className="btn main-act" onClick={() => nav('/envelopes/' + id)}>Details</button>}
        </div>
      </div>
      <div className="edbody">
        {editable && (
          <aside className="fields">
            {!self && <><h4>RECIPIENT</h4>
              <div className="who"><span className="dot" style={{ background: selR?.color || 'var(--line-strong)' }} />
                <select value={selRid} onChange={e => setSelRid(e.target.value)} aria-label="Recipient">
                  {signers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select></div>
              {!signers.length && <p className="hint">This envelope has no signers.</p>}</>}
            <h4>FIELDS</h4>
            {PALETTE.map((g, gi) => (
              <div className="grp" key={gi}>
                {g.map(t => (
                  <div key={t} className="fitem" draggable role="button" tabIndex={0} style={{ borderLeft: '3px solid ' + (self ? 'transparent' : selR?.color || 'transparent') }}
                    onDragStart={e => { e.dataTransfer.setData('text/mgt-field', t); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => placeInView(t)} onKeyDown={e => { if (e.key === 'Enter') placeInView(t); }}>
                    <Icon name={FIELD_DEFS[t].icon} />{FIELD_DEFS[t].label}
                  </div>
                ))}
              </div>
            ))}
            <p className="hint">Drag a field onto the page, or click it to place it on the page in view. Drag placed fields to move; use the corner handle to resize.</p>
          </aside>
        )}
        <div className="canvas-area" ref={box}
          onDragOver={e => { if (editable) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDrop={editable ? onDrop : undefined}
          onPointerDown={e => { if (!(e.target as HTMLElement).closest('.fld,.ftb')) setSel(null); }}>
          {pdfErr ? <ErrorNote error={pdfErr} /> : !pdf ? <div className="pdfwait"><Loading text="Opening document…" /></div> : <PdfPages pdf={pdf} zoom={zoom} overlay={overlay} />}
        </div>
        <aside className="tools">
          <button onClick={e => pdf && ui.menu(e.currentTarget, pdf.sizes.map((_, i) => ({ label: 'Page ' + (i + 1), run: () => box.current?.querySelectorAll('.page')[i]?.scrollIntoView({ behavior: 'smooth' }) })))}><Icon name="pages" size={20} />Pages</button>
          <button onClick={download}><Icon name="down" size={20} />Download</button>
          <button style={{ position: 'relative' }} onClick={() => setShowAtt(true)}><Icon name="clip" size={20} />Files<span className="att-badge">{env.attachments.length || ''}</span></button>
          <button onClick={openHistory}><Icon name="hist" size={20} />History</button>
          <button style={{ marginTop: 'auto' }} onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} aria-label="Zoom in"><Icon name="zin" size={20} /></button>
          <div className="zoom">{Math.round(zoom * 100)}%</div>
          <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label="Zoom out"><Icon name="zout" size={20} /></button>
        </aside>
      </div>

      {settingsField && <FieldSettings f={settingsField} onClose={() => setSettingsFor(null)} onSave={p => { update(settingsField.key, p); setSettingsFor(null); }} />}
      {showAtt && <AttachmentsModal list={env.attachments} onClose={() => setShowAtt(false)} who="sender"
        download={a => api.attachment(id, a.id)}
        upload={env.actions.canAddAttachments ? async fl => { const added = await api.addAttachments(id, fl); setEnv(e => e ? { ...e, attachments: [...e.attachments, ...added] } : e); } : null} />}
      {audit && <Modal onClose={() => setAudit(null)} size="wide" title={<><Icon name="hist" size={22} /> Audit trail</>}>
        {audit.length ? <div className="tl">{[...audit].reverse().map(a => <div className="ev" key={a.id}><b>{a.action}</b><div>{fmt(a.at)} · {a.actor}{a.ipAddress ? ' · ' + a.ipAddress : ''}</div>{a.detail && <div style={{ wordBreak: 'break-all' }}>{a.detail}</div>}</div>)}</div> : <p className="hint">No events yet.</p>}
      </Modal>}
    </div>
  );
}

function FieldSettings({ f, onClose, onSave }: { f: EdField; onClose: () => void; onSave: (p: Partial<EdField>) => void }) {
  const def = FIELD_DEFS[f.type];
  const [label, setLabel] = useState(f.label || def.label);
  const [tooltip, setTooltip] = useState(f.tooltip || '');
  const [value, setValue] = useState(f.value || '');
  const hasValue = TEXT_INPUT_FIELDS.includes(f.type);
  return (
    <Modal onClose={onClose} size="sm" title={def.label + ' settings'}>
      <label className="l">Data label</label><input className="inp" value={label} onChange={e => setLabel(e.target.value)} /><div className="hint">Used in reports and CSV export.</div>
      <label className="l">Tooltip</label><input className="inp" value={tooltip} placeholder="Shown when the recipient hovers the field" onChange={e => setTooltip(e.target.value)} /><div className="hint">e.g. “Sign as the authorised director”.</div>
      {hasValue && <><label className="l">Pre-filled value</label><input className="inp" value={value} onChange={e => setValue(e.target.value)} /><div className="hint">Recipients can change it.</div></>}
      <div className="mfoot"><button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => onSave({ label: label.trim() || null, tooltip: tooltip.trim() || null, ...(hasValue ? { value: value || null } : {}) })}>Save</button></div>
    </Modal>
  );
}
