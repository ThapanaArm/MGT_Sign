import type { EnvelopeStatus } from '../api/types';
import { STATUS_CLASS, STATUS_LABEL } from '../lib/format';

/** Envelope status pill. `label` defaults to the server's statusLabel or a local label. */
export function StatusPill({ status, label, myTurn }: { status: EnvelopeStatus; label?: string | null; myTurn?: boolean }) {
  const cls = myTurn && (status === 'sent' || status === 'pendingApproval') ? 'need' : STATUS_CLASS[status];
  return <span className={'pill ' + cls}>{label || STATUS_LABEL[status]}</span>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  return <div className="prog"><i style={{ width: Math.max(4, (done / Math.max(1, total)) * 100) + '%' }} /></div>;
}

/** Brand block used on public pages and login. */
export function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="brand-head" style={compact ? { margin: 0, padding: 0, border: 0, cursor: 'default' } : undefined}>
      <img className="brand-logo" src="/mgt-logo.png" alt="MGT Group" />
      <div className="brand-app"><b>MGT Sign</b><span>E-SIGNATURE</span></div>
    </div>
  );
}
