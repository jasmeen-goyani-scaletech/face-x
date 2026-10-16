'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { accessCompliance } from '@/lib/accessCompliance';
import { isRecordLocked } from '@/lib/recordLock';
import { rejectRegistration, setEventAccess } from '@/lib/api/admin';
import { getConsents } from '@/lib/api/consents';
import { getDownloadUrl, listDocuments, reviewDocument } from '@/lib/api/documents';
import { describeError, hasCode } from '@/lib/api/errors';
import { getPayment, getReadiness } from '@/lib/api/payments';
import { getPersonnelRegistration, getRegistration, getRegistrationStatus } from '@/lib/api/registrations';
import type { ApiConsentStatus, ApiDocument, ApiPaymentSummary, ApiPersonnelRegistration, ApiReadinessReport, ApiRegistration, ApiStatusHistoryEntry } from '@/lib/api/types';
import {
  auditEvents,
  documentFor,
  flagsFrom,
  overviewSections,
  paymentState,
  personnelSections,
  registrationState,
  REJECTABLE,
  REVIEW_ROWS_BY_KIND,
  STATUS_LABEL
} from '@/lib/admin/apiPlayerView';
import type { RegistrantKind } from './ApiRegistrationsListPage';
import { toUploadedFile } from '@/lib/registration/documentMap';
import { initialsOf } from '@/lib/format';
import AdminDecisionSection from './AdminDecisionSection';
import AdminEntityDetailsLayout from './AdminEntityDetailsLayout';
import DocumentReviewRow from './DocumentReviewRow';
import DocumentReviewTable from './DocumentReviewTable';
import DocumentsPanel from './DocumentsPanel';
import SignInLinkCard from './SignInLinkCard';
import TeamAssignmentsCard from './TeamAssignmentsCard';

const KIND = {
  PLAYER: { label: 'Player', plural: 'Players', path: '/admin/players' },
  COACH: { label: 'Coach', plural: 'Coaches', path: '/admin/coaches' },
  STAFF: { label: 'Staff member', plural: 'Staff', path: '/admin/staff' }
};

interface Loaded {
  registration: ApiRegistration | ApiPersonnelRegistration;
  documents: ApiDocument[];
  payment: ApiPaymentSummary | null;
  /** The payment lookup failed: `payment` is unknown, not "none". */
  paymentError: boolean;
  readiness: ApiReadinessReport;
  consents: ApiConsentStatus;
  history: ApiStatusHistoryEntry[];
}

type State = { kind: 'loading' } | { kind: 'notfound' } | { kind: 'error'; message: string } | { kind: 'ready'; data: Loaded };

async function loadAll(id: string, kind: RegistrantKind): Promise<Loaded> {
  const registration = kind === 'PLAYER' ? await getRegistration(id) : await getPersonnelRegistration(id);
  // Coaches and staff do not pay: there is no payment to load.
  let paymentError = false;
  const [documents, readiness, consents, status, payment] = await Promise.all([
    listDocuments(id),
    getReadiness(id),
    getConsents(id),
    getRegistrationStatus(id),
    kind !== 'PLAYER' || registration.status === 'DRAFT'
      ? Promise.resolve(null)
      : getPayment(id).catch(() => {
          paymentError = true; // shown as "Unavailable", never as unpaid
          return null;
        })
  ]);
  return { registration, documents: documents.documents, payment, paymentError, readiness, consents, history: status.history };
}

