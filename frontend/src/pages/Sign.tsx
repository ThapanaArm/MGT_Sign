import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, auth, saveBlob, setAccessCode, ApiError } from '../api/client';
import type { AttachmentDto, FieldDto, FieldValueInput, SignatureDto, SignSession } from '../api/types';
import { AdoptSignature } from '../components/AdoptSignature';
import { AttachmentsModal } from '../components/Attachments';
import { Brand } from '../components/common';
import { PdfPages, usePdf, type PageBox } from '../components/PdfPages';
import { ErrorNote, Loading, useUi } from '../components/ui';
import { FIELD_DEFS, hasValue, isImageField, TEXT_INPUT_FIELDS } from '../lib/fields';
import { Icon, type IconName } from '../lib/icons';
import { errMsg, fmtDate } from '../lib/format';
import { PAGE_WIDTH } from '../lib/pdf';
import { fontsReady, makeStamp, renderValuePng } from '../lib/signature';

/** Public signing page: /sign/:token (no app shell). */
export function SignPage() {
  const { token = '' } = useParams();
  const [session, setSession] = useState<SignSession | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setSession(await api.signSession(token)); }
    catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => setAccessCode(null), []);

  if (loading && !session) return <PubFrame><Loading /></PubFrame>;
  if (!session) return <PubFrame><div className="pubbody"><ErrorNote error={error || 'This signing link is not valid.'} onRetry={load} /></div></PubFrame>;
  if (session.state === 'accessCode') return <PubFrame><AccessCodeForm session={session} onDone={setSession} /></PubFrame>;
  if (session.state !== 'ready') return <PubFrame title={session.subject}><SignResult s={session} /></PubFrame>;
  return <Signer key={session.token + session.state} session={session} token={token} onDone={setSession} />;
}

function PubFrame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="pubpage">
      <div className="pubbar"><Brand compact />{title && <div className="ttl">{title}</div>}<BackLink /></div>
      {children}
    </div>
  );
}
function BackLink() {
  const nav = useNavigate();
  if (!auth.token) return null;
  return <div className="acts"><button className="btn sm" onClick={() => nav('/')}>Back to MGT Sign</button></div>;
}

function AccessCodeForm({ session, onDone }: { session: SignSession; onDone: (s: SignSession) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!code.trim()) { setError('Enter the access code.'); return; }
    setBusy(true); setError('');
    setAccessCode(code.trim());
    try {
      const s = await api.signSession(session.token);
      if (s.state === 'accessCode') { setError('Incorrect access code.'); setAccessCode(null); }
      else onDone(s);
    } catch (e) { setAccessCode(null); setError(e instanceof ApiError && (e.status === 403 || e.status === 401) ? 'Incorrect access code.' : errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="pubbody"><div className="card" style={{ maxWidth: 480, margin: '40px auto' }}>
      <h3 style={{ justifyContent: 'flex-start' }}><Icon name="lock" size={22} /> Access code required</h3>
      <p className="hint" style={{ marginTop: -8 }}>{session.recipient.name}, enter the access code the sender ({session.senderName}) gave you to open “{session.subject}”.</p>
      {error && <ErrorNote error={error} />}
      <input className="inp" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void submit(); }} autoFocus aria-label="Access code" />
      <div className="mfoot"><button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Checking…' : 'Validate'}</button></div>
    </div></div>
  );
}

