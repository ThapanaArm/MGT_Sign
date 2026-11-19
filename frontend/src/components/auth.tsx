import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, auth } from '../api/client';
import type { UserDto } from '../api/types';
import { Loading } from './ui';

interface AuthApi {
  user: UserDto | null;
  ready: boolean;
  setSession: (token: string, user: UserDto) => void;
  setUser: (u: UserDto) => void;
  logout: () => void;
}
const AuthCtx = createContext<AuthApi | null>(null);
export function useAuth() { const c = useContext(AuthCtx); if (!c) throw new Error('AuthProvider missing'); return c; }

const isPublicPath = (p: string) => p.startsWith('/sign/') || p.startsWith('/approve/') || p === '/login';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserDto | null>(null);
  const [ready, setReady] = useState(!auth.token);
  const nav = useNavigate();

  useEffect(() => {
    if (!auth.token) return;
    let off = false;
    api.me().then(u => { if (!off) setUserState(u); }).catch(() => { /* 401 handled by event */ }).finally(() => { if (!off) setReady(true); });
    return () => { off = true; };
  }, []);

  useEffect(() => {
    const onUnauth = () => {
      setUserState(null);
      const p = window.location.pathname;
      if (!isPublicPath(p)) nav('/login?next=' + encodeURIComponent(p + window.location.search), { replace: true });
    };
    window.addEventListener('mgtsign:unauthorized', onUnauth);
    return () => window.removeEventListener('mgtsign:unauthorized', onUnauth);
  }, [nav]);

  const setSession = useCallback((token: string, u: UserDto) => { auth.set(token); setUserState(u); setReady(true); }, []);
  const logout = useCallback(() => { auth.set(null); setUserState(null); nav('/login', { replace: true }); }, [nav]);
  const value = useMemo(() => ({ user, ready, setSession, setUser: setUserState, logout }), [user, ready, setSession, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to={'/login?next=' + encodeURIComponent(loc.pathname + loc.search)} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}
