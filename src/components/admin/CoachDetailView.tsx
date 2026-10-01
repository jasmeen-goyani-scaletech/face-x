'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { accessCompliance } from '@/lib/accessCompliance';
import { isRecordLocked } from '@/lib/recordLock';
import DocumentsPanel from './DocumentsPanel';
import Alert from '@/components/ui/Alert';
import DocumentReviewRow from './DocumentReviewRow';
import DocumentReviewTable from './DocumentReviewTable';
import AdminEntityDetailsLayout from './AdminEntityDetailsLayout';
import AdminDecisionSection, { ComplianceFlagsSection } from './AdminDecisionSection';
import { coachSections, rosterOnlySections } from './profileSections';
import DemoDocuments, { DemoResetButton, resetDemoState } from './DemoDocuments';
import { DEMO_MODE } from '@/lib/demo/config';
import { logAdminEvent, useAdminEvents } from '@/lib/adminEvents';
import { adminEventsToAudit, coachAuditEvents, mergeAudit } from '@/lib/adminAudit';
import { CURRENT_ADMIN_ID } from '@/lib/documentVerification';
import { useLocalStorage } from '@/lib/storage';
import { emptyFile, freshCoachRegistration, type CoachRegistration } from '@/lib/types';
import { coachFlags, useEventRoster } from '@/lib/roster';
import { initialsOf } from '@/lib/format';

