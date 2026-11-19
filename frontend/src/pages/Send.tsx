import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ContactDto, CreateEnvelopeRequest, RecipientRole, TemplateDetail, WorkflowTypeDto } from '../api/types';
import { StagedFiles } from '../components/Attachments';
import { useAuth } from '../components/auth';
import { Modal } from '../components/Modal';
import { UploadArea, type PdfItem } from '../components/UploadArea';
import { WorkflowBuilder } from '../components/WorkflowBuilder';
import { ErrorNote, Loading, PageHead, useUi } from '../components/ui';
import { Icon } from '../lib/icons';
import {
  ATT_MAX, checkAttachments, COLORS, emailOk, errMsg, fmtSize, isSignerRole, pickFiles, REMINDERS, ROLE_ICON, ROLE_LABEL, uid,
} from '../lib/format';
import { describePdf } from '../lib/pdf';
import { wfDefault, wfFromInput, wfToInput, wfTypeList, wfValidate, type WfState } from '../lib/workflow';

interface Recip { key: string; name: string; email: string; role: RecipientRole; routingOrder: number; accessCode?: string; privateMessage?: string }
type Sect = 'docs' | 'rec' | 'wf' | 'msg';
const newRecip = (order: number): Recip => ({ key: uid(), name: '', email: '', role: 'signer', routingOrder: order });
const ROLES: RecipientRole[] = ['signer', 'inPersonSigner', 'viewer', 'carbonCopy'];

