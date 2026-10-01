'use client';

import { useEffect, useState } from 'react';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { ToastProvider } from '@/components/ui/Toast';

const ADMIN_SESSION_KEY = 'facex-admin-authed';
// Prototype-only placeholder: a real deployment gates /admin behind proper staff authentication
// (SSO / magic link / league-issued credentials), not a shared client-side passcode.
const DEMO_PASSCODE = '2026';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

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

  // Server and first client paint always render this same empty shell — the sessionStorage
  // check only happens after mount — so there is nothing here for hydration to mismatch on.
  if (!hydrated) return <div className="min-h-screen bg-surface" />;

  if (!authed) {
    return (
      <div className="min-h-screen bg-surface-2 flex items-center justify-center px-5">
        <div className="w-full max-w-[360px]">
          <div className="flex items-center gap-2.5 mb-8 justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-display font-bold">
              FX
            </span>
            <span className="font-display font-bold text-xl tracking-wide text-ink">Admin</span>
          </div>
          <div className="rounded-l border border-line bg-surface p-6 shadow-sm">
            <h1 className="font-display text-lg uppercase tracking-wide mb-1 text-ink">Staff Access Only</h1>
            <p className="text-ink-soft text-sm mb-5">Enter the admin passcode to continue.</p>
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
              className="w-full rounded-s border border-line-strong bg-surface text-ink text-center text-2xl tracking-[0.3em] py-4 mb-3 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
            {error && <p className="text-danger text-sm text-center mb-3">Incorrect passcode. Try again.</p>}
            <button
              onClick={submit}
              className="w-full rounded-s bg-primary text-primary-foreground font-bold uppercase tracking-wide py-4 text-base active:translate-y-px"
            >
              Enter
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col sm:flex-row">
        <AdminSidebar />
        <main
          className="min-w-0 flex-1 px-4 py-5 sm:px-8 sm:py-8"
          style={{
            paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))'
          }}
        >
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
