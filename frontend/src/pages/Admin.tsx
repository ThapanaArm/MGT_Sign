import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AdminUserDto, AdminUserInput, ContactDto, OutboxDto, SettingsDto, SignatureDto, UserRole, WorkflowType } from '../api/types';
import { AdoptSignature } from '../components/AdoptSignature';
import { useAuth } from '../components/auth';
import { Modal } from '../components/Modal';
import { ErrorNote, Loading, PageHead, useUi } from '../components/ui';
import { Icon } from '../lib/icons';
import { emailOk, errMsg, fmt } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { wfTypeList } from '../lib/workflow';

type Tab = 'profile' | 'settings' | 'users' | 'directory' | 'outbox';
const TAB_LABEL: Record<Tab, string> = { profile: 'Profile', settings: 'Workflow settings', users: 'Users', directory: 'Directory', outbox: 'Outbox' };

export function AdminPage() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const isAdmin = user?.role === 'admin';
  const tabs: Tab[] = isAdmin ? ['profile', 'settings', 'users', 'directory', 'outbox'] : ['profile', 'directory'];
  const t = sp.get('tab') as Tab;
  const tab: Tab = tabs.includes(t) ? t : 'profile';
  return (
    <div className="wrap">
      <PageHead eb="Administration" title={isAdmin ? 'Admin' : 'Profile & directory'} desc={isAdmin ? 'Your profile and signature, approval workflow defaults, users, the recipient directory and the email outbox.' : 'Your profile, signature and the recipient directory.'} />
      <div className="tabs" style={{ marginTop: 0 }}>
        {tabs.map(k => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setSp({ tab: k }, { replace: true })}>{TAB_LABEL[k]}</button>)}
      </div>
      {tab === 'profile' && <ProfileTab />}
      {tab === 'settings' && isAdmin && <SettingsTab />}
      {tab === 'users' && isAdmin && <UsersTab />}
      {tab === 'directory' && <DirectoryTab />}
      {tab === 'outbox' && isAdmin && <OutboxTab />}
    </div>
  );
}

/* ---------- profile ---------- */
function ProfileTab() {
  const { user, setUser } = useAuth();
  const ui = useUi();
  const [name, setName] = useState(user?.name || '');
  const [title, setTitle] = useState(user?.title || '');
  const [company, setCompany] = useState(user?.company || '');
  const [busy, setBusy] = useState(false);
  const sig = useLoad(() => api.getSignature(), []);
  const [adopt, setAdopt] = useState(false);
  const [pw, setPw] = useState({ cur: '', next: '', again: '' });

  const save = async () => {
    if (!name.trim()) { ui.toast('Enter your name.'); return; }
    setBusy(true);
    try { setUser(await api.updateMe({ name: name.trim(), title: title.trim() || null, company: company.trim() || null })); ui.toast('Profile saved.'); }
    catch (e) { ui.toast(errMsg(e)); } finally { setBusy(false); }
  };
  const changePw = async () => {
    if (!pw.cur || !pw.next) { ui.toast('Enter your current and new password.'); return; }
    if (pw.next.length < 8) { ui.toast('Use at least 8 characters for the new password.'); return; }
    if (pw.next !== pw.again) { ui.toast('The new passwords do not match.'); return; }
    try { await api.changePassword({ currentPassword: pw.cur, newPassword: pw.next }); setPw({ cur: '', next: '', again: '' }); ui.toast('Password changed.'); }
    catch (e) { ui.toast(errMsg(e)); }
  };
  const saveSig = async (s: SignatureDto) => {
    try { await api.saveSignature(s); sig.setData(s); if (user) setUser({ ...user, hasSignature: true }); ui.toast('Signature saved.'); setAdopt(false); }
    catch (e) { ui.toast(errMsg(e)); }
  };
  const s = sig.data;

  return (
    <div className="grid-home" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))' }}>
      <div className="card"><h3>My profile</h3>
        <div className="form-grid">
          <div><label className="l">Full name</label><input className="inp" value={name} onChange={e => setName(e.target.value)} /></div>
          <div><label className="l">Email</label><input className="inp" value={user?.email || ''} disabled /></div>
          <div><label className="l">Company</label><input className="inp" value={company} onChange={e => setCompany(e.target.value)} /></div>
          <div><label className="l">Title</label><input className="inp" value={title} onChange={e => setTitle(e.target.value)} /></div>
        </div>
        <label className="l">My signature &amp; initials</label>
        {sig.loading && !s ? <Loading /> : <div className="sigrow">
          <div className="sigbox">{s?.signatureImage ? <img src={s.signatureImage} alt="Signature" /> : 'Not adopted yet'}</div>
          <div className="sigbox">{s?.initialImage ? <img src={s.initialImage} alt="Initials" /> : '—'}</div>
        </div>}
        <div className="mfoot">
          <button className="btn" onClick={() => setAdopt(true)}>{s?.signatureImage ? 'Change signature' : 'Adopt signature'}</button>
          <button className="btn primary" disabled={busy} onClick={save}>Save profile</button>
        </div>
      </div>
      <div className="card"><h3>Change password</h3>
        <label className="l">Current password</label><input className="inp" type="password" autoComplete="current-password" value={pw.cur} onChange={e => setPw({ ...pw, cur: e.target.value })} />
        <label className="l">New password</label><input className="inp" type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} />
        <label className="l">Confirm new password</label><input className="inp" type="password" autoComplete="new-password" value={pw.again} onChange={e => setPw({ ...pw, again: e.target.value })} />
        <div className="mfoot"><button className="btn primary" onClick={changePw}>Change password</button></div>
      </div>
      {adopt && user && <AdoptSignature name={user.name} email={user.email} adoptLabel="Adopt" onClose={() => setAdopt(false)}
        onAdopt={a => void saveSig({ signatureImage: a.signatureImage, initialImage: a.initialImage })} />}
    </div>
  );
}

