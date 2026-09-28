'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ShieldIcon, TrophyIcon } from '@/components/ui/Icons';

const ADMIN_SESSION_KEY = 'facex-admin-authed';
// Prototype-only placeholder: a real deployment gates /admin behind proper staff authentication
// (SSO / magic link / league-issued credentials), not a shared client-side passcode.
const DEMO_PASSCODE = '2026';

const TABS = [
  { href: '/admin/scan', label: 'Scan' },
  { href: '/admin/search', label: 'Search' },
  { href: '/admin/log', label: 'Log' }
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    try {
      setAuthed(window.sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true');
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  function submit() {
    if (input.trim() === DEMO_PASSCODE) {
      try {
        window.sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
      } catch {
        // ignore
      }
      setAuthed(true);
      setError(false);
    } else {
      setError(true);
    }
  }

  function exit() {
    try {
      window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch {
      // ignore
    }
    router.push('/register');
  }

  // Server and first client paint always render this same empty shell — the sessionStorage
  // check only happens after mount — so there is nothing here for hydration to mismatch on.
  if (!hydrated) return <div className="min-h-screen bg-[#0a0f0d]" />;

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0f0d] text-white flex items-center justify-center px-5">
        <div className="w-full max-w-[360px]">
          <div className="flex items-center gap-2.5 mb-8 justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#22c55e] text-[#06130d] font-display font-bold">
              FX
            </span>
            <span className="font-display font-bold text-xl tracking-wide">FIELD ADMIN</span>
          </div>
          <div className="rounded-2xl border border-[#253029] bg-[#12181f] p-6">
            <h1 className="font-display text-lg uppercase tracking-wide mb-1">Staff Access Only</h1>
            <p className="text-[#9fb0a6] text-sm mb-5">Enter the field-admin passcode to open the event-day scanner.</p>
            <input
              autoFocus
              inputMode="numeric"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Passcode"
              className="w-full rounded-xl border border-[#2d3a33] bg-[#0a0f0d] text-white text-center text-2xl tracking-[0.3em] py-4 mb-3 focus:outline-none focus:border-[#22c55e]"
            />
            {error && <p className="text-[#f87171] text-sm text-center mb-3">Incorrect passcode. Try again.</p>}
            <button
              onClick={submit}
              className="w-full rounded-xl bg-[#22c55e] text-[#06130d] font-bold uppercase tracking-wide py-4 text-base active:translate-y-px"
            >
              Enter
            </button>
            <p className="text-[#5c6b62] text-[12px] text-center mt-4">Demo passcode: 2026 — placeholder only, not real security.</p>
          </div>
          <Link href="/register" className="block text-center text-[#9fb0a6] text-sm mt-6 no-underline">
            ← Back to Player Registration
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f0d] text-white">
      <div className="sticky top-0 z-20 border-b border-[#253029] bg-[#0d1310]" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#22c55e] text-[#06130d]">
              <ShieldIcon size={16} />
            </span>
            <span className="font-display font-bold tracking-wide text-sm">FIELD ADMIN</span>
          </div>
          <button onClick={exit} className="flex items-center gap-1.5 text-[#9fb0a6] text-[12.5px] font-semibold">
            <TrophyIcon size={14} /> Player Registration
          </button>
        </div>
        <div className="flex px-4 gap-1">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={[
                  'flex-1 text-center py-3 font-display font-bold uppercase tracking-wide text-[13px] border-b-2 no-underline',
                  active ? 'text-[#22c55e] border-[#22c55e]' : 'text-[#6b7a71] border-transparent'
                ].join(' ')}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="px-4 py-5 pb-10" style={{ paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))' }}>
        {children}
      </div>
    </div>
  );
}
