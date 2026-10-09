'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BellIcon, BellOffIcon } from '@/components/ui/Icons';
import { pushClient, type PushState } from '@/lib/push';

const LABEL: Record<'off' | 'on' | 'denied', { text: string; title: string }> = {
  off: { text: 'Alerts off', title: 'Get a notification when a document is reviewed or your event-day access is ready' },
  on: { text: 'Alerts on', title: 'Notifications are on for this device. Tap to turn them off.' },
  denied: { text: 'Alerts blocked', title: 'Notifications are blocked for this site. Allow them in your browser settings to turn them on.' }
};

/**
 * The only notification UI: a small bell in the top bar. It asks for permission only when the person taps it (never on
 * page load), shows nothing where push can't work, and never gets in the way of registration. While signed in it quietly
 * re-registers an existing subscription so the server's copy stays current.
 */
export default function PushNotificationsButton() {
  const { status } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'signedIn') {
      setState(null);
      return;
    }
    void pushClient.sync().then((next) => alive.current && setState(next));
  }, [status]);

  if (status !== 'signedIn' || state === null || state === 'unsupported' || state === 'unavailable') return null;

  const label = LABEL[state];
  async function toggle() {
    if (busy || state === 'denied') return;
    setBusy(true);
    const next = state === 'on' ? await pushClient.disable() : await pushClient.enable();
    if (alive.current) {
      setState(next);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-disabled={state === 'denied'}
      aria-pressed={state === 'on'}
      title={label.title}
      className={[
        'flex shrink-0 items-center gap-1 rounded-s px-2 py-1 text-[12.5px] font-bold hover:bg-primary-light disabled:opacity-55',
        state === 'denied' ? 'cursor-not-allowed text-ink-faint' : 'text-primary-strong'
      ].join(' ')}
    >
      {state === 'on' ? <BellIcon size={16} /> : <BellOffIcon size={16} />}
      <span className="hidden sm:inline">{label.text}</span>
      <span className="sr-only sm:hidden">{label.text}. {label.title}</span>
    </button>
  );
}