/* ---------- workflow settings ---------- */
function SettingsTab() {
  const ui = useUi();
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.settings(), api.workflowTypes().catch(() => null)]), []);
  const [f, setF] = useState<SettingsDto | null>(null);
  useEffect(() => { if (data) setF(data[0]); }, [data]);
  const types = useMemo(() => wfTypeList(data?.[1]), [data]);
  if (!f) return error ? <ErrorNote error={error} onRetry={reload} /> : loading ? <Loading /> : null;
  const save = async () => {
    if (f.requireApproval && !emailOk((f.defaultApproverEmail || '').trim())) { ui.toast('Enter a valid approver email.'); return; }
    try {
      setF(await api.saveSettings({ ...f, expiryDays: f.expiryDays || 30, reminderDays: f.reminderDays || 0, defaultApproverName: f.defaultApproverName?.trim() || null, defaultApproverEmail: f.defaultApproverEmail?.trim() || null }));
      ui.toast('Settings saved.');
    } catch (e) { ui.toast(errMsg(e)); }
  };
  return (
    <div className="card" style={{ maxWidth: 760 }}><h3>Workflow settings</h3>
      <div className="form-grid">
        <div><label className="l">Default expiry (days)</label><input className="inp" type="number" min={1} max={365} value={f.expiryDays} onChange={e => setF({ ...f, expiryDays: Number(e.target.value) })} /></div>
        <div><label className="l">Reminder every (days)</label><input className="inp" type="number" min={0} value={f.reminderDays} onChange={e => setF({ ...f, reminderDays: Number(e.target.value) })} /></div>
      </div>
      <label className="chk" style={{ marginTop: 18 }}><input type="checkbox" checked={f.requireApproval} onChange={e => setF({ ...f, requireApproval: e.target.checked })} /> Require approval before documents go out for signature</label>
      <label className="l">Default workflow type</label>
      <select className="inp" value={f.defaultWorkflowType} onChange={e => setF({ ...f, defaultWorkflowType: e.target.value as WorkflowType })}>
        {types.map((t, i) => <option key={t.type} value={t.type}>{i + 1}. {t.en} — {t.th}</option>)}
      </select>
      <div className="form-grid">
        <div><label className="l">Default first approver name</label><input className="inp" value={f.defaultApproverName || ''} onChange={e => setF({ ...f, defaultApproverName: e.target.value })} /></div>
        <div><label className="l">Default first approver email</label><input className="inp" type="email" value={f.defaultApproverEmail || ''} onChange={e => setF({ ...f, defaultApproverEmail: e.target.value })} /></div>
      </div>
      <p className="hint">When on, every new request starts with this workflow and approver already filled in. Senders can still change the steps per envelope. Signers receive the document only after the workflow is approved.</p>
      <div className="mfoot"><button className="btn primary" onClick={save}>Save settings</button></div>
    </div>
  );
}