/** One registration (a player's, coach's or staff member's) for an admin, read from and decided through the API. `id` is the registration id. */
export default function ApiRegistrationDetailView({ id, kind = 'PLAYER' }: { id: string; kind?: RegistrantKind }) {
  const copy = KIND[kind];
  const router = useRouter();
  const { notify } = useToast();
  const [accessPending, setAccessPending] = useState(false);
  // Set synchronously: a fast double-click would otherwise act twice before the pending state shows up in the next render.
  const accessFlight = useRef(false);
  const rejectFlight = useRef(false);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [rejectPending, setRejectPending] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState({ kind: 'ready', data: await loadAll(id, kind) });
    } catch (e) {
      if (hasCode(e, 'REGISTRATION_NOT_FOUND', 'VALIDATION_ERROR')) setState({ kind: 'notfound' });
      else setState({ kind: 'error', message: describeError(e) });
    }
  }, [id, kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useMemo(() => {
    if (state.kind !== 'ready') return null;
    const { registration, documents, payment, paymentError, readiness, consents, history } = state.data;
    const files = REVIEW_ROWS_BY_KIND[kind].map((r) => ({ ...r, doc: documentFor(documents, r.type) }));
    const regState = registrationState(registration.status);
    const flags = flagsFrom(readiness.blockers, kind);
    const compliance = accessCompliance({
      registration: regState,
      flags,
      documents: files.map((f) => ({ file: toUploadedFile(f.doc), required: f.required }))
    });
    const frozen = registration.status === 'REJECTED' || registration.status === 'CANCELLED';
    return {
      registration,
      files,
      regState,
      flags,
      compliance,
      locked: isRecordLocked(regState, compliance),
      frozen,
      payment,
      paymentError,
      sections: registration.registrantType === 'PLAYER' ? overviewSections(registration, payment, consents, paymentError) : personnelSections(registration, consents),
      activity: auditEvents(history, documents, consents),
      rejection: [...history].reverse().find((h) => h.to === 'REJECTED')
    };
  }, [state, kind]);

  if (state.kind === 'loading') return <p role="status" className="text-ink-soft">Loading registration…</p>;
  if (state.kind === 'notfound') {
    return (
      <Card>
        <p className="text-ink-soft mb-2">Registration not found.</p>
        <button onClick={() => router.push(copy.path)} className="text-primary-strong text-sm font-semibold">
          ← Back to {copy.plural}
        </button>
      </Card>
    );
  }
  if (state.kind === 'error' || !view) {
    return (
      <Card>
        <Alert level="danger" title="We couldn’t load this registration">
          {state.kind === 'error' ? state.message : 'Please try again.'}
        </Alert>
        <Button variant="primary" onClick={() => void refresh()}>
          Try again
        </Button>
      </Card>
    );
  }

  const { registration: reg, files, regState, flags, compliance, locked, frozen, payment, paymentError, rejection } = view;
  const canReject = REJECTABLE.includes(reg.status);
  const person = reg.registrantType === 'PLAYER' ? reg.player : reg.staffProfile;

  /** Flips event-day access on the server, then reloads so the header shows what the server now holds. */
  async function toggleAccess() {
    if (accessPending || accessFlight.current) return;
    accessFlight.current = true;
    setAccessPending(true);
    try {
      await setEventAccess(reg.id, !reg.eventAccessDisabled);
      await refresh();
      notify(reg.eventAccessDisabled ? 'Event-day access enabled.' : 'Event-day access disabled.');
    } catch (e) {
      notify(describeError(e, 'We couldn’t change event-day access. Please try again.'), 'danger');
    } finally {
      accessFlight.current = false;
      setAccessPending(false);
    }
  }

  async function submitReject() {
    if (rejectFlight.current) return;
    rejectFlight.current = true;
    setRejectPending(true);
    setRejectError(null);
    try {
      await rejectRegistration(reg.id, reason.trim());
      setRejecting(false);
      setReason('');
      await refresh();
    } catch (e) {
      setRejectError(describeError(e));
    } finally {
      rejectFlight.current = false;
      setRejectPending(false);
    }
  }

  const documents = (
    <>
      <DocumentsPanel title="Photos & documents" locked={locked}>
        <p className="text-ink-soft text-sm mb-2">
          Review what the {kind === 'PLAYER' ? 'family' : copy.label.toLowerCase()} has sent. Documents that haven&rsquo;t been sent for review yet show as not uploaded.
          {frozen && ' This registration is closed, so documents can no longer be decided.'}
        </p>
        <DocumentReviewTable files={files.map((f) => toUploadedFile(f.doc))}>
          {files.map((f) => {
            const doc = f.doc;
            return (
              <DocumentReviewRow
                key={f.key}
                label={f.label}
                subtitle={f.required ? 'Required' : 'Optional'}
                documentId={f.key}
                readOnly={locked || frozen}
                value={toUploadedFile(doc)}
                onApprove={() => void refresh()}
                onReject={() => void refresh()}
                server={
                  doc
                    ? {
                        mimeType: doc.mimeType,
                        approve: async () => {
                          await reviewDocument(doc.id, { decision: 'APPROVED' });
                        },
                        reject: async ({ code, text }) => {
                          await reviewDocument(doc.id, { decision: 'REJECTED', reasonCode: code ?? 'CUSTOM', reason: text });
                        },
                        openUrl: async () => (await getDownloadUrl(doc.id, { inline: true })).url
                      }
                    : undefined
                }
              />
            );
          })}
        </DocumentReviewTable>
      </DocumentsPanel>

      <AdminDecisionSection
        title="Registration Decision"
        description={`Documents are approved one by one above; the registration is verified automatically once every required document is approved${kind === 'PLAYER' ? ', paid and consented' : ''}. Use this only to turn the whole registration down.`}
        notice={
          reg.status === 'REJECTED' ? (
            <Alert level="danger" title="Currently rejected">
              {rejection?.reason ?? 'This registration was rejected.'}
            </Alert>
          ) : !canReject && reg.status !== 'CANCELLED' ? (
            <p className="m-0 text-[13px] text-ink-soft">
              A registration that is {STATUS_LABEL[reg.status].toLowerCase()} can&rsquo;t be rejected from here.
            </p>
          ) : undefined
        }
        actions={
          canReject ? (
            <Button variant="dangerOutline" onClick={() => setRejecting((v) => !v)}>
              Reject {copy.label}
            </Button>
          ) : undefined
        }
      >
        {rejecting && canReject && (
          <div className="rounded-s border border-line bg-surface-2 p-3">
            <label htmlFor="reject-reason" className="block text-[12px] font-semibold text-ink mb-1.5">
              Rejection reason (required, shown to the family)
            </label>
            <textarea
              id="reject-reason"
              autoFocus
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              disabled={rejectPending}
              className="w-full rounded-s border border-line-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
            {rejectError && (
              <p role="alert" className="mt-2 mb-0 rounded-s bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger">
                {rejectError}
              </p>
            )}
            <p className="mt-2 mb-0 text-[12px] text-ink-faint">Rejecting is final for now and doesn&rsquo;t refund a payment.</p>
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button variant="secondary" onClick={() => setRejecting(false)} disabled={rejectPending}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void submitReject()} disabled={!reason.trim()} loading={rejectPending}>
                Save Rejection
              </Button>
            </div>
          </div>
        )}
      </AdminDecisionSection>
    </>
  );

  return (
    <>
    <AdminEntityDetailsLayout
      backLabel={copy.plural}
      onBack={() => router.push(copy.path)}
      header={{
        name: `${person.firstName} ${person.lastName}`,
        subtitle: reg.team ? `${reg.team.name} · ${reg.team.club}` : 'No team assigned',
        initials: initialsOf(person.firstName, person.lastName),
        roleLabel: copy.label === 'Staff member' ? 'Staff' : copy.label,
        registration: regState,
        payment: kind === 'PLAYER' ? paymentState(payment, paymentError) : undefined,
        flags,
        compliance,
        accessDisabled: reg.eventAccessDisabled,
        // A closed registration has nothing to switch: its access is already held back by its status.
        onToggleAccess: frozen ? undefined : () => void toggleAccess()
      }}
      sections={view.sections}
      documents={documents}
      activity={view.activity}
      activityEmptyMessage="No activity recorded yet."
    />
    {/* Coaches and staff work with the teams an admin assigns; a player belongs to the one team they registered for. */}
    {kind !== 'PLAYER' && <TeamAssignmentsCard registrationId={id} eventId={reg.event.id} label={copy.label} />}
    {kind !== 'PLAYER' && <SignInLinkCard registrationId={id} label={copy.label} />}
    </>
  );
}
