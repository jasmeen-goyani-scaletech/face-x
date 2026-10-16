'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Topbar from '@/components/layout/Topbar';
import RequireAuth from '@/components/auth/RequireAuth';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Chip, { reviewChip } from '@/components/ui/Chip';
import { CalendarIcon, ShieldIcon } from '@/components/ui/Icons';
import { getEvent } from '@/lib/api/catalog';
import { useAuth } from '@/components/auth/AuthProvider';
import { hasFamilyRole } from '@/lib/api/auth';
import { describeError } from '@/lib/api/errors';
import { getPayment, getReadiness } from '@/lib/api/payments';
import { getRegistration, listRegistrations } from '@/lib/api/registrations';
import { listDocuments } from '@/lib/api/documents';
import type { ApiBlocker, ApiDocument, ApiEvent, ApiPaymentSummary, ApiReadinessReport, ApiRegistration } from '@/lib/api/types';
import { KEY_BY_DOCUMENT_TYPE, newestPerType, toUploadedFile } from '@/lib/registration/documentMap';
import { DOCUMENT_LABELS } from '@/lib/documentKinds';
import { formatEventStart } from '@/lib/format';

interface Snapshot {
  registration: ApiRegistration;
  event: ApiEvent | null;
  readiness: ApiReadinessReport;
  payment: ApiPaymentSummary | null;
  /** The payment lookup failed (so `payment` is unknown, not "none"). */
  paymentError: boolean;
  documents: ApiDocument[];
}

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Snapshot[] };

/** What is still needed, in a family's words, and where to do it. */
const BLOCKERS: Record<ApiBlocker, { text: string; action?: string }> = {
  REGISTRATION_NOT_SUBMITTED: { text: 'Registration isn’t finished yet.', action: 'Finish registration' },
  REGISTRATION_CANCELLED: { text: 'This registration was cancelled.' },
  REGISTRATION_REJECTED: { text: 'This registration wasn’t accepted. Contact the league for details.' },
  PAYMENT_NOT_COMPLETED: { text: 'Payment is due.', action: 'Pay now' },
  DOCUMENTS_NOT_SUBMITTED: { text: 'Some required documents still need to be uploaded.', action: 'Upload documents' },
  DOCUMENTS_NOT_APPROVED: { text: 'Staff is still reviewing your documents.' },
  CONSENT_NOT_ACCEPTED: { text: 'Guardian consent hasn’t been accepted yet.', action: 'Complete consent' }
};

const STATUS_LABEL: Record<ApiRegistration['status'], { label: string; kind: 'info' | 'warning' | 'success' | 'danger' | 'neutral' }> = {
  DRAFT: { label: 'Draft', kind: 'neutral' },
  SUBMITTED: { label: 'Submitted', kind: 'info' },
  PAYMENT_PENDING: { label: 'Payment pending', kind: 'warning' },
  PAYMENT_COMPLETED: { label: 'Paid', kind: 'info' },
  DOCUMENT_REVIEW: { label: 'Documents in review', kind: 'warning' },
  VERIFIED: { label: 'Verified', kind: 'success' },
  READY_FOR_EVENT: { label: 'Ready for event', kind: 'success' },
  REJECTED: { label: 'Not accepted', kind: 'danger' },
  CANCELLED: { label: 'Cancelled', kind: 'neutral' }
};

const reviewOf = (d: ApiDocument) => toUploadedFile(d).review;

