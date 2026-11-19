import { api, saveBlob } from '../api/client';
import type { EnvelopeStatus, WorkflowType } from '../api/types';
import { ErrorNote, Loading, PageHead, useUi } from '../components/ui';
import { Icon } from '../lib/icons';
import { errMsg, fmt } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { WF_ORDER, wfName } from '../lib/workflow';

const STATUS_ROWS: [EnvelopeStatus, string, string][] = [
  ['completed', 'Completed', 'var(--ok)'], ['sent', 'Waiting for signature', 'var(--brand-2)'], ['pendingApproval', 'Awaiting approval', 'var(--accent)'],
  ['draft', 'Draft', 'var(--ink-faint)'], ['declined', 'Declined', 'var(--bad)'], ['voided', 'Voided', 'var(--danger)'],
];

function avgText(h?: number | null) {
  if (h == null) return '—';
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 24) return h.toFixed(1) + ' h';
  return (h / 24).toFixed(1) + ' d';
}

export function ReportsPage() {
  const ui = useUi();
  const { data, error, loading, reload } = useLoad(() => api.reports(), []);
  const exportCsv = async () => { try { saveBlob(await api.exportCsv(), 'mgt-sign-report.csv'); } catch (e) { ui.toast(errMsg(e)); } };
  if (!data) return <div className="wrap"><PageHead eb="Insights" title="Reports" />{error ? <ErrorNote error={error} onRetry={reload} /> : loading && <Loading />}</div>;

  const by = (s: string) => data.byStatus[s] || 0;
  const max = Math.max(1, ...STATUS_ROWS.map(r => by(r[0])));
  const wfRows = Object.entries(data.byWorkflowType).sort((a, b) => WF_ORDER.indexOf(a[0] as WorkflowType) - WF_ORDER.indexOf(b[0] as WorkflowType));
  const wfMax = Math.max(1, ...wfRows.map(r => r[1]));

  return (
    <div className="wrap">
      <PageHead eb="Insights" title="Reports" desc="Envelope volume, completion time, approval workflows and recent audit events." />
      <div className="kpis">
        <div className="kpi"><small>Total envelopes</small><b>{data.total}</b></div>
        <div className="kpi"><small>Completed</small><b>{by('completed')}</b></div>
        <div className="kpi"><small>In progress</small><b>{by('sent') + by('pendingApproval')}</b></div>
        <div className="kpi"><small>Avg. time to complete</small><b>{avgText(data.avgHoursToComplete)}</b></div>
      </div>
      <div className="grid-home">
        <div className="card"><h3>Envelopes by status</h3>
          {STATUS_ROWS.map(([k, label, col]) => <div className="bar-row" key={k}><span>{label}</span><div className="b"><i style={{ width: by(k) / max * 100 + '%', background: col }} /></div><b>{by(k)}</b></div>)}
        </div>
        <div>
          <div className="card"><h3>By approval workflow</h3>
            {wfRows.length ? wfRows.map(([k, n]) => <div className="bar-row" key={k}><span>{wfName(k as WorkflowType)}</span><div className="b"><i style={{ width: n / wfMax * 100 + '%', background: 'var(--mgt-blue)' }} /></div><b>{n}</b></div>)
              : <p className="hint" style={{ margin: 0 }}>No envelopes with an approval workflow yet.</p>}
          </div>
          <div className="card mt"><h3>Export</h3><p className="hint">Download every envelope with its recipients and status as CSV.</p>
            <button className="btn primary" onClick={exportCsv}><Icon name="down" size={16} /> Export CSV</button></div>
        </div>
      </div>
      <div className="card mt"><h3>Recent audit events</h3>
        {data.recentEvents.length ? <div className="tl">{data.recentEvents.map(a => (
          <div className="ev" key={a.id}><b>{a.action}</b>{a.detail && <span className="hint"> · {a.detail.length > 120 ? a.detail.slice(0, 120) + '…' : a.detail}</span>}<div>{fmt(a.at)} · {a.actor}</div></div>
        ))}</div> : <div className="empty">No events yet.</div>}
      </div>
    </div>
  );
}
