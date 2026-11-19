import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, auth } from '../api/client';
import type { ApprovalSession, ApproverStatus, AttachmentDto } from '../api/types';
import { AttachmentTable } from '../components/Attachments';
import { Brand } from '../components/common';
import { Modal } from '../components/Modal';
import { PdfViewer } from '../components/PdfPages';
import { LiveFlow } from '../components/WorkflowFlow';
import { ErrorNote, Loading, useUi } from '../components/ui';
import { Icon, type IconName } from '../lib/icons';
import { checkAttachments, emailOk, errMsg, fmt, fmtTHB, pickFiles } from '../lib/format';
import { wfTypeList, WF_TYPES } from '../lib/workflow';

const AP_CLASS: Record<ApproverStatus, string> = { approved: 'completed', rejected: 'declined', delegated: 'sent', pending: 'pending_approval', notRequired: 'draft' };
const AP_LABEL: Record<ApproverStatus, string> = { approved: 'Approved', rejected: 'Rejected', delegated: 'Delegated', pending: 'Pending', notRequired: 'Not required' };

/** Public approval page: /approve/:token (no app shell). Port of the prototype's openWorkflowApprove. */
export function ApprovePage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const ui = useUi();
  const [s, setS] = useState<ApprovalSession | null>(null);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [atts, setAtts] = useState<AttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [review, setReview] = useState(false);
  const [delegate, setDelegate] = useState(false);
  const [typeName, setTypeName] = useState<{ en: string; th: string } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try { const r = await api.approvalSession(token); setS(r); setAtts(r.attachments); } catch (e) { setError(errMsg(e)); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!s) return;
    const local = WF_TYPES[s.workflow.type];
    setTypeName(local ? { en: local.en, th: local.th } : null);
    if (auth.token) api.workflowTypes().then(l => { const t = wfTypeList(l).find(x => x.type === s.workflow.type); if (t) setTypeName({ en: t.en, th: t.th }); }).catch(() => { });
  }, [s]);

  const frame = (children: ReactNode) => (
    <div className="pubpage">
      <div className="pubbar"><Brand compact />{s && <div className="ttl">{s.subject}<small>Approval request · {s.code}</small></div>}
        {auth.token && <div className="acts"><button className="btn sm" onClick={() => nav('/')}>Back to MGT Sign</button></div>}</div>
      <div className="pubbody">{children}</div>
    </div>
  );

  if (!s) return frame(error ? <ErrorNote error={error} onRetry={load} /> : <Loading />);

  const w = s.workflow;
  const steps = [...w.steps].sort((a, b) => a.sequence - b.sequence);
  const st = steps.find(x => x.id === s.activeStepId) || steps.find(x => x.status === 'active') || null;
  const me = s.approver;

  if (s.state !== 'ready' || !st) {
    const R: Record<string, [IconName, string, string, string]> = {
      done: me.status === 'rejected' ? ['ban', 'tone-red', me.veto ? 'You vetoed this request' : 'You rejected this request', 'The decision was recorded in the audit trail and the sender has been notified.']
        : me.status === 'delegated' ? ['share', 'tone-blue', 'Delegated', `You handed this decision to ${me.delegatedToEmail || 'your delegate'}. The hand-over is recorded in the audit trail.`]
          : ['check', 'tone-green', 'Thank you — your approval is recorded', 'The workflow continues with the next step or goes out for signature when every step is approved.'],
      waiting: ['clock', 'tone-blue', "It's not your turn yet", 'An earlier approval step must finish first. You will receive an email when this request is ready for you.'],
      closed: ['info', 'tone-amber', 'This request is closed', 'The workflow was completed, rejected or the envelope was voided, so no decision is needed.'],
    };
    const [icon, tone, title, text] = R[s.state] || R.closed;
    return frame(<>
      <div className="result"><div className={'eic ' + tone}><Icon name={icon} size={28} /></div><h1>{title}</h1><p>{text}</p></div>
      <div className="card"><h3>Route</h3><LiveFlow w={w} /></div>
    </>);
  }

  const idx = steps.indexOf(st);
  const pct = Math.min(100, (st.approved / Math.max(1, st.need)) * 100);
  const overdueAt = st.escalationDays && st.startedAt && !st.escalatedAt ? new Date(st.startedAt).getTime() + st.escalationDays * 864e5 : null;

  const decide = async (decision: 'approve' | 'reject') => {
    const c = comment.trim();
    if (decision === 'reject' && !c) { ui.toast('Enter a reason.'); return; }
    if (decision === 'reject' && await ui.confirm({ title: me.veto ? 'Veto this request?' : 'Reject this request?', text: me.veto ? 'A veto stops the whole workflow, whatever the rule.' : 'Your rejection is recorded. The step may no longer reach its required approvals.', okLabel: me.veto ? 'Veto' : 'Reject' }) === null) return;
    setBusy(true);
    try {
      const r = await api.decide(token, { decision, comment: c || null });
      setS(r); setAtts(r.attachments); setComment('');
      ui.toast(decision === 'approve' ? 'Approved.' : me.veto ? 'Vetoed — the workflow has stopped.' : 'Rejection recorded.');
    } catch (e) { ui.toast(errMsg(e)); } finally { setBusy(false); }
  };
  const addAtt = () => pickFiles(async fl => {
    const { ok, error: err } = checkAttachments(fl, atts.length);
    if (err) ui.toast(err);
    if (!ok.length) return;
    setUploading(true);
    try { const added = await api.approvalAttach(token, ok); setAtts(a => [...a, ...added]); ui.toast(`${added.length} attachment${added.length > 1 ? 's' : ''} added.`); }
    catch (e) { ui.toast(errMsg(e)); } finally { setUploading(false); }
  });

  return frame(<>
    <div className="card">
      <h3 style={{ justifyContent: 'flex-start' }}><Icon name="approve" size={22} /> Approval request</h3>
      <div className="wf-head"><span className="pill pending_approval">{typeName ? `${typeName.en} · ${typeName.th}` : w.type}</span><span className="hint" style={{ margin: 0 }}>{s.code}</span></div>
      <LiveFlow w={w} />
      <div className="wf-cur">
        <div className="wf-cur-h">
          <div><div className="eb">Step {idx + 1} of {steps.length}</div><b>{st.name}</b></div>
          <div className="wf-meter"><span>{st.approved} of {st.need} approval{st.need > 1 ? 's' : ''}</span><div className="prog"><i style={{ width: pct + '%' }} /></div><small>{st.ruleText}</small></div>
        </div>
        <div className="tbl-wrap"><table className="t"><thead><tr><th>Approver</th><th>Status</th><th>Decision</th></tr></thead><tbody>
          {st.approvers.map(m => (
            <tr key={m.id}>
              <td><b>{m.name}</b>{m.id === me.id && <span className="hint" style={{ margin: 0 }}> (you)</span>}
                {m.veto && <> <span className="pill declined">Veto</span></>}{m.isBackup && <> <span className="pill pending_approval">Backup</span></>}
                {m.delegatedFrom && <> <span className="pill sent">Delegate of {m.delegatedFrom}</span></>}
                <div className="to">{m.email}</div></td>
              <td><span className={'pill ' + AP_CLASS[m.status]}>{AP_LABEL[m.status]}</span></td>
              <td className="to">{m.actedAt ? <>{fmt(m.actedAt)}{m.actedBy ? ' · by ' + m.actedBy : ''}{m.comment && <><br />“{m.comment}”</>}</> : m.delegatedToEmail ? '→ ' + m.delegatedToEmail : '—'}</td>
            </tr>
          ))}
        </tbody></table></div>
        {overdueAt != null && <div className="hint"><Icon name="clock" size={14} /> Escalates {overdueAt - Date.now() > 0 ? 'in ' + Math.ceil((overdueAt - Date.now()) / 3600e3) + ' h' : 'now'} if no decision · {st.escalationMode === 'addBackup' ? 'backup authority ' + (st.escalationName || '') + ' will be added' : 'reminder and backup notice'} · never auto-approves</div>}
        {st.escalatedAt && <div className="hint"><Icon name="clock" size={14} /> Escalated on {fmt(st.escalatedAt)}</div>}
      </div>
      <dl className="kv" style={{ marginTop: 16 }}>
        {w.amount != null && <><dt>Document value</dt><dd>{fmtTHB(w.amount)}</dd></>}
        <dt>Sender</dt><dd>{s.senderName} &lt;{s.senderEmail}&gt;</dd>
        <dt>Pages</dt><dd>{s.pageCount}</dd>
        <dt>Message</dt><dd style={{ wordBreak: 'normal', whiteSpace: 'pre-wrap' }}>{s.message || '—'}</dd>
      </dl>
      <div className="att-box" style={{ marginTop: 16 }}>
        <div className="att-box-h">
          <div><b><Icon name="clip" size={16} /> Attachments ({atts.length})</b><div className="hint" style={{ margin: '2px 0 0' }}>Files you add here are saved with your decision.</div></div>
          {s.canAddAttachments && <button className="btn sm" disabled={uploading} onClick={addAtt}><Icon name="plus" size={14} /> {uploading ? 'Uploading…' : 'Attach files'}</button>}
        </div>
        {atts.length > 0 && <div style={{ marginTop: 12 }}><AttachmentTable list={atts} download={a => api.approvalAttachment(token, a.id)} /></div>}
      </div>
      <div className="form-grid">
        <div><label className="l">Acting as</label><input className="inp" disabled value={`${me.name} <${me.email}>${me.isBackup ? ' — backup' : ''}`} /></div>
        <div><label className="l">Comment</label><textarea className="inp" style={{ minHeight: 42 }} placeholder="Optional for approval, required to reject or delegate" value={comment} onChange={e => setComment(e.target.value)} /></div>
      </div>
      <div className="mfoot">
        <button className="btn left" onClick={() => setReview(true)}><Icon name="pages" size={16} /> Review document</button>
        {w.allowDelegation && <button className="btn" disabled={busy} onClick={() => setDelegate(true)}><Icon name="share" size={16} /> Delegate</button>}
        <button className="btn danger" disabled={busy} onClick={() => decide('reject')}>{me.veto ? 'Veto' : 'Reject'}</button>
        <button className="btn primary" disabled={busy} onClick={() => decide('approve')}><Icon name="check" size={16} /> Approve</button>
      </div>
    </div>
    {review && <Modal onClose={() => setReview(false)} size="wide" title={<><Icon name="pages" size={22} /> {s.subject}</>}>
      <PdfViewer load={() => api.approvalDocument(token)} deps={[token]} />
    </Modal>}
    {delegate && <DelegateModal s={s} stepName={st.name} initialReason={comment} onClose={() => setDelegate(false)} onDone={r => { setS(r); setAtts(r.attachments); setDelegate(false); }} token={token} />}
  </>);
}

