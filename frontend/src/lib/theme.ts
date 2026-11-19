const KEY = 'mgtsign.theme';
export type ThemePref = 'light' | 'dark' | '';

export function getThemePref(): ThemePref {
  try { const t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : ''; } catch { return ''; }
}
export function applyTheme(t: ThemePref = getThemePref()) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
export function setThemePref(t: ThemePref) {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  applyTheme(t);
}
export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
