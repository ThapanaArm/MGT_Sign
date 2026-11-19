import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type MouseEvent } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Folder } from '../api/types';
import { Icon, type IconName } from '../lib/icons';
import { FOLDERS, FOLDER_ICON, FOLDER_TITLE, initials } from '../lib/format';
import { isDark, setThemePref } from '../lib/theme';
import { useAuth } from './auth';
import { useUi } from './ui';

/* Folder counts + task count shown in the sidebar; pages call refresh() after changing envelopes. */
interface CountsApi { counts: Partial<Record<Folder, number>>; tasks: number; refresh: () => void }
const CountsCtx = createContext<CountsApi>({ counts: {}, tasks: 0, refresh: () => { } });
export const useCounts = () => useContext(CountsCtx);

const PAGE_TITLE: Record<string, string> = {
  '': 'Home', send: 'Request signatures', 'sign-document': 'Sign a document', templates: 'Templates', reports: 'Reports', admin: 'Admin', envelopes: 'Envelope details',
};

export function AppShell() {
  const { user, logout } = useAuth();
  const ui = useUi();
  const nav = useNavigate();
  const loc = useLocation();
  const [counts, setCounts] = useState<Partial<Record<Folder, number>>>({});
  const [tasks, setTasks] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [dark, setDark] = useState(isDark());

  const refresh = useCallback(() => {
    api.envelopes({ folder: 'all', page: 1, pageSize: 1 }).then(r => setCounts(r.folderCounts || {})).catch(() => { });
    api.dashboard().then(d => setTasks(d.waitingForMe)).catch(() => { });
  }, []);
  useEffect(() => { refresh(); }, [loc.pathname, refresh]);
  useEffect(() => { setNavOpen(false); }, [loc.pathname, loc.search]);
  useEffect(() => { document.body.classList.toggle('nav-open', navOpen); return () => document.body.classList.remove('nav-open'); }, [navOpen]);

  const seg = loc.pathname.split('/')[1] || '';
  const folder = (seg === 'agreements' ? (loc.pathname.split('/')[2] || 'all') : null) as Folder | null;
  const go = (p: string) => nav(p);
  const item = (path: string, icon: IconName, label: string, cur: boolean, extra?: ReactNode) => (
    <button className="nav-item" aria-current={cur ? 'page' : undefined} onClick={() => go(path)}>
      <Icon name={icon} /><span className="lab">{label}</span>{extra}
    </button>
  );
  const toggleTheme = () => { const next = isDark() ? 'light' : 'dark'; setThemePref(next); setDark(next === 'dark'); };
  const start = (e: MouseEvent) => ui.menu(e.currentTarget, [
    { label: 'Send an envelope', icon: 'send', run: () => go('/send') },
    { label: 'Sign a document', icon: 'sign', run: () => go('/sign-document') },
    { label: 'Use a template', icon: 'tpl', run: () => go('/templates') },
  ]);

  return (
    <CountsCtx.Provider value={{ counts, tasks, refresh }}>
      <div className="shell">
        <aside className="sidebar" aria-label="Main navigation">
          <div className="brand-head" onClick={() => go('/')} title="MGT Sign home">
            <img className="brand-logo" src="/mgt-logo.png" alt="MGT Group" />
            <div className="brand-app"><b>MGT Sign</b><span>E-SIGNATURE</span></div>
          </div>
          <div className="side-cta"><button className="btn primary" onClick={start}><Icon name="plus" size={16} /> Start</button></div>
          <nav className="side-nav">
            <div><div className="grp-t">Workspace</div><div className="grp-i">
              {item('/', 'pages', 'Home', seg === '', tasks ? <span className="cnt-b hot">{tasks}</span> : null)}
            </div></div>
            <div><div className="grp-t">Agreements</div><div className="grp-i">
              {FOLDERS.map(k => (
                <button key={k} className="nav-item" aria-current={folder === k ? 'page' : undefined} onClick={() => go('/agreements/' + k)}>
                  <Icon name={FOLDER_ICON[k]} /><span className="lab">{FOLDER_TITLE[k]}</span>
                  {counts[k] ? <span className={'cnt-b ' + (k === 'approval' || k === 'progress' ? 'hot' : '')}>{counts[k]}</span> : null}
                </button>
              ))}
            </div></div>
            <div><div className="grp-t">Library</div><div className="grp-i">
              {item('/templates', 'tpl', 'Templates', seg === 'templates')}
              {item('/reports', 'hist', 'Reports', seg === 'reports')}
            </div></div>
            {user?.role === 'admin' && <div><div className="grp-t">Administration</div><div className="grp-i">
              {item('/admin', 'gear', 'Admin', seg === 'admin')}
            </div></div>}
          </nav>
          <div className="side-foot">MGT Electronic Signature Management System</div>
        </aside>
        <div className="scrim" onClick={() => setNavOpen(false)} />
        <main className="content">
          <div className="ctxbar">
            <button className="ctx-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Icon name="menu" /></button>
            <div className="crumbs">
              <button className="crumb-home" onClick={() => go('/')} aria-label="Home"><Icon name="pages" size={15} /></button>
              {folder
                ? <><span className="c-parent">Agreements</span><span className="sep-c">/</span><b>{FOLDER_TITLE[folder] || 'Agreements'}</b></>
                : <b>{PAGE_TITLE[seg] ?? 'MGT Sign'}</b>}
            </div>
            <div className="ctx-tools">
              <button className="ctx-btn" onClick={toggleTheme} title="Switch light / dark" aria-label="Switch light / dark"><Icon name={dark ? 'sun' : 'moon'} size={16} /></button>
              <button className="profile" title="Profile and settings" onClick={e => ui.menu(e.currentTarget, [
                { label: 'Profile & signature', icon: 'user', run: () => go('/admin') },
                { label: 'Sign out', icon: 'logout', run: logout },
              ], user?.email)}>
                <span className="uav">{initials(user?.name)}</span>
                <span className="user-copy"><b>{user?.name}</b><small>{user?.title || user?.email}</small></span>
              </button>
            </div>
          </div>
          <Outlet />
        </main>
      </div>
    </CountsCtx.Provider>
  );
}