function SignResult({ s }: { s: SignSession }) {
  const viewer = s.recipient.role === 'viewer';
  const R: Record<string, [IconName, string, string, string]> = {
    done: ['check', 'tone-green', viewer ? 'Thanks for reviewing' : "You're done signing", viewer ? 'Your acknowledgement was recorded in the audit trail.' : 'Your signature was applied and recorded in the audit trail. You will receive the completed document by email once every party has finished.'],
    declined: ['ban', 'tone-red', 'You declined to sign', 'The sender has been notified. No further action is needed.'],
    closed: ['info', 'tone-amber', 'This envelope is closed', 'The envelope was completed, voided or declined, so it can no longer be signed.'],
    waiting: ['clock', 'tone-blue', "It's not your turn yet", 'Other recipients or approvers need to act first. You will receive an email when the document is ready for you.'],
    expired: ['clock', 'tone-red', 'This link has expired', 'Ask the sender to send the envelope again.'],
  };
  const [icon, tone, title, text] = R[s.state] || R.closed;
  return (
    <div className="pubbody"><div className="result">
      <div className={'eic ' + tone}><Icon name={icon} size={28} /></div>
      <h1>{title}</h1>
      <p>{text}</p>
      <p className="hint">{s.subject} · {s.code} · sent by {s.senderName}</p>
    </div></div>
  );
}

type Values = Record<string, string>;