export function SendPage() {
  const nav = useNavigate();
  const ui = useUi();
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const templateId = sp.get('template');

  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [wfTypes, setWfTypes] = useState<WorkflowTypeDto[] | null>(null);
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [tpl, setTpl] = useState<TemplateDetail | null>(null);

  const [files, setFiles] = useState<PdfItem[]>([]);
  const [atts, setAtts] = useState<File[]>([]);
  const [onlyMe, setOnlyMe] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [recips, setRecips] = useState<Recip[]>([newRecip(1)]);
  const [wf, setWf] = useState<WfState>(() => wfDefault(null));
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [reminder, setReminder] = useState('0');
  const [expiry, setExpiry] = useState('30');
  const [open, setOpen] = useState<Record<Sect, boolean>>({ docs: true, rec: false, wf: false, msg: false });
  const [sugDismissed, setSugDismissed] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // load defaults, metadata, contacts and (optionally) the template
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [settings, types, cts] = await Promise.all([
          api.settings().catch(() => null), api.workflowTypes().catch(() => null), api.contacts().catch(() => [] as ContactDto[]),
        ]);
        if (off) return;
        setWfTypes(types); setContacts(cts);
        const w = wfDefault(settings);
        setWf(w);
        if (settings) { setExpiry(String(settings.expiryDays || 30)); setReminder(String(settings.reminderDays || 0)); }
        setOpen(o => ({ ...o, wf: w.enabled }));
        if (templateId) {
          const [t, blob] = await Promise.all([api.template(templateId), api.templateDocument(templateId)]);
          if (off) return;
          const name = /\.pdf$/i.test(t.template.documentName) ? t.template.documentName : t.template.documentName + '.pdf';
          const file = new File([blob], name, { type: 'application/pdf' });
          const d = await describePdf(file);
          if (off) return;
          setTpl(t);
          setFiles([{ file, ...d }]);
          const def = t.definition;
          const rs = def.recipients.map(r => ({ key: uid(), name: r.name, email: r.email, role: r.role, routingOrder: r.routingOrder || 1, accessCode: r.accessCode || undefined, privateMessage: r.privateMessage || undefined }));
          setRecips(rs.length ? rs : [newRecip(1)]);
          setOrdered(rs.some(r => r.routingOrder > 1));
          if (def.workflow) setWf(wfFromInput(def.workflow));
          setSubject((def.subject || t.template.subject || '').slice(0, 100));
          setMessage(def.message || '');
          setOpen({ docs: true, rec: true, wf: !!def.workflow || w.enabled, msg: true });
        }
        setReady(true);
      } catch (e) { if (!off) { setLoadErr(errMsg(e)); setReady(true); } }
    })();
    return () => { off = true; };
  }, [templateId]);

  const types = useMemo(() => wfTypeList(wfTypes), [wfTypes]);
  const validRecips = recips.filter(r => r.name.trim() && emailOk(r.email.trim()));
  const sug = reminder === '0' && !sugDismissed && !onlyMe;

  const setR = (i: number, patch: Partial<Recip>) => setRecips(rs => rs.map((r, k) => k === i ? { ...r, ...patch } : r));
  const removeR = (i: number) => setRecips(rs => rs.filter((_, k) => k !== i));
  const onFiles = (f: PdfItem[]) => {
    setFiles(f);
    if (f.length && !subject) setSubject(('Please sign: ' + f[0].file.name).slice(0, 100));
  };
  const addAtts = () => pickFiles(fl => {
    const { ok, error } = checkAttachments(fl, atts.length);
    if (error) ui.toast(error);
    if (ok.length) setAtts(a => [...a, ...ok]);
  });

  const askCode = async (i: number) => {
    const v = await ui.prompt({ title: 'Add access code', text: 'Enter a code that only you and this recipient know. Share it with them separately (phone, chat) — it is never included in the email.', label: 'Access code', value: recips[i].accessCode || '', minLength: 4 });
    if (v !== null) setR(i, { accessCode: v });
  };
  const askMsg = async (i: number) => {
    const v = await ui.prompt({ title: 'Add private message', text: 'Include a personal note that only this recipient will see.', label: 'Private message', value: recips[i].privateMessage || '', area: true, maxLength: 1000 });
    if (v !== null) setR(i, { privateMessage: v });
  };

  const fail = (sect: Sect, msg: string) => { setOpen(o => ({ ...o, [sect]: true })); ui.toast(msg); };

  const submit = async () => {
    if (!files.length) return fail('docs', 'Add at least one document.');
    const exp = Math.min(365, Math.max(1, Number(expiry) || 30));
    let payload: CreateEnvelopeRequest;
    if (onlyMe) {
      if (!user) return;
      payload = {
        type: 'self', subject: ('Complete with MGT Sign: ' + files[0].file.name).slice(0, 100), message: null, signingOrder: false,
        expiryDays: exp, reminderDays: 0, recipients: [{ name: user.name, email: user.email, role: 'signer', routingOrder: 1 }], workflow: null,
      };
    } else {
      const R = recips.filter(r => r.name.trim() || r.email.trim());
      if (!R.length) return fail('rec', 'Add at least one recipient.');
      for (const r of R) if (!r.name.trim() || !emailOk(r.email.trim())) return fail('rec', 'Each recipient needs a name and a valid email.');
      if (!R.some(r => isSignerRole(r.role))) return fail('rec', 'Add at least one recipient who needs to sign.');
      const emails = R.map(r => r.email.trim().toLowerCase());
      if (new Set(emails).size !== emails.length) return fail('rec', 'The same email appears twice in the recipients.');
      if (!subject.trim()) return fail('msg', 'Enter a subject.');
      if (wf.enabled) { const err = wfValidate(wf); if (err) return fail('wf', err); }
      payload = {
        type: 'request', subject: subject.trim(), message: message.trim() || null, signingOrder: ordered, expiryDays: exp, reminderDays: Number(reminder) || 0,
        recipients: R.map(r => ({
          name: r.name.trim(), email: r.email.trim(), role: r.role, routingOrder: ordered ? Math.max(1, r.routingOrder || 1) : 1,
          accessCode: r.accessCode || null, privateMessage: r.privateMessage || null,
        })),
        workflow: wf.enabled ? wfToInput(wf) : null,
        templateId: tpl ? tpl.template.id : null,
      };
    }
    setBusy(true);
    try {
      const env = await api.createEnvelope(payload, files.map(f => f.file), atts);
      nav(`/envelopes/${env.id}/prepare`);
    } catch (e) { ui.toast(errMsg(e)); setBusy(false); }
  };

  const sect = (k: Sect, title: ReactNode, body: ReactNode) => (
    <section className="sx">
      <button className="sx-h" onClick={() => setOpen(o => ({ ...o, [k]: !o[k] }))} aria-expanded={open[k]}>{<span>{title}</span>}<Icon name={open[k] ? 'chevu' : 'chev'} size={20} /></button>
      {open[k] && <div className="sx-b">{body}</div>}
    </section>
  );

  const dropRecip = (to: number) => {
    const from = dragFrom.current; dragFrom.current = null; setDragOver(null);
    if (from === null || from === to) return;
    setRecips(rs => { const n = [...rs]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return ordered ? n.map((r, k) => ({ ...r, routingOrder: k + 1 })) : n; });
  };

  if (!ready) return <Loading />;

  return <>
    <div className="sendpage">
      <PageHead eb="Agreements" title="Request signatures" desc="Add documents and recipients, then place fields for each signer." />
      {loadErr && <ErrorNote error={loadErr} />}
      {tpl && <div className="hint" style={{ marginBottom: 10 }}><Icon name="tpl" size={14} /> Using template <b>{tpl.template.name}</b> — its field placements are copied to the new envelope.</div>}
      {sug && <div className="sug"><Icon name="mega" size={18} /><span>Review <b>1</b> suggestion to boost completion rates.</span><button className="btn sm ghost" onClick={() => setShowSug(true)}>Review Suggestions</button></div>}

      {sect('docs', <>Add documents{atts.length > 0 && <span className="pill" style={{ marginLeft: 10 }}><Icon name="clip" size={12} /> {atts.length} attachment{atts.length > 1 ? 's' : ''}</span>}</>, <>
        <UploadArea files={files} onChange={onFiles} />
        {files.length > 1 && <p className="hint">The documents are combined into one envelope in the order shown.</p>}
        <div className="att-box">
          <div className="att-box-h">
            <div><b><Icon name="clip" size={16} /> Supporting attachments</b><div className="hint" style={{ margin: '2px 0 0' }}>Quotations, specifications, ID copies or other evidence. Recipients can download them; they are not signed. Up to {fmtSize(ATT_MAX)} per file.</div></div>
            <button className="btn sm" onClick={addAtts}><Icon name="plus" size={14} /> Attach files</button>
          </div>
          <StagedFiles files={atts} onRemove={i => setAtts(a => a.filter((_, k) => k !== i))} />
        </div>
      </>)}

      {sect('rec', 'Add recipients', <>
        <label className="chk"><input type="checkbox" checked={onlyMe} onChange={e => setOnlyMe(e.target.checked)} /> I'm the only signer <span title="You will sign the document yourself. No email is sent to anyone else."><Icon name="info" size={18} /></span></label>
        {onlyMe ? <div className="note" style={{ marginTop: 14 }}><Icon name="info" size={16} /> <span>You'll sign this document yourself. Click <b>Sign</b> to continue.</span></div> : <>
          <div style={{ margin: '16px 0 18px' }}>
            <label className="chk"><input type="checkbox" checked={ordered} onChange={e => { setOrdered(e.target.checked); if (e.target.checked) setRecips(rs => rs.map((r, k) => ({ ...r, routingOrder: k + 1 }))); }} /> Set signing order</label>{' '}
            <a href="#order" onClick={e => { e.preventDefault(); setShowOrder(true); }}>View</a>
          </div>
          <div>
            {recips.map((r, i) => (
              <div key={r.key} className={'rc ' + (dragOver === i ? 'over' : '')} draggable={false}
                onDragOver={e => { if (dragFrom.current !== null) { e.preventDefault(); setDragOver(i); } }}
                onDragLeave={() => setDragOver(d => d === i ? null : d)}
                onDrop={e => { e.preventDefault(); dropRecip(i); }}>
                <div className="rbar" style={{ background: COLORS[i % COLORS.length] }} />
                <div className="grip" title="Drag to reorder" draggable
                  onDragStart={e => { dragFrom.current = i; e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}><Icon name="grip" size={16} /></div>
                {ordered && <div className="ordn"><label className="l">Order</label><input className="inp" type="number" min={1} value={r.routingOrder} onChange={e => setR(i, { routingOrder: Number(e.target.value) || 1 })} /></div>}
                <div className="rf">
                  <label className="l">Name <span className="req">*</span></label>
                  <div className="nwrap">
                    <button className="nbtn" title="Choose from contacts" onClick={e => ui.menu(e.currentTarget, [
                      ...(user ? [{ label: `${user.name} — ${user.email} (me)`, icon: 'user' as const, run: () => setR(i, { name: user.name, email: user.email }) }] : []),
                      ...contacts.map(p => ({ label: `${p.name} — ${p.email}`, icon: 'user' as const, run: () => setR(i, { name: p.name, email: p.email }) })),
                    ], 'Contacts')}><Icon name="copy" size={18} /></button>
                    <input className="inp" value={r.name} onChange={e => setR(i, { name: e.target.value })} aria-label="Recipient name" />
                  </div>
                  <label className="l">Email <span className="req">*</span></label>
                  <input className="inp" list="dir" value={r.email} aria-label="Recipient email" onChange={e => {
                    const email = e.target.value; const p = contacts.find(d => d.email === email);
                    setR(i, p && !r.name ? { email, name: p.name } : { email });
                  }} />
                  {r.accessCode && <div className="rtag"><Icon name="key" size={14} /> Access code required <a href="#rm" onClick={e => { e.preventDefault(); setR(i, { accessCode: undefined }); }}>Remove</a></div>}
                  {r.privateMessage && <div className="rtag"><Icon name="msg" size={14} /> Private message: “{r.privateMessage.slice(0, 60)}{r.privateMessage.length > 60 ? '…' : ''}” <a href="#rm" onClick={e => { e.preventDefault(); setR(i, { privateMessage: undefined }); }}>Remove</a></div>}
                </div>
                <div className="ra">
                  <button className="btn ghost" onClick={e => ui.menu(e.currentTarget, ROLES.map(k => ({ label: (r.role === k ? '✓ ' : ' ') + ROLE_LABEL[k], icon: ROLE_ICON[k], run: () => setR(i, { role: k }) })))}>
                    <Icon name={ROLE_ICON[r.role]} /> {ROLE_LABEL[r.role]} <Icon name="chev" size={14} />
                  </button>
                  <button className="btn ghost" onClick={e => ui.menu(e.currentTarget, [
                    { label: r.accessCode ? 'Change access code' : 'Add access code', icon: 'key', run: () => void askCode(i) },
                    { label: r.privateMessage ? 'Edit private message' : 'Add private message', icon: 'msg', run: () => void askMsg(i) },
                    { label: 'Delete Recipient', icon: 'trash', bad: true, run: () => removeR(i) },
                  ])}>Customize <Icon name="chev" size={14} /></button>
                  <button className="icon-btn" title="Delete recipient" aria-label="Delete recipient" onClick={() => removeR(i)}><Icon name="trash" size={20} /></button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn" onClick={() => setRecips(rs => [...rs, newRecip(rs.length + 1)])}><Icon name="plus" size={16} /> Add Recipient</button>
        </>}
      </>)}

      {!onlyMe && sect('wf', <>Approval workflow{wf.enabled
        ? <span className="pill pending_approval" style={{ marginLeft: 10 }}>{types.find(t => t.type === wf.type)?.en || wf.type}</span>
        : <span className="pill" style={{ marginLeft: 10 }}>Off</span>}</>,
        <WorkflowBuilder W={wf} set={setWf} types={types} contacts={contacts} />)}

      {!onlyMe && sect('msg', 'Add message', <>
        <label className="l">Subject <span className="req">*</span></label>
        <input className="inp" maxLength={100} value={subject} onChange={e => setSubject(e.target.value)} /><div className="cnt">{subject.length}/100</div>
        <label className="l">Message</label>
        <textarea className="inp" maxLength={10000} placeholder="Enter Message" value={message} onChange={e => setMessage(e.target.value)} /><div className="cnt">{message.length}/10000</div>
      </>)}

      {!onlyMe && <div className="opts">
        <div><label className="l lite">Frequency of reminders</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select className="inp" style={{ width: 180 }} value={reminder} disabled={!validRecips.length} onChange={e => setReminder(e.target.value)}>
              {Object.entries(REMINDERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span title="Recipients who have not completed their action get a reminder email at this interval until the envelope expires."><Icon name="info" size={20} /></span>
          </div></div>
        <div><label className="l lite">Expires after (days)</label><input className="inp" type="number" min={1} max={365} style={{ width: 120 }} value={expiry} onChange={e => setExpiry(e.target.value)} /></div>
      </div>}
      <datalist id="dir">{contacts.map(p => <option key={p.id} value={p.email}>{p.name}</option>)}</datalist>
    </div>
    <div className="sendbar">
      <button className="btn ghost" onClick={() => nav('/')}>Cancel</button>
      <button className="btn blue" disabled={busy} onClick={submit}>{busy ? 'Uploading…' : onlyMe ? 'Sign' : 'Next'}</button>
    </div>

    {showSug && <SuggestionModal onClose={() => setShowSug(false)} apply={on => { if (on) { setReminder('1'); ui.toast('Automatic reminders turned on (every day).'); } else setSugDismissed(true); setShowSug(false); }} />}
    {showOrder && <OrderModal recips={recips} ordered={ordered} onClose={() => setShowOrder(false)} />}
  </>;
}

function SuggestionModal({ onClose, apply }: { onClose: () => void; apply: (on: boolean) => void }) {
  const [rem, setRem] = useState(false);
  return (
    <Modal onClose={onClose} size="sm" title="Boost completion rates">
      <p style={{ marginTop: -8, fontSize: 14 }}>Here are a few changes you can make to improve this envelope's performance. Select as many as you like, and we'll apply the changes automatically.</p>
      <label className="chk" style={{ alignItems: 'flex-start', marginTop: 10 }}><input type="checkbox" checked={rem} onChange={e => setRem(e.target.checked)} style={{ marginTop: 4 }} />
        <span><b style={{ fontWeight: 600 }}><Icon name="clock" size={16} /> Send automatic reminders</b><br /><span className="hint">Send a reminder every day to recipients who haven't completed the envelope yet.</span></span></label>
      <div className="mfoot"><button className="btn" onClick={() => apply(true)}>Apply all</button><button className="btn blue" onClick={() => apply(rem)}>Apply selected</button></div>
    </Modal>
  );
}

function OrderModal({ recips, ordered, onClose }: { recips: Recip[]; ordered: boolean; onClose: () => void }) {
  const R = recips.filter(r => r.name || r.email);
  const groups = new Map<number, Recip[]>();
  R.forEach(r => { const k = ordered ? r.routingOrder : 1; groups.set(k, [...(groups.get(k) || []), r]); });
  const keys = [...groups.keys()].sort((a, b) => a - b);
  return (
    <Modal onClose={onClose} size="wide" title="Signing order">
      <p className="hint" style={{ marginTop: -8 }}>{ordered ? 'Recipients with the same number receive the envelope at the same time. The next group receives it after the previous group finishes.' : 'Signing order is off — every recipient receives the envelope at the same time.'}</p>
      <div className="flow">
        <div className="fnode me"><Icon name="send" size={16} /> You send</div>
        {keys.map(k => <span key={k} style={{ display: 'contents' }}>
          <div className="farrow">→</div>
          <div className="fgroup"><div className="fk">{k}</div>
            {groups.get(k)!.map(r => <div key={r.key} className="fnode" style={{ borderLeft: '4px solid ' + COLORS[recips.indexOf(r) % COLORS.length] }}>
              <b>{r.name || '(no name)'}</b><small><Icon name={ROLE_ICON[r.role]} size={13} /> {ROLE_LABEL[r.role]}</small></div>)}
          </div>
        </span>)}
        <div className="farrow">→</div><div className="fnode done"><Icon name="check" size={16} /> Completed</div>
      </div>
      <div className="mfoot"><button className="btn primary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
