'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Chip from '@/components/ui/Chip';
import { accessCompliance } from '@/lib/accessCompliance';
import { isRecordLocked } from '@/lib/recordLock';
import DocumentsPanel from './DocumentsPanel';
import DocumentReviewRow from './DocumentReviewRow';
import DocumentReviewTable from './DocumentReviewTable';
import AdminEntityDetailsLayout from './AdminEntityDetailsLayout';
import { ComplianceFlagsSection } from './AdminDecisionSection';
import { playerSections, rosterOnlySections } from './profileSections';
import { PLAYER_DOCUMENTS, playerDocument, type PlayerDocumentId } from '@/lib/playerDocuments';
import DemoDocuments, { DemoResetButton, resetDemoState } from './DemoDocuments';
import { DEMO_MODE } from '@/lib/demo/config';
import { logAdminEvent, useAdminEvents } from '@/lib/adminEvents';
import { adminEventsToAudit, mergeAudit, playerAuditEvents } from '@/lib/adminAudit';
import { CURRENT_ADMIN_ID } from '@/lib/documentVerification';
import { useLocalStorage } from '@/lib/storage';
import { emptyFile, freshPlayerRegistration, type PlayerRegistration } from '@/lib/types';
import { playerFlags, useEventRoster } from '@/lib/roster';
import { initialsOf } from '@/lib/format';

export default function PlayerDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { roster, setDisabled, clearFlagsAndApprove, ageOf } = useEventRoster();
  const [reg, setReg] = useLocalStorage<PlayerRegistration>('facex-player-registration', freshPlayerRegistration(null));
  const entry = roster.find((r) => r.id === id);
  const isSelf = id === 'self-player' && reg.status === 'submitted';
  // The id this person's documents are reviewed (and audit events recorded) under.
  const subjectId = isSelf ? (reg.id ?? id) : id;
  const logged = useAdminEvents('player', subjectId);
  const [selfRun, setSelfRun] = useState(0); // Demo Mode: remounts the review rows on reset

  /** Demo Mode: puts every document on this registration back to pending review. */
  function resetSelfDocs() {
    setReg({
      ...reg,
      documents: Object.fromEntries(
        Object.entries(reg.documents).map(([k, f]) => [k, { ...f, review: 'not_submitted', reason: '' }])
      ) as PlayerRegistration['documents']
    });
    resetDemoState();
    setSelfRun((n) => n + 1);
  }

  if (!entry) {
    return (
      <Card>
        <p className="text-ink-soft mb-2">Player not found.</p>
        <button onClick={() => router.push('/admin/players')} className="text-primary-strong text-sm font-semibold">
          ← Back to Players
        </button>
      </Card>
    );
  }

  function approveDoc(key: 'profilePhoto' | PlayerDocumentId) {
    setReg({ ...reg, documents: { ...reg.documents, [key]: { ...(reg.documents[key] ?? emptyFile()), review: 'approved', reason: '' } } });
  }

  function rejectDoc(key: 'profilePhoto' | PlayerDocumentId, reason: string) {
    setReg({ ...reg, documents: { ...reg.documents, [key]: { ...(reg.documents[key] ?? emptyFile()), review: 'rejected', reason } } });
  }

  const toggleAccess = () => {
    // Defence in depth: the button is disabled while blocked, but enabling must never succeed against an open block.
    // Judged on the live registration (`compliance`), the same thing the badge and the document table show.
    if (entry.disabled && compliance.blocked) return;
    setDisabled(entry.id, !entry.disabled);
    logAdminEvent({ subjectType: 'player', subjectId, kind: entry.disabled ? 'access_enabled' : 'access_disabled', adminId: CURRENT_ADMIN_ID });
  };
  const approveFlagged = () => {
    clearFlagsAndApprove(entry.id);
    logAdminEvent({ subjectType: 'player', subjectId, kind: 'registration_approved', adminId: CURRENT_ADMIN_ID });
  };

  const age = ageOf(isSelf ? reg.basic.dob : entry.dob);
  const isMinor = age === null || age < 18;

  // For a registration made in this app, everything below is read from the registration itself, not the roster row.
  const flags = isSelf ? playerFlags(reg) : entry.flags;
  const registration = (isSelf ? reg.payment.status === 'success' : entry.approved) ? 'approved' : 'pending';
  const compliance = accessCompliance({
    registration,
    flags,
    documents: isSelf
      ? [{ file: reg.documents.profilePhoto, required: true }, ...PLAYER_DOCUMENTS.map((d) => ({ file: playerDocument(reg, d.id), required: d.required }))]
      : undefined
  });

  const locked = isRecordLocked(registration, compliance);

  const documents = (
    <>
    <DocumentsPanel title="Photos & documents" locked={locked}>
      {isSelf ? (
        <>
          <p className="text-ink-soft text-sm mb-2">Review the uploaded identification and documents.</p>
          {DEMO_MODE && (
            <div className="mb-1 flex justify-end">
              <DemoResetButton onReset={resetSelfDocs} />
            </div>
          )}
          <DocumentReviewTable files={[reg.documents.profilePhoto, ...PLAYER_DOCUMENTS.map((d) => playerDocument(reg, d.id))]}>
            <DocumentReviewRow
              key={`${selfRun}-profilePhoto`}
              label="Face-X Identification Photo"
              subtitle="Required"
              documentId="profilePhoto"
              subject={{ type: 'player', id: subjectId }}
                readOnly={locked}
              value={reg.documents.profilePhoto}
              onApprove={() => approveDoc('profilePhoto')}
              onReject={(reason) => rejectDoc('profilePhoto', reason)}
            />
            {PLAYER_DOCUMENTS.map((d) => (
              <DocumentReviewRow
                key={`${selfRun}-${d.id}`}
                label={d.label}
                subtitle={d.required ? 'Required' : 'Optional'}
                documentId={d.id}
                subject={{ type: 'player', id: subjectId }}
                readOnly={locked}
                value={playerDocument(reg, d.id)}
                onApprove={() => approveDoc(d.id)}
                onReject={(reason) => rejectDoc(d.id, reason)}
              />
            ))}
          </DocumentReviewTable>
        </>
      ) : (
        <>
          <DemoDocuments entryId={entry.id} role="player" fullName={`${entry.firstName} ${entry.lastName}`} approved={entry.approved} flags={entry.flags} readOnly={locked} />
        </>
      )}
    </DocumentsPanel>
    {!isSelf && <ComplianceFlagsSection flags={entry.flags} onClearAndApprove={approveFlagged} />}
    </>
  );

  return (
    <AdminEntityDetailsLayout
      backLabel="Players"
      onBack={() => router.push('/admin/players')}
      header={{
        name: `${entry.firstName} ${entry.lastName}`,
        subtitle: entry.teamName || 'No team assigned',
        initials: initialsOf(entry.firstName, entry.lastName),
        photoUrl: entry.photoUrl || undefined,
        roleLabel: 'Player',
        registration,
        payment: isSelf ? (reg.payment.status === 'success' ? 'complete' : reg.payment.status === 'failed' ? 'failed' : 'incomplete') : entry.paymentComplete ? 'complete' : 'incomplete',
        flags,
        compliance,
        accessDisabled: entry.disabled,
        onToggleAccess: toggleAccess
      }}
      sections={isSelf ? playerSections(reg, entry, age) : rosterOnlySections(entry, age)}
      documents={documents}
      activity={mergeAudit(isSelf ? playerAuditEvents(reg) : [], adminEventsToAudit(logged))}
      activityEmptyMessage="No activity recorded yet. Document decisions and access changes made on this page will appear here."
    />
  );
}
