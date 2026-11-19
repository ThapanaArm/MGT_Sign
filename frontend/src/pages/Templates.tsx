import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ErrorNote, Loading, PageHead, useUi } from '../components/ui';
import { Icon } from '../lib/icons';
import { errMsg, fmt } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { wfName } from '../lib/workflow';

export function TemplatesPage() {
  const nav = useNavigate();
  const ui = useUi();
  const { data, error, loading, reload } = useLoad(() => api.templates(), []);
  const del = async (id: string, name: string) => {
    if (await ui.confirm({ title: 'Delete template?', text: `“${name}” will be removed. Envelopes already sent are not affected.`, okLabel: 'Delete' }) === null) return;
    try { await api.deleteTemplate(id); ui.toast('Template deleted.'); reload(); } catch (e) { ui.toast(errMsg(e)); }
  };
  return (
    <div className="wrap">
      <PageHead eb="Library" title="Templates" desc="Reuse documents, recipient roles, signing order, approval workflows and field placements."
        actions={<button className="btn primary" onClick={() => { ui.toast('Set up the document, recipients and fields — then use “Save as template” from the Agreements menu.'); nav('/send'); }}><Icon name="plus" size={16} /> New template</button>} />
      {error && <ErrorNote error={error} onRetry={reload} />}
      <div className="tbl-wrap"><table className="t"><thead><tr><th>Name</th><th>Recipients</th><th>Fields</th><th>Workflow</th><th>Created</th><th></th></tr></thead><tbody>
        {!data && loading ? <tr><td colSpan={6}><Loading /></td></tr>
          : data && data.length ? data.map(t => (
            <tr key={t.id}>
              <td><b>{t.name}</b><div className="to">{t.documentName} · {t.pageCount} page(s)</div>{t.subject && <div className="to">{t.subject}</div>}</td>
              <td>{t.recipientCount}</td>
              <td>{t.fieldCount}</td>
              <td>{t.workflowType ? <span className="pill pending_approval">{wfName(t.workflowType)}</span> : <span className="hint">—</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmt(t.createdAt)}</td>
              <td><div className="row-act">
                <button className="btn primary" onClick={() => nav('/send?template=' + encodeURIComponent(t.id))}>Use</button>
                <button className="icon-btn" title="Delete" aria-label={'Delete ' + t.name} onClick={() => del(t.id, t.name)}><Icon name="trash" /></button>
              </div></td>
            </tr>
          )) : <tr><td colSpan={6}><div className="empty"><b>No templates yet</b>Send a document, then choose “Save as template” from its menu in Agreements — or create one with New template.</div></td></tr>}
      </tbody></table></div>
    </div>
  );
}
