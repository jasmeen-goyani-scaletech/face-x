// Locale is pinned to 'en-US' (not `undefined`) deliberately: the Node.js server process and
// the browser can resolve `undefined` to different default locales, which produces different
// formatted strings for the same Date and triggers a React hydration mismatch. Pinning it keeps
// server- and client-rendered text identical, which also fits the target market (California, USA).
const LOCALE = 'en-US';

export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(LOCALE, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })}, ${formatTime(ts)}`;
}

export function initialsOf(first: string, last: string): string {
  return ((first || '').charAt(0) + (last || '').charAt(0)).toUpperCase() || '?';
}

const AVATAR_VARS = ['--primary', '--info', '--gold', '--primary-strong', '--success'];
export function avatarVar(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_VARS[h % AVATAR_VARS.length];
}

export function genId(prefix: string): string {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}
