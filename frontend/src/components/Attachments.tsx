import { useState } from 'react';
import { saveBlob } from '../api/client';
import type { AttachmentDto } from '../api/types';
import { Icon } from '../lib/icons';
import { ATT_MAX, ATT_ROLE, attKind, checkAttachments, errMsg, fmt, fmtSize, pickFiles } from '../lib/format';
import { Modal } from './Modal';
import { useUi } from './ui';

/** Table of attachments with a per-row download button. */
export function AttachmentTable({ list, download }: { list: AttachmentDto[]; download: (a: AttachmentDto) => Promise<Blob> }) {
  const ui = useUi();
  const [busy, setBusy] = useState('');
  if (!list.length) return (
    <div className="empty" style={{ padding: '18px 8px' }}><div className="eic"><Icon name="clip" size={20} /></div><b>No attachments</b>Supporting files added by the sender, approvers or signers appear here.</div>
  );
  const dl = async (a: AttachmentDto) => {
    setBusy(a.id);
    try { saveBlob(await download(a), a.fileName); } catch (e) { ui.toast(errMsg(e)); } finally { setBusy(''); }
  };
  return (
    <div className="tbl-wrap"><table className="t"><thead><tr><th>File</th><th>Added by</th><th>When</th><th></th></tr></thead><tbody>
      {list.map(a => {
        const [k, tone] = attKind(a.fileName);
        return (
          <tr key={a.id}>
            <td><div className="att-f"><span className={'att-k ' + tone}>{k}</span><div style={{ minWidth: 0 }}>
              <b className="att-n" title={a.fileName}>{a.fileName}</b>
              <div className="to">{fmtSize(a.size)} · <span className="mono" title={'SHA-256 ' + a.sha256}>SHA-256 {a.sha256.slice(0, 12)}…</span></div>
            </div></div></td>
            <td><b>{a.addedByName}</b><div className="to">{ATT_ROLE[a.role] || a.role}{a.context ? ' · ' + a.context : ''}</div></td>
            <td className="to" style={{ whiteSpace: 'nowrap' }}>{fmt(a.createdAt)}</td>
            <td style={{ textAlign: 'right' }}><button className="btn sm" disabled={busy === a.id} onClick={() => dl(a)}><Icon name="down" size={14} /> Download</button></td>
          </tr>
        );
      })}
    </tbody></table></div>
  );
}

/** Chips for files staged locally before upload. */
export function StagedFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="att-stage">
      {files.map((f, i) => {
        const [k, tone] = attKind(f.name);
        return (
          <span className="att-chip" key={i + f.name}>
            <span className={'att-k ' + tone}>{k}</span><span className="att-n" title={f.name}>{f.name}</span><small>{fmtSize(f.size)}</small>
            <button onClick={() => onRemove(i)} title="Remove" aria-label={'Remove ' + f.name}>×</button>
          </span>
        );
      })}
    </div>
  );
}

/** Attachments dialog: list everything; optionally upload more. */
export function AttachmentsModal({ list, download, upload, who, onClose }: {
  list: AttachmentDto[]; download: (a: AttachmentDto) => Promise<Blob>;
  upload?: ((files: File[]) => Promise<void>) | null; who?: string; onClose: () => void;
}) {
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const add = () => pickFiles(async fl => {
    const { ok, error } = checkAttachments(fl, list.length);
    if (error) ui.toast(error);
    if (!ok.length || !upload) return;
    setBusy(true);
    try { await upload(ok); ui.toast(`${ok.length} attachment${ok.length > 1 ? 's' : ''} added.`); } catch (e) { ui.toast(errMsg(e)); } finally { setBusy(false); }
  });
  return (
    <Modal onClose={onClose} size="wide" title={<><Icon name="clip" size={22} /> Attachments <span className="pill" style={{ marginLeft: 4 }}>{list.length}</span></>}>
      <p className="hint" style={{ marginTop: -8 }}>Supporting files travel with the envelope but are not signed. Each file is fingerprinted with SHA-256 and recorded in the audit trail.</p>
      <AttachmentTable list={list} download={download} />
      {upload && (
        <div className="mfoot">
          <span className="hint left">{who ? <>Adding as <b>{who}</b> · </> : null}up to {fmtSize(ATT_MAX)} per file</span>
          <button className="btn primary" disabled={busy} onClick={add}><Icon name="plus" size={16} /> {busy ? 'Uploading…' : 'Attach files'}</button>
        </div>
      )}
    </Modal>
  );
}
