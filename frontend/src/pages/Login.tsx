import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../components/auth';
import { Brand } from '../components/common';
import { ErrorNote } from '../components/ui';
import { errMsg } from '../lib/format';

export function LoginPage() {
  const { user, setSession } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={target} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.login({ email: email.trim(), password });
      setSession(r.token, r.user);
      nav(target, { replace: true });
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <Brand />
        <h1>Sign in</h1>
        <p className="hint" style={{ marginTop: 0 }}>MGT Electronic Signature Management System</p>
        {error && <ErrorNote error={error} />}
        <label className="l" htmlFor="em">Username or email</label>
        <input id="em" className="inp" type="text" autoComplete="username" placeholder="Company username (e.g. MGT000123) or email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
        <label className="l" htmlFor="pw">Password</label>
        <input id="pw" className="inp" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 22 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