function Signer({ session, token, onDone }: { session: SignSession; token: string; onDone: (s: SignSession) => void }) {
  const ui = useUi();
  const nav = useNavigate();
  const me = session.recipient;
  const viewer = me.role === 'viewer';
  const { pdf, error: pdfErr } = usePdf(() => api.signDocument(token), [token]);
  const mine = session.fields.filter(f => f.recipientId === me.id);
  const others = session.fields.filter(f => f.recipientId !== me.id && hasValue(f.value));
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    for (const f of mine) {
      if (f.type === 'name') v[f.id] = me.name;
      else if (f.type === 'email') v[f.id] = me.email;
      else if (f.type === 'dateSigned') v[f.id] = fmtDate(Date.now());
      else if (f.type === 'checkbox') v[f.id] = f.value === 'true' ? 'true' : 'false';
      else v[f.id] = isImageField(f.type) ? '' : f.value || '';
    }
    return v;
  });
  const [sig, setSig] = useState<SignatureDto | null>(null); // adopted in this session
  const [adoptFor, setAdoptFor] = useState<FieldDto | null>(null);
  const [atts, setAtts] = useState<AttachmentDto[]>(session.attachments);
  const [showAtt, setShowAtt] = useState(false);
  const [zoom, setZoom] = useState(() => Math.max(0.4, Math.min(1, (window.innerWidth - 120) / PAGE_WIDTH)));
  const [busy, setBusy] = useState(false);

  const current = sig || (session.savedSignature?.signatureImage ? session.savedSignature : null);
  const pending = mine.filter(f => f.required && !hasValue(values[f.id]));
  const setV = (id: string, v: string) => setValues(s => ({ ...s, [id]: v }));

  const fill = (f: FieldDto) => {
    if (f.type === 'signature' || f.type === 'initial') {
      const img = f.type === 'signature' ? current?.signatureImage : current?.initialImage;
      if (img && !hasValue(values[f.id])) setV(f.id, img);
      else setAdoptFor(f);
    } else if (f.type === 'stamp') {
      const company = mine.find(x => x.type === 'company' && hasValue(values[x.id]));
      setV(f.id, hasValue(values[f.id]) ? '' : makeStamp(company ? values[company.id] : 'MGT Group'));
    } else if (f.type === 'checkbox') setV(f.id, values[f.id] === 'true' ? 'false' : 'true');
  };

  const nextField = () => {
    const p = pending[0];
    if (!p) { ui.toast('All required fields are complete.'); return; }
    document.querySelector(`[data-fid="${p.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const finish = async () => {
    if (!viewer && pending.length) { ui.toast(`Complete ${pending.length} more required field${pending.length > 1 ? 's' : ''}.`); nextField(); return; }
    if (!pdf && !viewer) { ui.toast('The document is still loading.'); return; }
    setBusy(true);
    try {
      await fontsReady();
      const out: FieldValueInput[] = viewer ? [] : mine.map(f => {
        const v = values[f.id] || '';
        if (isImageField(f.type)) return { id: f.id, value: v || null, renderedImage: null };
        const s = pdf!.sizes[f.page] || pdf!.sizes[0];
        const wPt = f.width * s.w, hPt = f.height * s.h;
        if (f.type === 'checkbox') return { id: f.id, value: v === 'true' ? 'true' : 'false', renderedImage: renderValuePng('checkbox', v, wPt, hPt) };
        return { id: f.id, value: v.trim() ? v : null, renderedImage: v.trim() ? renderValuePng('text', v, wPt, hPt) : null };
      });
      const r = await api.completeSigning(token, { fields: out, adoptedSignature: sig });
      onDone(r);
    } catch (e) { ui.toast(errMsg(e)); } finally { setBusy(false); }
  };

  const decline = async () => {
    const reason = await ui.confirm({ title: 'Decline to sign?', text: 'The sender will be notified and the envelope will stop.', okLabel: 'Decline', withReason: true });
    if (reason === null) return;
    try { onDone(await api.declineSigning(token, { reason })); } catch (e) { ui.toast(errMsg(e)); }
  };
  const download = async () => { try { saveBlob(await api.signDocument(token), session.subject.replace(/[\\/:*?"<>|]+/g, '_') + '.pdf'); } catch (e) { ui.toast(errMsg(e)); } };

  const overlay = (p: PageBox) => [
    ...others.filter(f => f.page === p.index).map(f => {
      const fs = Math.max(9, f.height * p.H * 0.62);
      return (
        <div key={f.id} className="fld filled" style={{ left: f.x * 100 + '%', top: f.y * 100 + '%', width: f.width * 100 + '%', height: f.height * 100 + '%' }}>
          {isImageField(f.type) ? <img src={f.value!} alt="" />
            : f.type === 'checkbox' ? <div className="cb" style={{ fontSize: fs }}>{f.value === 'true' ? '✓' : ''}</div>
              : <div className="txtv" style={{ fontSize: fs }}>{f.value}</div>}
        </div>
      );
    }),
    ...mine.filter(f => f.page === p.index).map(f => {
      const v = values[f.id] || '', filled = hasValue(v), col = me.color || '#2368c4';
      const fs = Math.max(9, f.height * p.H * 0.62), def = FIELD_DEFS[f.type];
      const textInput = TEXT_INPUT_FIELDS.includes(f.type);
      const clickable = !filled && !textInput && f.type !== 'checkbox';
      let inner;
      if (f.type === 'checkbox') inner = <div className="cb" style={{ fontSize: fs, borderColor: filled ? '#333' : col }}>{v === 'true' ? '✓' : ''}</div>;
      else if (isImageField(f.type) && filled) inner = <img src={v} alt="" />;
      else if (textInput) inner = <input className="txt" style={{ fontSize: fs }} value={v} placeholder={f.label || def.label} aria-label={f.label || def.label} onChange={e => setV(f.id, e.target.value)} />;
      else if (filled) inner = <div className="txtv" style={{ fontSize: fs }}>{v}</div>;
      else if (f.type === 'signature' || f.type === 'initial') inner = <span className="lbl col" style={{ fontSize: Math.min(14, Math.max(9, fs * 0.5)) }}>{f.type === 'signature' ? 'Sign' : 'Initial'}<Icon name="sign" size={Math.min(26, Math.max(12, fs * 0.7))} /></span>;
      else inner = <span className="lbl" style={{ fontSize: Math.min(13, Math.max(9, fs * 0.8)) }}>{def.label}</span>;
      return (
        <div key={f.id} data-fid={f.id} title={f.tooltip || undefined}
          className={'fld editable ' + (filled || textInput || f.type === 'checkbox' ? 'filled ' : '') + (clickable ? 'clickable' : '')}
          style={{ left: f.x * 100 + '%', top: f.y * 100 + '%', width: f.width * 100 + '%', height: f.height * 100 + '%', borderColor: col, background: `color-mix(in srgb, ${col} 20%, transparent)`, cursor: textInput ? 'text' : 'pointer' }}
          onClick={textInput ? undefined : () => fill(f)} role={textInput ? undefined : 'button'}>
          {inner}
          {f.required && !filled && <span className="req-star">*</span>}
        </div>
      );
    }),
  ];

  return (
    <div className="ed">
      <div className="pubbar">
        <Brand compact />
        <div className="ttl">{session.subject}<small>{viewer ? 'Viewing as ' : me.role === 'inPersonSigner' ? 'In-person signing · ' : 'Signing as '}{me.name} · from {session.senderName}</small></div>
        <div className="acts">
          {auth.token && <button className="btn sm ghost" onClick={() => nav('/')}>Back to MGT Sign</button>}
          <div className="split">
            <button className="btn main-act" disabled={busy} onClick={finish}>{busy ? 'Finishing…' : 'Finish'}</button>
            <button className="btn dd" aria-label="Other actions" onClick={e => ui.menu(e.currentTarget, [
              { label: 'Attachments', icon: 'clip', run: () => setShowAtt(true) },
              { label: 'Download document', icon: 'down', run: () => void download() },
              ...(viewer ? [] : [{ label: 'Decline to sign', icon: 'ban' as const, bad: true, run: () => void decline() }]),
            ], 'Other Actions')}><Icon name="chev" size={16} /></button>
          </div>
        </div>
      </div>
      {viewer
        ? <div className="signbanner"><Icon name="eye" /> <span>You were asked to view this document. Review it, then click <b>Finish</b> to confirm you have viewed it.</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setShowAtt(true)}><Icon name="clip" size={14} /> Attachments ({atts.length})</button></div>
        : <div className="signbanner"><Icon name="info" /> <span>Please review the document and click each highlighted field to complete it. <b>{pending.length ? `${pending.length} required field${pending.length > 1 ? 's' : ''} left.` : 'All required fields are complete — click Finish.'}</b></span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setShowAtt(true)}><Icon name="clip" size={14} /> {session.canAddAttachments ? 'Attach file' : 'Attachments'}{atts.length ? ` (${atts.length})` : ''}</button>
          <button className="btn sm" onClick={nextField}>Next field</button></div>}
      {(session.message || me.privateMessage) && (
        <div className="signbanner" style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}><Icon name="msg" />
          <span style={{ whiteSpace: 'pre-wrap' }}>{me.privateMessage ? <><b>Private message for you:</b> {me.privateMessage}{session.message ? ' · ' : ''}</> : null}{session.message}</span></div>
      )}
      <div className="edbody">
        <div className="canvas-area">
          {pdfErr ? <ErrorNote error={pdfErr} /> : !pdf ? <div className="pdfwait"><Loading text="Opening document…" /></div> : <PdfPages pdf={pdf} zoom={zoom} overlay={overlay} />}
        </div>
        <aside className="tools">
          <button onClick={() => setShowAtt(true)} style={{ position: 'relative' }}><Icon name="clip" size={20} />Files<span className="att-badge">{atts.length || ''}</span></button>
          <button onClick={download}><Icon name="down" size={20} />Download</button>
          <button style={{ marginTop: 'auto' }} onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} aria-label="Zoom in"><Icon name="zin" size={20} /></button>
          <div className="zoom">{Math.round(zoom * 100)}%</div>
          <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label="Zoom out"><Icon name="zout" size={20} /></button>
        </aside>
      </div>

      {adoptFor && <AdoptSignature name={me.name} email={me.email} saved={session.savedSignature} onClose={() => setAdoptFor(null)}
        onAdopt={s => {
          const dto = { signatureImage: s.signatureImage, initialImage: s.initialImage };
          if (s.method !== 'saved') setSig(dto);
          setV(adoptFor.id, adoptFor.type === 'initial' ? dto.initialImage : dto.signatureImage);
          setAdoptFor(null);
        }} />}
      {showAtt && <AttachmentsModal list={atts} onClose={() => setShowAtt(false)} who={me.name}
        download={a => api.signAttachment(token, a.id)}
        upload={session.canAddAttachments ? async fl => { const added = await api.signAttach(token, fl); setAtts(a => [...a, ...added]); } : null} />}
    </div>
  );
}