export default function CoachDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { roster, setDisabled, clearFlagsAndApprove, ageOf } = useEventRoster();
  const [reg, setReg] = useLocalStorage<CoachRegistration>('facex-coach-registration', freshCoachRegistration());
  const entry = roster.find((r) => r.id === id);
  const isSelf = id === 'self-coach' && reg.status === 'submitted';
  // The id this person's documents are reviewed (and audit events recorded) under.
  const subjectId = isSelf ? (reg.id ?? id) : id;
  const logged = useAdminEvents('coach', subjectId);
  const [selfRun, setSelfRun] = useState(0); // Demo Mode: remounts the review rows on reset

  /** Demo Mode: puts every document on this registration back to pending review. */
  function resetSelfDocs() {
    setReg({
      ...reg,
      livePhoto: { ...(reg.livePhoto ?? emptyFile()), review: 'not_submitted', reason: '' },
      certificates: {
        firstAidCpr: { ...reg.certificates.firstAidCpr, review: 'not_submitted', reason: '' },
        yalfTackle: { ...reg.certificates.yalfTackle, review: 'not_submitted', reason: '' },
        backgroundCheckRef: { ...reg.certificates.backgroundCheckRef, review: 'not_submitted', reason: '' }
      }
    });
    resetDemoState();
    setSelfRun((n) => n + 1);
  }
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (!entry) {
    return (
      <Card>
        <p className="text-ink-soft mb-2">Coach not found.</p>
        <button onClick={() => router.push('/admin/coaches')} className="text-primary-strong text-sm font-semibold">
          ← Back to Coaches
        </button>
      </Card>
    );
  }

  function approveDoc(key: 'firstAidCpr' | 'yalfTackle' | 'backgroundCheckRef') {
    setReg({ ...reg, certificates: { ...reg.certificates, [key]: { ...reg.certificates[key], review: 'approved', reason: '' } } });
  }

  function rejectDoc(key: 'firstAidCpr' | 'yalfTackle' | 'backgroundCheckRef', r: string) {
    setReg({ ...reg, certificates: { ...reg.certificates, [key]: { ...reg.certificates[key], review: 'rejected', reason: r } } });
  }

  function approveLivePhoto() {
    setReg({ ...reg, livePhoto: { ...(reg.livePhoto ?? emptyFile()), review: 'approved', reason: '' } });
  }
  function rejectLivePhoto(r: string) {
    setReg({ ...reg, livePhoto: { ...(reg.livePhoto ?? emptyFile()), review: 'rejected', reason: r } });
  }

  function approveOverall() {
    setReg({ ...reg, adminStatus: 'approved', rejectionReason: '' });
    logAdminEvent({ subjectType: 'coach', subjectId, kind: 'registration_approved', adminId: CURRENT_ADMIN_ID });
  }

  function submitRejectOverall() {
    if (!reason.trim()) return;
    setReg({ ...reg, adminStatus: 'rejected', rejectionReason: reason.trim() });
    logAdminEvent({ subjectType: 'coach', subjectId, kind: 'registration_rejected', detail: reason.trim(), adminId: CURRENT_ADMIN_ID });
    setRejecting(false);
    setReason('');
  }

  const toggleAccess = () => {
    // Defence in depth: the button is disabled while blocked, but enabling must never succeed against an open block.
    // Judged on the live registration (`compliance`), the same thing the badge and the document table show.
    if (entry.disabled && compliance.blocked) return;
    setDisabled(entry.id, !entry.disabled);
    logAdminEvent({ subjectType: 'coach', subjectId, kind: entry.disabled ? 'access_enabled' : 'access_disabled', adminId: CURRENT_ADMIN_ID });
  };
  const approveFlagged = () => {
    clearFlagsAndApprove(entry.id);
    logAdminEvent({ subjectType: 'coach', subjectId, kind: 'registration_approved', adminId: CURRENT_ADMIN_ID });
  };

  // For a registration made in this app, everything below is read from the registration itself, not the roster row.
  const flags = isSelf ? coachFlags(reg) : entry.flags;
  const registration = isSelf ? reg.adminStatus : entry.approved ? 'approved' : 'pending';
  const compliance = accessCompliance({
    registration,
    flags,
    documents: isSelf
      ? [
          { file: reg.livePhoto ?? emptyFile(), required: true },
          { file: reg.certificates.firstAidCpr, required: true },
          { file: reg.certificates.yalfTackle, required: true },
          { file: reg.certificates.backgroundCheckRef, required: true }
        ]
      : undefined
  });

  const locked = isRecordLocked(registration, compliance);

  const documents = (
    <>
      <DocumentsPanel title="Photo & certificates" locked={locked}>
        {isSelf ? (
          <>
            <p className="text-ink-soft text-sm mb-2">Review each certificate before approving this coach.</p>
            {DEMO_MODE && (
              <div className="mb-1 flex justify-end">
                <DemoResetButton onReset={resetSelfDocs} />
              </div>
            )}
            <DocumentReviewTable files={[reg.livePhoto ?? emptyFile(), reg.certificates.firstAidCpr, reg.certificates.yalfTackle, reg.certificates.backgroundCheckRef]}>
              <DocumentReviewRow
                label="Live Coach Photo"
                subtitle="Required"
                key={`${selfRun}-livePhoto`}
                documentId="livePhoto"
                subject={{ type: 'coach', id: subjectId }}
                readOnly={locked}
                value={reg.livePhoto ?? emptyFile()}
                onApprove={approveLivePhoto}
                onReject={rejectLivePhoto}
              />
              <DocumentReviewRow
                label="First Aid / CPR Certificate"
                subtitle="Required"
                key={`${selfRun}-firstAidCpr`}
                documentId="firstAidCpr"
                subject={{ type: 'coach', id: subjectId }}
                readOnly={locked}
                value={reg.certificates.firstAidCpr}
                onApprove={() => approveDoc('firstAidCpr')}
                onReject={(r) => rejectDoc('firstAidCpr', r)}
              />
              <DocumentReviewRow
                label="YALF Tackle Certificate"
                subtitle="Required"
                key={`${selfRun}-yalfTackle`}
                documentId="yalfTackle"
                subject={{ type: 'coach', id: subjectId }}
                readOnly={locked}
                value={reg.certificates.yalfTackle}
                onApprove={() => approveDoc('yalfTackle')}
                onReject={(r) => rejectDoc('yalfTackle', r)}
              />
              <DocumentReviewRow
                label="Live Scan Background Check"
                subtitle="Required"
                key={`${selfRun}-backgroundCheckRef`}
                documentId="backgroundCheckRef"
                subject={{ type: 'coach', id: subjectId }}
                readOnly={locked}
                value={reg.certificates.backgroundCheckRef}
                onApprove={() => approveDoc('backgroundCheckRef')}
                onReject={(r) => rejectDoc('backgroundCheckRef', r)}
              />
            </DocumentReviewTable>
          </>
        ) : (
          <>
            <DemoDocuments entryId={entry.id} role="coach" fullName={`${entry.firstName} ${entry.lastName}`} approved={entry.approved} flags={entry.flags} readOnly={locked} />
          </>
        )}
      </DocumentsPanel>

      {!isSelf && <ComplianceFlagsSection flags={entry.flags} onClearAndApprove={approveFlagged} />}

      {isSelf && (
        <AdminDecisionSection
          title="Registration Decision"
          description="Approve or reject the overall coach registration."
          notice={
            reg.adminStatus === 'rejected' && reg.rejectionReason ? (
              <Alert level="danger" title="Currently rejected">
                {reg.rejectionReason}
              </Alert>
            ) : undefined
          }
          actions={
            <>
              {reg.adminStatus !== 'rejected' && (
                <Button variant="dangerOutline" onClick={() => setRejecting((v) => !v)}>
                  Reject Coach
                </Button>
              )}
              {reg.adminStatus !== 'approved' && (
                <Button variant="primary" onClick={approveOverall}>
                  Approve Coach
                </Button>
              )}
            </>
          }
        >
          {rejecting && (
            <div className="rounded-s border border-line bg-surface-2 p-3">
              <label className="block text-[12px] font-semibold text-ink mb-1.5">Rejection reason (required)</label>
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded-s border border-line-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                <Button variant="secondary" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={submitRejectOverall} disabled={!reason.trim()}>
                  Save Rejection
                </Button>
              </div>
            </div>
          )}
        </AdminDecisionSection>
      )}
    </>
  );

  return (
    <AdminEntityDetailsLayout
      backLabel="Coaches"
      onBack={() => router.push('/admin/coaches')}
      header={{
        name: `${entry.firstName} ${entry.lastName}`,
        subtitle: entry.teamName || 'No team assigned',
        initials: initialsOf(entry.firstName, entry.lastName),
        photoUrl: (isSelf ? reg.livePhoto?.dataUrl : entry.photoUrl) || undefined,
        roleLabel: 'Coach',
        registration,
        flags,
        compliance,
        accessDisabled: entry.disabled,
        onToggleAccess: toggleAccess
      }}
      sections={isSelf ? coachSections(reg, entry) : rosterOnlySections(entry, ageOf(entry.dob))}
      documents={documents}
      activity={mergeAudit(isSelf ? coachAuditEvents(reg) : [], adminEventsToAudit(logged))}
      activityEmptyMessage="No activity recorded yet. Document decisions and access changes made on this page will appear here."
    />
  );
}
