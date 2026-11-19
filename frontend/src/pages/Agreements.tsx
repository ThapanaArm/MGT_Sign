import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, saveBlob } from '../api/client';
import type { EnvelopeStatus, Folder } from '../api/types';
import { useCounts } from '../components/AppShell';
import { Progress, StatusPill } from '../components/common';
import { isActive, isVoidable, useEnvelopeActions } from '../components/envelopeActions';
import { ErrorNote, Loading, PageHead, useUi } from '../components/ui';
import { Icon } from '../lib/icons';
import { errMsg, fmt, FOLDERS, FOLDER_TITLE, STATUS_LABEL } from '../lib/format';
import { useLoad } from '../lib/useLoad';

type Sender = 'all' | 'me' | 'received';
const STATUSES: EnvelopeStatus[] = ['draft', 'pendingApproval', 'sent', 'completed', 'declined', 'voided'];

export function AgreementsPage() {
  const { folder: f } = useParams();
  const folder: Folder = FOLDERS.includes(f as Folder) ? f as Folder : 'all';
  const nav = useNavigate();
  const ui = useUi();
  const { refresh } = useCounts();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [days, setDays] = useState('180');
  const [sender, setSender] = useState<Sender>('all');
  const [status, setStatus] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => { const t = window.setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 300); return () => window.clearTimeout(t); }, [qInput]);
  useEffect(() => { setPage(1); setPicked(new Set()); }, [folder]);

  const { data, error, loading, reload } = useLoad(
    () => api.envelopes({ folder, q, status, sender, days, page, pageSize }),
    [folder, q, status, sender, days, page, pageSize],
  );
  const after = () => { reload(); refresh(); setPicked(new Set()); };
  const acts = useEnvelopeActions(after);

  const rows = data?.items || [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const sel = rows.filter(r => picked.has(r.id));
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id));
  const toggle = (id: string, on: boolean) => setPicked(p => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });

  const clearAll = () => { setQInput(''); setQ(''); setStatus(''); setDays('180'); setSender('all'); setPage(1); };
  const exportCsv = async () => { try { saveBlob(await api.exportCsv(), 'mgt-sign-report.csv'); } catch (e) { ui.toast(errMsg(e)); } };

  const bulk = async (label: string, fn: (id: string) => Promise<unknown>, ids: string[]) => {
    let ok = 0; const errs: string[] = [];
    for (const id of ids) { try { await fn(id); ok++; } catch (e) { errs.push(errMsg(e)); } }
    ui.toast(errs.length ? `${label}: ${ok} done, ${errs.length} failed — ${errs[0]}` : `${label}: ${ok} envelope${ok === 1 ? '' : 's'}.`);
    after();
  };
  const bulkVoid = async () => {
    const v = sel.filter(e => isVoidable(e.status));
    if (!v.length) { ui.toast('Only drafts and in-progress envelopes can be voided.'); return; }
    const reason = await ui.confirm({ title: `Void ${v.length} envelope(s)?`, text: 'Recipients will no longer be able to view or sign them. This cannot be undone.', okLabel: 'Void', withReason: true });
    if (reason !== null) await bulk('Voided', id => api.voidEnvelope(id, { reason }), v.map(e => e.id));
  };
  const bulkDelete = async () => {
    if (await ui.confirm({ title: `Delete ${sel.length} agreement(s)?`, text: 'They move to the Deleted folder. You can restore them from there.', okLabel: 'Delete' }) !== null)
      await bulk('Deleted', id => api.deleteEnvelope(id), sel.map(e => e.id));
  };
  const bulkPurge = async () => {
    if (await ui.confirm({ title: `Delete ${sel.length} agreement(s) permanently?`, text: 'This removes the documents, attachments and audit trails. This cannot be undone.', okLabel: 'Delete permanently' }) !== null)
      await bulk('Deleted permanently', id => api.purgeEnvelope(id), sel.map(e => e.id));
  };
  const bulkDownload = async () => { for (const e of sel) await acts.download(e.id); };

  return (
    <section className="main">
      <PageHead eb="Agreements" title={FOLDER_TITLE[folder]}
        desc={`${total} envelope${total === 1 ? '' : 's'} · track signing progress, approvals and audit history.`}
        actions={<>
          <button className="btn" onClick={exportCsv}><Icon name="down" size={16} /> Export CSV</button>
          <button className="btn primary" onClick={() => nav('/send')}><Icon name="send" size={16} /> Request signatures</button>
        </>} />
      <div className="filters">
        <div className="search"><Icon name="search" /><input placeholder="Search envelopes" value={qInput} onChange={e => setQInput(e.target.value)} aria-label="Search envelopes" /></div>
        <span className="chipf"><select value={days} onChange={e => { setDays(e.target.value); setPage(1); }} aria-label="Date">
          <option value="30">Date: Last 30 days</option><option value="180">Date: Last 6 Months</option><option value="365">Date: Last 12 months</option><option value="all">Date: All time</option>
        </select></span>
        <span className="chipf"><select value={sender} onChange={e => { setSender(e.target.value as Sender); setPage(1); }} aria-label="Sender">
          <option value="all">Sender: All</option><option value="me">Sender: Sent by me</option><option value="received">Sender: Received</option>
        </select></span>
        <select className="f" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">Status</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button className="btn ghost" onClick={clearAll}>Clear All</button>
      </div>
      {sel.length > 0 && (
        <div className="bulk"><b>{sel.length} selected</b>
          <button className="btn sm" onClick={bulkDownload}><Icon name="down" size={15} /> Download</button>
          {folder === 'deleted'
            ? <><button className="btn sm" onClick={() => bulk('Restored', id => api.restoreEnvelope(id), sel.map(e => e.id))}>Restore</button>
              <button className="btn sm" onClick={bulkPurge}><Icon name="trash" size={15} /> Delete permanently</button></>
            : <><button className="btn sm" onClick={bulkVoid}><Icon name="ban" size={15} /> Void</button>
              <button className="btn sm" onClick={bulkDelete}><Icon name="trash" size={15} /> Delete</button></>}
          <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setPicked(new Set())}>Clear selection</button>
        </div>
      )}
      {error && <ErrorNote error={error} onRetry={reload} />}
      <div className="tbl-wrap"><table className="t">
        <thead><tr>
          <th className="cbx"><input type="checkbox" aria-label="Select all" checked={allPicked} onChange={e => rows.forEach(r => toggle(r.id, e.target.checked))} /></th>
          <th>Name</th><th>Status</th><th>Last Change</th><th></th>
        </tr></thead>
        <tbody>
          {!data && loading ? <tr><td colSpan={5}><Loading /></td></tr>
            : rows.length ? rows.map(e => {
              const p = acts.primary(e);
              const ts = fmt(e.updatedAt), sp = ts.indexOf(' ');
              const d = sp > 0 ? ts.slice(0, sp) : ts, t = sp > 0 ? ts.slice(sp + 1) : '';
              return (
                <tr key={e.id}>
                  <td className="cbx"><input type="checkbox" aria-label={'Select ' + e.subject} checked={picked.has(e.id)} onChange={ev => toggle(e.id, ev.target.checked)} /></td>
                  <td>
                    <div className="nm" onClick={() => nav('/envelopes/' + e.id)}>{e.subject}
                      {e.attachmentCount > 0 && <> <span className="att-cnt" title={`${e.attachmentCount} attachment(s)`}><Icon name="clip" size={13} />{e.attachmentCount}</span></>}
                    </div>
                    <div className="to">To: {e.recipientNames.length ? e.recipientNames.join(', ') : '—'} · {e.code}</div>
                  </td>
                  <td>
                    {isActive(e.status) && <Progress done={e.done} total={e.total} />}
                    <span className="st">{e.status === 'completed' && <span style={{ color: 'var(--ok)' }}><Icon name="check" /></span>}
                      <StatusPill status={e.status} label={e.statusLabel} myTurn={e.myTurn} /></span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d}<br />{t}</td>
                  <td><div className="row-act">
                    <button className={'btn ' + p.cls} onClick={p.run}>{p.label}</button>
                    <button className="icon-btn" aria-label="More actions" onClick={ev => ui.menu(ev.currentTarget, acts.menuItems(e))}><Icon name="dots" size={20} /></button>
                  </div></td>
                </tr>
              );
            }) : <tr><td colSpan={5}><div className="empty"><b>No agreements found</b>Try a different folder or filter, or start a new one.</div></td></tr>}
        </tbody>
      </table></div>
      <div className="pager">
        <select className="f" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Page size">
          {[25, 50, 100].map(n => <option key={n} value={n}>{n} / Page</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <b style={{ fontSize: 14 }}>Page {page} of {pages}</b>
          <button className="icon-btn" disabled={page <= 1} style={{ transform: 'rotate(180deg)' }} onClick={() => setPage(p => p - 1)} aria-label="Previous page"><Icon name="chevr" /></button>
          <button className="icon-btn" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label="Next page"><Icon name="chevr" /></button>
        </div>
      </div>
    </section>
  );
}
