'use client';

import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { TextField } from '@/components/ui/Field';
import { ChevronLeftIcon, ChevronRightIcon, MailIcon, UsersIcon } from '@/components/ui/Icons';
import { formatDateTime } from '@/lib/format';
import type { PlayerRegistration } from '@/lib/types';

export default function ConsentStep({
  reg,
  onChange,
  onNext,
  onBack,
  isMinor
}: {
  reg: PlayerRegistration;
  onChange: (next: PlayerRegistration) => void;
  onNext: () => void;
  onBack: () => void;
  isMinor: boolean;
}) {
  const c = reg.consent;

  function setConsent(patch: Partial<PlayerRegistration['consent']>) {
    onChange({ ...reg, consent: { ...c, ...patch } });
  }

  function chooseMethod(method: 'inline' | 'link') {
    if (c.method !== method) setConsent({ method, status: 'not_started' });
  }

  return (
    <Card>
      <h2 className="text-xl mb-1">Parent / Guardian Consent</h2>
      <p className="text-ink-soft mb-5">
        {isMinor
          ? 'Choose how consent will be provided. Registration can proceed to payment even while this is pending.'
          : 'This player is 18 or older — consent is optional but can still be recorded here if your league requires it.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-1">
        <button
          type="button"
          onClick={() => chooseMethod('inline')}
          className={['text-left rounded-l border bg-surface p-4', c.method === 'inline' ? 'border-accent ring-1 ring-accent' : 'border-line'].join(' ')}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-s bg-accent-soft text-accent-strong mb-2">
            <UsersIcon size={18} />
          </span>
          <div className="font-bold text-sm">A parent is here now</div>
          <div className="text-[12.5px] text-ink-soft">Complete consent on this screen together.</div>
        </button>
        <button
          type="button"
          onClick={() => chooseMethod('link')}
          className={['text-left rounded-l border bg-surface p-4', c.method === 'link' ? 'border-accent ring-1 ring-accent' : 'border-line'].join(' ')}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-s bg-accent-soft text-accent-strong mb-2">
            <MailIcon size={18} />
          </span>
          <div className="font-bold text-sm">Send a link instead</div>
          <div className="text-[12.5px] text-ink-soft">Text or email a secure consent link.</div>
        </button>
      </div>

      {c.method === 'inline' && (
        <div className="mt-5 border-t border-line pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <TextField id="cName" label="Parent/Guardian Full Name" value={c.guardianName} onChange={(e) => setConsent({ guardianName: e.target.value })} />
            <TextField id="cRel" label="Relationship to Player" placeholder="Mother, Father, Legal Guardian" value={c.relationship} onChange={(e) => setConsent({ relationship: e.target.value })} />
          </div>
          <label className="flex gap-2.5 items-start text-[13.5px] text-ink-soft my-3">
            <input type="checkbox" className="mt-0.5" checked={c.agree} onChange={(e) => setConsent({ agree: e.target.checked })} />
            I confirm I am this player&rsquo;s parent or legal guardian and I consent to their participation, including the event-day face-scan check-in.
          </label>
          <TextField id="cSign" label="Type your full name to sign" value={c.signedName} onChange={(e) => setConsent({ signedName: e.target.value })} />
          {c.status === 'completed' ? (
            <Alert level="success" title="Consent recorded">
              Signed by {c.signedName} on {formatDateTime(c.completedAt)}.
            </Alert>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                if (!c.guardianName || !c.relationship || !c.signedName || !c.agree) return;
                setConsent({ status: 'completed', completedAt: Date.now() });
              }}
            >
              Submit Consent
            </Button>
          )}
        </div>
      )}

      {c.method === 'link' && (
        <div className="mt-5 border-t border-line pt-5">
          {c.status === 'sent' || c.status === 'completed' ? (
            <>
              <Alert level={c.status === 'completed' ? 'success' : 'info'} title={c.status === 'completed' ? 'Consent completed' : 'Consent link sent'} icon={c.status === 'sent' ? 'mail' : undefined}>
                {c.status === 'completed'
                  ? `Completed by parent on ${formatDateTime(c.completedAt)}.`
                  : `Sent to ${reg.emergency.guardianEmail || reg.basic.email} on ${formatDateTime(c.sentAt)}. Waiting for the parent to complete it.`}
              </Alert>
              {c.status === 'sent' && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setConsent({ sentAt: Date.now() })}>
                    Resend Link
                  </Button>
                  <div className="w-full rounded-m border border-dashed border-gold bg-gold-soft p-3.5 mt-2">
                    <div className="text-[11px] font-display font-bold uppercase tracking-wide text-gold mb-2">
                      Demo control (not part of the real product)
                    </div>
                    <button
                      type="button"
                      onClick={() => setConsent({ status: 'completed', completedAt: Date.now() })}
                      className="rounded-s border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-bold"
                    >
                      Simulate parent completing the link
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-ink-soft mb-3">We&rsquo;ll send a secure consent link to:</p>
              <div className="flex justify-between text-sm py-1">
                <span className="text-ink-faint">Email</span>
                <span className="font-semibold">{reg.emergency.guardianEmail || reg.basic.email || '—'}</span>
              </div>
              <div className="flex justify-between text-sm py-1 mb-3">
                <span className="text-ink-faint">Mobile</span>
                <span className="font-semibold">{reg.emergency.guardianPhone || '—'}</span>
              </div>
              <Button variant="primary" onClick={() => setConsent({ status: 'sent', sentAt: Date.now() })}>
                <MailIcon size={16} /> Send Consent Link
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex justify-between mt-6">
        <Button variant="secondary" onClick={onBack}>
          <ChevronLeftIcon size={16} /> Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Continue <ChevronRightIcon size={16} />
        </Button>
      </div>
    </Card>
  );
}
