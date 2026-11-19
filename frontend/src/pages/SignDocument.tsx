import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../components/auth';
import { UploadArea, type PdfItem } from '../components/UploadArea';
import { PageHead, useUi } from '../components/ui';
import { errMsg } from '../lib/format';

/** Quick self-sign: one PDF, the user is the only signer, then the editor in self mode. */
export function SignDocumentPage() {
  const nav = useNavigate();
  const ui = useUi();
  const { user } = useAuth();
  const [files, setFiles] = useState<PdfItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [expiryDays, setExpiryDays] = useState(30);
  useEffect(() => { api.settings().then(s => setExpiryDays(s.expiryDays || 30)).catch(() => { }); }, []);

  const go = async () => {
    if (!files.length || !user) return;
    setBusy(true);
    try {
      const env = await api.createEnvelope({
        type: 'self', subject: ('Complete with MGT Sign: ' + files[0].file.name).slice(0, 100), message: null, signingOrder: false,
        expiryDays, reminderDays: 0, recipients: [{ name: user.name, email: user.email, role: 'signer', routingOrder: 1 }], workflow: null,
      }, [files[0].file]);
      nav(`/envelopes/${env.id}/prepare`);
    } catch (e) { ui.toast(errMsg(e)); setBusy(false); }
  };

  return (
    <div className="sendpage" style={{ paddingBottom: 24 }}>
      <PageHead eb="Start" title="Sign a document" desc="Upload a PDF, place your signature and other fields, then finish signing." />
      <div className="card">
        <UploadArea files={files} onChange={setFiles} single />
        <div className="mfoot">
          <span className="hint left">You are the only signer. To collect other signatures, use Request signatures.</span>
          <button className="btn ghost" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn blue" disabled={!files.length || busy} onClick={go}>{busy ? 'Uploading…' : 'Sign'}</button>
        </div>
      </div>
    </div>
  );
}
