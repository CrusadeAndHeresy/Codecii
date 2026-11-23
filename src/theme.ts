export type Theme = 'auto' | 'dark' | 'light';
const KEY = 'theme';
export function getTheme(): Theme {
  try { const v = localStorage.getItem(KEY); if (v === 'dark' || v === 'light') return v; } catch { /* storage unavailable */ }
  return 'auto';
}
// Sets data-theme on <html> (auto = follow the phone) and keeps the browser bar colour in step.
export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  const light = t === 'light' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', light ? '#f6f4ef' : '#111317'));
}
export function setTheme(t: Theme) {
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
  applyTheme(t);
}
export function watchSystemTheme() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (getTheme() === 'auto') applyTheme('auto'); });
}
