import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { EnvelopeListItem, Folder } from '../api/types';
import { useCounts } from '../components/AppShell';
import { useAuth } from '../components/auth';
import { StatusPill } from '../components/common';
import { useEnvelopeActions } from '../components/envelopeActions';
import { Empty, ErrorNote, Loading } from '../components/ui';
import { Icon, type IconName } from '../lib/icons';
import { ago } from '../lib/format';
import { useLoad } from '../lib/useLoad';

export function HomePage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { refresh } = useCounts();
  const { data, error, loading, reload } = useLoad(() => api.dashboard(), []);
  const acts = useEnvelopeActions(() => { reload(); refresh(); });
  const first = (user?.name || '').split(' ')[0];
  const go = (f: Folder) => nav('/agreements/' + f);

  const stat = (n: number, label: string, icon: IconName, tone: string, f: Folder) => (
    <button className="stat" onClick={() => go(f)}><span className={'si ' + tone}><Icon name={icon} size={20} /></span><span><b>{n}</b><small>{label}</small></span></button>
  );
  const row = (e: EnvelopeListItem) => {
    const p = acts.primary(e);
    return (
      <div className="act" key={e.id}>
        <div className="t"><div>{e.status === 'completed' ? 'Signed: ' : ''}{e.subject}</div><small>{ago(e.updatedAt)} · {e.code}</small></div>
        <StatusPill status={e.status} label={e.statusLabel} myTurn={e.myTurn} />
        <button className={'btn sm ' + p.cls} onClick={p.run}>{p.label}</button>
        <button className="icon-btn" onClick={() => nav('/envelopes/' + e.id)} aria-label="Details"><Icon name="chevr" /></button>
      </div>
    );
  };

  return <>
    <section className="welcome">
      <div><div className="eb">MGT ELECTRONIC SIGNATURE</div><h1>Welcome back, {first}</h1>
        <p>Sign documents, collect signatures and approvals from colleagues and partners, and keep a full audit trail for every agreement.</p>
        <div className="acts">
          <button className="btn primary" onClick={() => nav('/send')}><Icon name="send" size={16} /> Request signatures</button>
          <button className="btn" onClick={() => nav('/sign-document')}><Icon name="sign" size={16} /> Sign a document</button>
          <button className="btn" onClick={() => nav('/templates')}><Icon name="tpl" size={16} /> Use a template</button>
        </div>
      </div>
      <div className="seal" aria-hidden="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ color: '#fff' }}>Service Agreement</b><span className="st-ok"><Icon name="check" size={14} /> Completed</span></div>
        <div className="ln" style={{ width: '92%' }} /><div className="ln" style={{ width: '78%' }} /><div className="ln" style={{ width: '85%' }} />
        <div className="sg"><i>Somchai K.</i><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7 }}>SHA-256 · 9f2c…e41a</span></div>
      </div>
    </section>
    {error && <ErrorNote error={error} onRetry={reload} />}
    {!data && loading ? <Loading /> : data && <>
      <div className="stats">
        {stat(data.waitingForMe, 'Waiting for you', 'sign', 'tone-blue', 'progress')}
        {stat(data.waitingForOthers, 'Waiting for others', 'clock', 'tone-blue', 'progress')}
        {stat(data.awaitingApproval, 'Awaiting approval', 'approve', 'tone-amber', 'approval')}
        {stat(data.completed, 'Completed', 'check', 'tone-green', 'completed')}
      </div>
      <div className="grid-home">
        <div>
          <div className="card"><h3>Your tasks <span className="sub">{data.tasks.length ? data.tasks.length + ' to do' : ''}</span></h3>
            {data.tasks.length ? data.tasks.map(row) : <Empty icon="check" title="You're all caught up">Documents that need your signature or approval will show up here.</Empty>}
          </div>
          <div className="card mt"><h3>Agreement activity <a href="/agreements/all" className="sub" onClick={e => { e.preventDefault(); go('all'); }}>View all</a></h3>
            {data.recent.length ? data.recent.map(row) : <Empty icon="pages" title="No agreements yet">Start by signing a document or requesting signatures.</Empty>}
          </div>
        </div>
        <div>
          <div className="card"><h3>Overview</h3>
            <div className="ov-row" onClick={() => go('progress')}><span>Waiting for others</span><b>{data.waitingForOthers}</b></div>
            <div className="ov-row" onClick={() => go('approval')}><span>Awaiting approval</span><b>{data.awaitingApproval}</b></div>
            <div className="ov-row" onClick={() => go('progress')}><span>Expiring within 3 days</span><b>{data.expiringSoon}</b></div>
            <div className="ov-row" onClick={() => go('completed')}><span>Completed</span><b>{data.completed}</b></div>
          </div>
          <div className="card mt"><h3>Trust &amp; compliance</h3>
            <div className="hint" style={{ margin: 0, fontSize: 13, lineHeight: 1.75 }}><Icon name="shield" size={16} /> Every document is fingerprinted with SHA-256 and every action is written to the audit trail. Signed PDFs include a Certificate of Completion, in line with the Electronic Transactions Act B.E. 2544.</div>
            {user?.role === 'admin' && <button className="btn sm" style={{ marginTop: 14 }} onClick={() => nav('/admin?tab=settings')}><Icon name="gear" size={15} /> Workflow settings</button>}
          </div>
        </div>
      </div>
    </>}
  </>;
}
