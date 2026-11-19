import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { AttachmentTable } from '../components/Attachments';
import { useCounts } from '../components/AppShell';
import { StatusPill } from '../components/common';
import { useEnvelopeActions } from '../components/envelopeActions';
import { Modal } from '../components/Modal';
import { PdfViewer } from '../components/PdfPages';
import { LiveFlow } from '../components/WorkflowFlow';
import { ErrorNote, Loading, useUi } from '../components/ui';
import { Icon } from '../lib/icons';
import { checkAttachments, errMsg, fmt, fmtTHB, pickFiles, RECIPIENT_STATUS_CLASS, ROLE_LABEL } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { wfName } from '../lib/workflow';

type Tab = 'sum' | 'att' | 'aud';
const WF_STATUS: Record<string, [string, string]> = {
  approved: ['completed', 'Approved'], rejected: ['declined', 'Rejected'], active: ['pending_approval', 'In progress'], pending: ['draft', 'Not started'],
};

export function DetailsPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const ui = useUi();
  const { refresh } = useCounts();
  const [tab, setTab] = useState<Tab>('sum');
  const [viewDoc, setViewDoc] = useState(false);
  const { data: e, setData, error, loading, reload } = useLoad(() => api.envelope(id), [id]);
  const audit = useLoad(() => api.audit(id), [id]);
  const acts = useEnvelopeActions(() => { reload(); audit.reload(); refresh(); });

  if (!e && loading) return <Loading />;
  if (!e) return <ErrorNote error={error || 'Envelope not found.'} onRetry={reload} />;

  const A = e.actions;
  const original = e.documents.find(d => d.kind === 'original') || e.documents[0];
  const signed = e.documents.find(d => d.kind === 'signed');
  const addAtt = () => pickFiles(async fl => {
    const { ok, error: err } = checkAttachments(fl, e.attachments.length);
    if (err) ui.toast(err);
    if (!ok.length) return;
    try {
      const added = await api.addAttachments(id, ok);
      setData({ ...e, attachments: [...e.attachments, ...added] });
      audit.reload();
      ui.toast(`${added.length} attachment${added.length > 1 ? 's' : ''} added.`);
    } catch (x) { ui.toast(errMsg(x)); }
  });

  return <>
    <div className="ph">
      <div>
        <div className="eb">Envelope</div>
        <h1>{e.subject}</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <StatusPill status={e.status} label={e.statusLabel} /><span className="hint" style={{ margin: 0 }}>{e.code}</span>
          {e.isDeleted && <span className="pill voided">In Deleted folder</span>}
        </div>
      </div>
      <div className="act-r">
        {A.signToken && <button className="btn primary" onClick={() => nav('/sign/' + A.signToken)}><Icon name="sign" size={16} /> Sign</button>}
        {A.approveToken && <button className="btn primary" onClick={() => nav('/approve/' + A.approveToken)}><Icon name="approve" size={16} /> Approve</button>}
        {A.canEditFields && e.status === 'draft' && <button className="btn primary" onClick={() => nav(`/envelopes/${id}/prepare`)}><Icon name="edit" size={16} /> Continue editing</button>}
        <button className="btn" onClick={() => setViewDoc(true)}><Icon name="pages" size={16} /> View document</button>
        <button className="btn" onClick={() => acts.download(id, e)}><Icon name="down" size={16} /> Download{signed ? ' signed' : ''}</button>
        <button className="icon-btn" aria-label="More actions" style={{ alignSelf: 'center' }} onClick={ev => ui.menu(ev.currentTarget, [
          ...(A.canRemind ? [{ label: 'Resend reminder', icon: 'mail' as const, run: () => void acts.remind(id) }] : []),
          ...(A.canSaveTemplate ? [{ label: 'Save as template', icon: 'tpl' as const, run: () => void acts.saveTemplate(id, e.subject) }] : []),
          ...(A.canVoid ? [{ label: 'Void', icon: 'ban' as const, bad: true, run: () => void acts.voidOne(id) }] : []),
          ...(e.isDeleted
            ? [{ label: 'Restore', icon: 'hist' as const, run: () => void acts.restore(id) }, { label: 'Delete permanently', icon: 'trash' as const, bad: true, run: () => void acts.purge(id).then(ok => { if (ok) nav('/agreements/deleted'); }) }]
            : A.canDelete ? [{ label: 'Delete', icon: 'trash' as const, bad: true, run: () => void acts.del(id) }] : []),
        ], 'Other Actions')}><Icon name="dots" size={20} /></button>
      </div>
    </div>
    {error && <ErrorNote error={error} onRetry={reload} />}

    <div className="card">
      <div className="tabs" style={{ marginTop: 0 }}>
        <button className={tab === 'sum' ? 'active' : ''} onClick={() => setTab('sum')}>Summary</button>
        <button className={tab === 'att' ? 'active' : ''} onClick={() => setTab('att')}>Attachments ({e.attachments.length})</button>
        <button className={tab === 'aud' ? 'active' : ''} onClick={() => setTab('aud')}>Audit trail{audit.data ? ` (${audit.data.length})` : ''}</button>
      </div>

      {tab === 'sum' && <>
        <dl className="kv">
          <dt>Document</dt><dd>{original ? `${original.fileName} · ${original.pageCount} page(s)` : '—'}</dd>
          <dt>Sender</dt><dd>{e.senderName} &lt;{e.senderEmail}&gt;</dd>
          <dt>Created</dt><dd>{fmt(e.createdAt)}</dd>
          {e.sentAt && <><dt>Sent</dt><dd>{fmt(e.sentAt)}</dd></>}
          <dt>{e.status === 'completed' ? 'Completed' : 'Expires'}</dt><dd>{fmt(e.status === 'completed' ? e.completedAt : e.expiresAt)}</dd>
          <dt>Reminders</dt><dd>{e.reminderDays ? `Every ${e.reminderDays} day(s)` : 'Off'}</dd>
          <dt>Signing order</dt><dd>{e.signingOrder ? 'On' : 'Off'}</dd>
          {original && <><dt>SHA-256 (original)</dt><dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{original.sha256}</dd></>}
          {signed && <><dt>SHA-256 (signed)</dt><dd style={{ fontFamily: 'monospace', fontSize: 12 }}>{signed.sha256}</dd></>}
          {e.message && <><dt>Message</dt><dd style={{ wordBreak: 'normal', whiteSpace: 'pre-wrap' }}>{e.message}</dd></>}
          {e.voidReason && <><dt>Void reason</dt><dd>{e.voidReason}</dd></>}
        </dl>
        {e.workflow && <>
          <div className="sec">Approval workflow <span className={'pill ' + (WF_STATUS[e.workflow.status]?.[0] || 'draft')}>{wfName(e.workflow.type)} · {WF_STATUS[e.workflow.status]?.[1] || e.workflow.status}</span></div>
          {(e.workflow.amount != null || e.workflow.allowDelegation) && <p className="hint" style={{ marginTop: -4 }}>
            {e.workflow.amount != null ? 'Document value: ' + fmtTHB(e.workflow.amount) : ''}{e.workflow.amount != null && e.workflow.allowDelegation ? ' · ' : ''}{e.workflow.allowDelegation ? 'Delegation allowed' : ''}</p>}
          <LiveFlow w={e.workflow} />
        </>}
        <div className="sec">Recipients</div>
        {e.recipients.length ? <div className="tbl-wrap"><table className="t"><thead><tr><th>#</th><th>Recipient</th><th>Role</th><th>Status</th><th>Completed</th></tr></thead><tbody>
          {[...e.recipients].sort((a, b) => a.routingOrder - b.routingOrder).map(r => (
            <tr key={r.id}>
              <td><span className="dot" style={{ display: 'inline-block', background: r.color }} /> {r.routingOrder}</td>
              <td><b>{r.name}</b><div className="to">{r.email}{r.hasAccessCode ? ' · access code' : ''}</div></td>
              <td>{ROLE_LABEL[r.role]}</td>
              <td><span className={'pill ' + (RECIPIENT_STATUS_CLASS[r.status] || '')}>{r.role === 'carbonCopy' ? (e.status === 'completed' ? 'Copy sent' : 'Waiting') : r.status[0].toUpperCase() + r.status.slice(1)}</span></td>
              <td>{r.completedAt ? fmt(r.completedAt) : '—'}</td>
            </tr>
          ))}
        </tbody></table></div> : <p className="hint">No recipients.</p>}
      </>}

      {tab === 'att' && <>
        <AttachmentTable list={e.attachments} download={a => api.attachment(id, a.id)} />
        {A.canAddAttachments && <div style={{ marginTop: 12 }}><button className="btn sm" onClick={addAtt}><Icon name="plus" size={14} /> Attach files as sender</button></div>}
      </>}

      {tab === 'aud' && (audit.error ? <ErrorNote error={audit.error} onRetry={audit.reload} /> : !audit.data ? <Loading /> :
        audit.data.length ? <div className="tl">{[...audit.data].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).map(a => (
          <div className="ev" key={a.id}><b>{a.action}</b><div>{fmt(a.at)} · {a.actor}{a.ipAddress ? ' · ' + a.ipAddress : ''}</div>{a.detail && <div style={{ wordBreak: 'break-all' }}>{a.detail}</div>}</div>
        ))}</div> : <p className="hint">No events yet.</p>)}
    </div>

    {viewDoc && <Modal onClose={() => setViewDoc(false)} size="wide" title={<><Icon name="pages" size={22} /> {signed ? signed.fileName : original?.fileName || 'Document'}</>}>
      <PdfViewer load={() => api.document(id, 'current')} deps={[id]} />
    </Modal>}
  </>;
}