/* ---------- users ---------- */
function UsersTab() {
  const { data, error, loading, reload } = useLoad(() => api.users(), []);
  const [edit, setEdit] = useState<AdminUserDto | 'new' | null>(null);
  return <>
    <div className="btn-row" style={{ marginBottom: 14 }}><button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" size={16} /> Add user</button></div>
    {error && <ErrorNote error={error} onRetry={reload} />}
    <div className="tbl-wrap"><table className="t"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
      {!data && loading ? <tr><td colSpan={5}><Loading /></td></tr> : (data || []).map(u => (
        <tr key={u.id}>
          <td><b>{u.name}</b><div className="to">{u.email}{u.title ? ' · ' + u.title : ''}{u.company ? ' · ' + u.company : ''}</div></td>
          <td><span className={'pill ' + (u.role === 'admin' ? 'sent' : '')}>{u.role === 'admin' ? 'Admin' : 'User'}</span></td>
          <td><span className={'pill ' + (u.isActive ? 'completed' : 'voided')}>{u.isActive ? 'Active' : 'Disabled'}</span></td>
          <td style={{ whiteSpace: 'nowrap' }}>{fmt(u.createdAt)}</td>
          <td style={{ textAlign: 'right' }}><button className="btn sm" onClick={() => setEdit(u)}><Icon name="edit" size={14} /> Edit</button></td>
        </tr>
      ))}
    </tbody></table></div>
    {edit && <UserModal u={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
  </>;
}

function UserModal({ u, onClose, onSaved }: { u: AdminUserDto | null; onClose: () => void; onSaved: () => void }) {
  const ui = useUi();
  const [f, setF] = useState<AdminUserInput>({ email: u?.email || '', name: u?.name || '', title: u?.title || '', company: u?.company || '', role: u?.role || 'user', isActive: u?.isActive ?? true, password: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim() || !emailOk(f.email.trim())) { ui.toast('Enter a name and a valid email.'); return; }
    if (!u && !(f.password || '').trim()) { ui.toast('Set an initial password.'); return; }
    if (f.password && f.password.length < 8) { ui.toast('Use at least 8 characters for the password.'); return; }
    const body: AdminUserInput = { ...f, email: f.email.trim(), name: f.name.trim(), title: f.title?.trim() || null, company: f.company?.trim() || null, password: f.password || null };
    setBusy(true);
    try { if (u) await api.updateUser(u.id, body); else await api.createUser(body); ui.toast(u ? 'User saved.' : 'User created.'); onSaved(); }
    catch (e) { ui.toast(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} size="sm" title={u ? 'Edit user' : 'Add user'}>
      <div className="form-grid">
        <div><label className="l">Full name <span className="req">*</span></label><input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="l">Email <span className="req">*</span></label><input className="inp" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="l">Title</label><input className="inp" value={f.title || ''} onChange={e => setF({ ...f, title: e.target.value })} /></div>
        <div><label className="l">Company</label><input className="inp" value={f.company || ''} onChange={e => setF({ ...f, company: e.target.value })} /></div>
        <div><label className="l">Role</label><select className="inp" value={f.role} onChange={e => setF({ ...f, role: e.target.value as UserRole })}><option value="user">User</option><option value="admin">Admin</option></select></div>
        <div><label className="l">{u ? 'New password' : 'Password'} {!u && <span className="req">*</span>}</label><input className="inp" type="password" autoComplete="new-password" placeholder={u ? 'Leave blank to keep' : ''} value={f.password || ''} onChange={e => setF({ ...f, password: e.target.value })} /></div>
      </div>
      <label className="chk" style={{ marginTop: 16 }}><input type="checkbox" checked={f.isActive} onChange={e => setF({ ...f, isActive: e.target.checked })} /> Active (can sign in)</label>
      <div className="mfoot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></div>
    </Modal>
  );
}

/* ---------- directory ---------- */
function DirectoryTab() {
  const ui = useUi();
  const { data, error, loading, reload } = useLoad(() => api.contacts(), []);
  const [n, setN] = useState({ name: '', email: '', department: '' });
  const [edit, setEdit] = useState<ContactDto | null>(null);
  const add = async () => {
    if (!n.name.trim() || !emailOk(n.email.trim())) { ui.toast('Enter a name and valid email.'); return; }
    try { await api.addContact({ name: n.name.trim(), email: n.email.trim(), department: n.department.trim() || null }); setN({ name: '', email: '', department: '' }); reload(); }
    catch (e) { ui.toast(errMsg(e)); }
  };
  const del = async (c: ContactDto) => {
    if (await ui.confirm({ title: 'Remove contact?', text: `${c.name} <${c.email}> will be removed from the directory.`, okLabel: 'Remove' }) === null) return;
    try { await api.deleteContact(c.id); reload(); } catch (e) { ui.toast(errMsg(e)); }
  };
  return <>
    <div className="card"><h3>Directory <span className="sub">Used for recipient and approver suggestions</span></h3>
      {error && <ErrorNote error={error} onRetry={reload} />}
      <div className="tbl-wrap"><table className="t"><thead><tr><th>Name</th><th>Email</th><th>Department</th><th></th></tr></thead><tbody>
        {!data && loading ? <tr><td colSpan={4}><Loading /></td></tr> : (data || []).length ? data!.map(c => (
          <tr key={c.id}><td>{c.name}</td><td>{c.email}</td><td>{c.department || '—'}</td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <button className="icon-btn" title="Edit" aria-label={'Edit ' + c.name} onClick={() => setEdit(c)} style={{ display: 'inline-grid' }}><Icon name="edit" /></button>
              <button className="icon-btn" title="Remove" aria-label={'Remove ' + c.name} onClick={() => del(c)} style={{ display: 'inline-grid' }}><Icon name="trash" /></button></td></tr>
        )) : <tr><td colSpan={4} className="hint">No contacts yet.</td></tr>}
        <tr>
          <td><input className="inp" placeholder="Name" value={n.name} onChange={e => setN({ ...n, name: e.target.value })} /></td>
          <td><input className="inp" placeholder="Email" type="email" value={n.email} onChange={e => setN({ ...n, email: e.target.value })} /></td>
          <td><input className="inp" placeholder="Department" value={n.department} onChange={e => setN({ ...n, department: e.target.value })} /></td>
          <td><button className="btn" onClick={add}>Add</button></td>
        </tr>
      </tbody></table></div>
    </div>
    {edit && <ContactModal c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
  </>;
}

function ContactModal({ c, onClose, onSaved }: { c: ContactDto; onClose: () => void; onSaved: () => void }) {
  const ui = useUi();
  const [f, setF] = useState({ name: c.name, email: c.email, department: c.department || '' });
  const save = async () => {
    if (!f.name.trim() || !emailOk(f.email.trim())) { ui.toast('Enter a name and valid email.'); return; }
    try { await api.updateContact(c.id, { name: f.name.trim(), email: f.email.trim(), department: f.department.trim() || null }); ui.toast('Contact saved.'); onSaved(); }
    catch (e) { ui.toast(errMsg(e)); }
  };
  return (
    <Modal onClose={onClose} size="sm" title="Edit contact">
      <label className="l">Name</label><input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
      <label className="l">Email</label><input className="inp" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <label className="l">Department</label><input className="inp" value={f.department} onChange={e => setF({ ...f, department: e.target.value })} />
      <div className="mfoot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </Modal>
  );
}

/* ---------- outbox ---------- */
function OutboxTab() {
  const ui = useUi();
  const { data, error, loading, reload } = useLoad(() => api.outbox(100), []);
  const [selId, setSelId] = useState<number | null>(null);
  const sel: OutboxDto | null = data?.find(m => m.id === selId) || data?.[0] || null;
  const runEsc = async () => {
    try { const r = await api.runEscalations(); ui.toast(`Escalation check done: ${r.escalated} step${r.escalated === 1 ? '' : 's'} escalated.`); reload(); }
    catch (e) { ui.toast(errMsg(e)); }
  };
  // Links open in a new tab; the sandbox allows that and nothing else.
  const srcDoc = sel ? '<base target="_blank">' + sel.bodyHtml : '';
  return <>
    <div className="note"><Icon name="info" size={16} /><span>No SMTP server is configured, so notification emails are queued here. Open one and click its link to act as that recipient (sign or approve).</span></div>
    <div className="btn-row" style={{ marginBottom: 14 }}>
      <button className="btn" onClick={reload}><Icon name="hist" size={16} /> Refresh</button>
      <button className="btn" onClick={runEsc}><Icon name="clock" size={16} /> Run escalations now</button>
    </div>
    {error && <ErrorNote error={error} onRetry={reload} />}
    {!data && loading ? <Loading /> : data && !data.length ? <div className="card"><div className="empty"><div className="eic"><Icon name="mail" size={22} /></div><b>No emails yet</b>Emails appear here when envelopes are sent, approved, reminded or completed.</div></div> : data && (
      <div className="outbox">
        <div className="list">
          {data.map(m => (
            <button key={m.id} className={'obi ' + (sel?.id === m.id ? 'on' : '')} onClick={() => setSelId(m.id)}>
              <b>{m.subject}</b>
              <small>To: {m.to}</small><br />
              <small>{fmt(m.createdAt)}{m.sentAt ? ' · sent ' + fmt(m.sentAt) : ' · queued'}{m.error ? ' · error: ' + m.error : ''}</small>
            </button>
          ))}
        </div>
        {sel && <div>
          <dl className="kv" style={{ marginBottom: 12 }}><dt>To</dt><dd>{sel.to}</dd><dt>Subject</dt><dd style={{ wordBreak: 'normal' }}>{sel.subject}</dd><dt>Created</dt><dd>{fmt(sel.createdAt)}</dd></dl>
          <iframe title={'Email: ' + sel.subject} srcDoc={srcDoc} sandbox="allow-popups allow-popups-to-escape-sandbox" />
        </div>}
      </div>
    )}
  </>;
}