function DelegateModal({ s, stepName, initialReason, token, onClose, onDone }: {
  s: ApprovalSession; stepName: string; initialReason: string; token: string; onClose: () => void; onDone: (r: ApprovalSession) => void;
}) {
  const ui = useUi();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState(initialReason);
  const [busy, setBusy] = useState(false);
  const me = s.approver;
  const go = async () => {
    const n = name.trim(), em = email.trim(), r = reason.trim();
    if (!n || !emailOk(em)) { ui.toast('Enter the delegate’s name and a valid email.'); return; }
    if (!r) { ui.toast('Enter a reason for the delegation.'); return; }
    const step = s.workflow.steps.find(x => x.id === s.activeStepId);
    if (step?.approvers.some(x => x.email.toLowerCase() === em.toLowerCase() && x.status !== 'delegated')) { ui.toast('That person is already an approver in this step.'); return; }
    if (em.toLowerCase() === s.senderEmail.toLowerCase()) { ui.toast('The sender cannot approve their own envelope.'); return; }
    setBusy(true);
    try { const res = await api.delegate(token, { name: n, email: em, reason: r }); ui.toast(`Delegated to ${n}.`); onDone(res); }
    catch (e) { ui.toast(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} size="sm" title={<><Icon name="share" size={20} /> Delegate approval</>}>
      <p className="hint" style={{ marginTop: -8 }}>{me.name} hands this decision in “{stepName}” to someone else. The delegate keeps the same rights{me.veto ? ', including veto' : ''}. The hand-over is recorded in the audit trail.</p>
      <div className="form-grid">
        <div><label className="l">Delegate name <span className="req">*</span></label><input className="inp" value={name} onChange={e => setName(e.target.value)} /></div>
        <div><label className="l">Delegate email <span className="req">*</span></label><input className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
      </div>
      <label className="l">Reason <span className="req">*</span></label><input className="inp" placeholder="e.g. On leave until 25 Nov" value={reason} onChange={e => setReason(e.target.value)} />
      <div className="mfoot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={go}>Delegate</button></div>
    </Modal>
  );
}