function RegistrationPanel({ s }: { s: Snapshot }) {
  const { registration: r, event, readiness, payment, paymentError } = s;
  // A replaced (rejected) file stays on record; the family sees only what is on file now.
  const documents = newestPerType(s.documents);
  const status = STATUS_LABEL[r.status];
  const resume = `/register/player?registrationId=${r.id}`;
  // A rejected file already has its own "Upload replacements" link in the Documents card, so the banner doesn't repeat it.
  const hasRejected = documents.some((d) => d.state === 'REJECTED');

  return (
    <div className="mb-8">
      <h2 className="text-xl mb-4">
        {r.player.firstName} {r.player.lastName}
      </h2>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[12px] tracking-wide">Tournament Details</h3>
          <CalendarIcon size={17} className="text-primary-strong" />
        </div>
        <div className="text-sm font-semibold mb-1">{r.event.name}</div>
        <div className="text-[12.5px] text-ink-soft">{formatEventStart(r.event.startsAt, r.event.timezone)}</div>
        {event && <div className="text-[12px] text-ink-faint mt-1.5">{event.location}</div>}
        {r.team && (
          <div className="text-[12px] text-ink-faint mt-1.5">
            {r.team.name} · {r.team.club}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-faint">
          <Chip kind={status.kind} compact>
            {status.label}
          </Chip>
          <span>{r.registrationNumber}</span>
        </div>
      </Card>

      {readiness.ready ? (
        <div className="mb-4 flex items-start gap-3 rounded-l bg-success-soft text-success px-5 py-4">
          <ShieldIcon size={20} className="shrink-0 mt-0.5" />
          <p className="m-0 text-sm">Everything is complete. {r.player.firstName} is cleared for the event.</p>
        </div>
      ) : (
        readiness.blockers.map((b) => (
          <div key={b} className="mb-3 flex items-start gap-3 rounded-l bg-warning-soft text-warning px-5 py-4">
            <ShieldIcon size={20} className="shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm">{BLOCKERS[b].text}</p>
              {BLOCKERS[b].action && !(b === 'DOCUMENTS_NOT_SUBMITTED' && hasRejected) && (
                <Link href={resume} className="mt-1 inline-block text-sm font-bold underline">
                  {BLOCKERS[b].action}
                </Link>
              )}
            </div>
          </div>
        ))
      )}

      {paymentError && (
        <Alert level="warning" title="We couldn’t load your payment status">
          Your payment may be fine. Reload this page to check it again before paying.
        </Alert>
      )}

      {payment && payment.amountDue.amountCents > 0 && (
        <Card className="mb-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-soft">Registration fee ${(payment.amountDue.amountCents / 100).toFixed(2)}</span>
            {payment.paymentStatus === 'PAID' ? <Chip kind="success" compact>Paid</Chip> : <Chip kind="warning" compact>{payment.paymentStatus === 'NOT_STARTED' ? 'Not paid' : payment.paymentStatus.replace('_', ' ').toLowerCase()}</Chip>}
          </div>
        </Card>
      )}

      {documents.length > 0 && (
        <Card>
          <h3 className="text-[12px] tracking-wide mb-3">Documents</h3>
          <ul className="m-0 list-none p-0">
            {documents.map((d) => {
              const review = reviewOf(d);
              const file = toUploadedFile(d);
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-sm last:border-b-0">
                  <span className="min-w-0">
                    <span className="block truncate">{DOCUMENT_LABELS[KEY_BY_DOCUMENT_TYPE[d.documentType]] ?? d.documentType}</span>
                    {review === 'rejected' && file.reason && <span className="block text-[12px] text-danger">Not accepted: {file.reason}</span>}
                  </span>
                  {reviewChip(d.state === 'AWAITING_UPLOAD' ? 'missing' : review)}
                </li>
              );
            })}
          </ul>
          {documents.some((d) => d.state === 'REJECTED') && (
            <Link href={resume} className="mt-3 inline-block text-sm font-bold text-primary-strong">
              Upload replacements
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      // An account that hasn't picked PARENT or PLAYER yet can't own registrations, so there is nothing to ask for.
      const summaries = hasFamilyRole(user) ? await listRegistrations() : [];
      const items = await Promise.all(
        summaries.map(async (s): Promise<Snapshot> => {
          const [registration, readiness, documents] = await Promise.all([getRegistration(s.id), getReadiness(s.id), listDocuments(s.id)]);
          let paymentError = false;
          const [event, payment] = await Promise.all([
            // The event is only used for its address line; the page reads fine without it.
            getEvent(registration.event.id).catch(() => null),
            registration.status === 'DRAFT'
              ? Promise.resolve(null)
              : getPayment(s.id).catch(() => {
                  paymentError = true; // shown to the family: a failed lookup must not read as "no payment"
                  return null;
                })
          ]);
          return { registration, event, readiness, payment, paymentError, documents: documents.documents };
        })
      );
      setLoad({ kind: 'ready', items });
    } catch (e) {
      setLoad({ kind: 'error', message: describeError(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (load.kind === 'loading') {
    return (
      <Card className="text-center">
        <span className="mx-auto mb-4 block h-8 w-8 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden />
        <p role="status" className="m-0 text-ink-soft">
          Loading your registrations…
        </p>
      </Card>
    );
  }
  if (load.kind === 'error') {
    return (
      <Card className="text-center">
        <Alert level="danger" title="We couldn’t load your registrations">
          {load.message}
        </Alert>
        <Button variant="primary" onClick={() => void refresh()}>
          Try again
        </Button>
      </Card>
    );
  }
  if (load.items.length === 0) {
    return (
      <Card>
        <p className="text-ink-soft mb-4">No player registration yet.</p>
        <Link href="/register/player">
          <Button variant="primary">Go to Registration</Button>
        </Link>
      </Card>
    );
  }
  return (
    <>
      <h1 className="text-2xl mb-6">{load.items.length === 1 ? `Hi ${load.items[0].registration.player.firstName}!` : 'Your registrations'}</h1>
      {load.items.map((s) => (
        <RegistrationPanel key={s.registration.id} s={s} />
      ))}
      <Link href="/register/player?new=1" className="text-sm font-bold text-primary-strong">
        Register another player
      </Link>
    </>
  );
}

export default function PlayerDashboardPage() {
  return (
    <main>
      <Topbar eyebrow="Status dashboard" />
      <div className="mx-auto max-w-[560px] px-5 pt-10 pb-16">
        <Suspense fallback={null}>
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        </Suspense>
      </div>
    </main>
  );
}
