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
import { rosterOnlySections, staffSections } from './profileSections';
import DemoDocuments, { DemoResetButton, resetDemoState } from './DemoDocuments';
import { DEMO_MODE } from '@/lib/demo/config';
import { logAdminEvent, useAdminEvents } from '@/lib/adminEvents';
import { adminEventsToAudit, mergeAudit, staffAuditEvents } from '@/lib/adminAudit';
import { CURRENT_ADMIN_ID } from '@/lib/documentVerification';
import { useLocalStorage } from '@/lib/storage';
import { freshStaffRegistration, type StaffRegistration } from '@/lib/types';
import { staffFlags, useEventRoster } from '@/lib/roster';
import { initialsOf } from '@/lib/format';

export default function StaffDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { roster, setDisabled, clearFlagsAndApprove, ageOf } = useEventRoster();
  const [reg, setReg] = useLocalStorage<StaffRegistration>('facex-staff-registration', freshStaffRegistration());
  const entry = roster.find((r) => r.id === id);
  const isSelf = id === 'self-staff' && reg.status === 'submitted';
  // The id this person's documents are reviewed (and audit events recorded) under.
  const subjectId = isSelf ? (reg.id ?? id) : id;
  const logged = useAdminEvents('staff', subjectId);
  const [selfRun, setSelfRun] = useState(0); // Demo Mode: remounts the review rows on reset

  /** Demo Mode: puts every document on this registration back to pending review. */
  function resetSelfDocs() {
    setReg({
      ...reg,
      livePhoto: { ...reg.livePhoto, review: 'not_submitted', reason: '' },
      backgroundCheckRef: { ...reg.backgroundCheckRef, review: 'not_submitted', reason: '' },
      safeSportUpload: { ...reg.safeSportUpload, review: 'not_submitted', reason: '' }
    });
    resetDemoState();
    setSelfRun((n) => n + 1);
  }
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (!entry) {
    return (
      <Card>
        <p className="text-ink-soft mb-2">Staff member not found.</p>
        <button onClick={() => router.push('/admin/staff')} className="text-primary-strong text-sm font-semibold">
          ← Back to Staff Members
        </button>
      </Card>
    );
  }

  function approveLivePhoto() {
    setReg({ ...reg, livePhoto: { ...reg.livePhoto, review: 'approved', reason: '' } });
  }
  function rejectLivePhoto(r: string) {
    setReg({ ...reg, livePhoto: { ...reg.livePhoto, review: 'rejected', reason: r } });
  }
  function approveDoc(key: 'backgroundCheckRef' | 'safeSportUpload') {
    setReg({ ...reg, [key]: { ...reg[key], review: 'approved', reason: '' } });
  }
  function rejectDoc(key: 'backgroundCheckRef' | 'safeSportUpload', r: string) {
    setReg({ ...reg, [key]: { ...reg[key], review: 'rejected', reason: r } });
  }

  function approveOverall() {
    setReg({ ...reg, adminStatus: 'approved', rejectionReason: '' });
    logAdminEvent({ subjectType: 'staff', subjectId, kind: 'registration_approved', adminId: CURRENT_ADMIN_ID });
  }

  function submitRejectOverall() {
    if (!reason.trim()) return;
    setReg({ ...reg, adminStatus: 'rejected', rejectionReason: reason.trim() });
    logAdminEvent({ subjectType: 'staff', subjectId, kind: 'registration_rejected', detail: reason.trim(), adminId: CURRENT_ADMIN_ID });
    setRejecting(false);
    setReason('');
  }

  const toggleAccess = () => {
    // Defence in depth: the button is disabled while blocked, but enabling must never succeed against an open block.
    // Judged on the live registration (`compliance`), the same thing the badge and the document table show.
    if (entry.disabled && compliance.blocked) return;
    setDisabled(entry.id, !entry.disabled);
    logAdminEvent({ subjectType: 'staff', subjectId, kind: entry.disabled ? 'access_enabled' : 'access_disabled', adminId: CURRENT_ADMIN_ID });
  };
  const approveFlagged = () => {
    clearFlagsAndApprove(entry.id);
    logAdminEvent({ subjectType: 'staff', subjectId, kind: 'registration_approved', adminId: CURRENT_ADMIN_ID });
  };

  // For a registration made in this app, everything below is read from the registration itself, not the roster row.
  const flags = isSelf ? staffFlags(reg) : entry.flags;
  const registration = isSelf ? reg.adminStatus : entry.approved ? 'approved' : 'pending';
  const compliance = accessCompliance({
    registration,
    flags,
    documents: isSelf
      ? [
          { file: reg.livePhoto, required: true },
          { file: reg.backgroundCheckRef, required: true },
          { file: reg.safeSportUpload, required: false }
        ]
      : undefined
  });

  const locked = isRecordLocked(registration, compliance);

  const documents = (
    <>
      <DocumentsPanel title="Photo & documents" locked={locked}>
        {isSelf ? (
          <>
            <p className="text-ink-soft text-sm mb-2">Review the uploaded photo and documents.</p>
            {DEMO_MODE && (
              <div className="mb-1 flex justify-end">
                <DemoResetButton onReset={resetSelfDocs} />
              </div>
            )}
            <DocumentReviewTable files={[reg.livePhoto, reg.backgroundCheckRef, reg.safeSportUpload]}>
              <DocumentReviewRow
                label="Live Staff Photo"
                subtitle="Required"
                key={`${selfRun}-livePhoto`}
                documentId="livePhoto"
                subject={{ type: 'staff', id: subjectId }}
                readOnly={locked}
                value={reg.livePhoto}
                onApprove={approveLivePhoto}
                onReject={rejectLivePhoto}
              />
              <DocumentReviewRow
                label="Background-Check Reference"
                subtitle="Required"
                key={`${selfRun}-backgroundCheckRef`}
                documentId="backgroundCheckRef"
                subject={{ type: 'staff', id: subjectId }}
                readOnly={locked}
                value={reg.backgroundCheckRef}
                onApprove={() => approveDoc('backgroundCheckRef')}
                onReject={(r) => rejectDoc('backgroundCheckRef', r)}
              />
              <DocumentReviewRow
                label="Safe-Sport Compliance Upload"
                subtitle="Optional"
                key={`${selfRun}-safeSportUpload`}
                documentId="safeSportUpload"
                subject={{ type: 'staff', id: subjectId }}
                readOnly={locked}
                value={reg.safeSportUpload}
                onApprove={() => approveDoc('safeSportUpload')}
                onReject={(r) => rejectDoc('safeSportUpload', r)}
              />
            </DocumentReviewTable>
          </>
        ) : (
          <>
            <DemoDocuments entryId={entry.id} role="staff" fullName={`${entry.firstName} ${entry.lastName}`} approved={entry.approved} flags={entry.flags} readOnly={locked} />
          </>
        )}
      </DocumentsPanel>

      {!isSelf && <ComplianceFlagsSection flags={entry.flags} onClearAndApprove={approveFlagged} />}

      {isSelf && (
        <AdminDecisionSection
          title="Registration Decision"
          description="Approve or reject the overall staff registration."
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
                  Reject Staff
                </Button>
              )}
              {reg.adminStatus !== 'approved' && (
                <Button variant="primary" onClick={approveOverall}>
                  Approve Staff
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
      backLabel="Staff Members"
      onBack={() => router.push('/admin/staff')}
      header={{
        name: `${entry.firstName} ${entry.lastName}`,
        subtitle: `${entry.teamName || 'No team assigned'}${isSelf && reg.role ? ` · ${reg.role}` : ''}`,
        initials: initialsOf(entry.firstName, entry.lastName),
        photoUrl: (isSelf ? reg.livePhoto.dataUrl : entry.photoUrl) || undefined,
        roleLabel: 'Staff',
        registration,
        flags,
        compliance,
        accessDisabled: entry.disabled,
        onToggleAccess: toggleAccess
      }}
      sections={isSelf ? staffSections(reg, entry) : rosterOnlySections(entry, ageOf(entry.dob))}
      documents={documents}
      activity={mergeAudit(isSelf ? staffAuditEvents(reg) : [], adminEventsToAudit(logged))}
      activityEmptyMessage="No activity recorded yet. Document decisions and access changes made on this page will appear here."
    />
  );
}
