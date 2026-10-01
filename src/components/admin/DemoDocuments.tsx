'use client';

import { useMemo, useState } from 'react';
import DocumentReviewRow from './DocumentReviewRow';
import DocumentReviewTable from './DocumentReviewTable';
import { RefreshIcon } from '@/components/ui/Icons';
import { DEMO_DOCUMENTS_KEY, DEMO_MODE, DEMO_RESET_KEY } from '@/lib/demo/config';
import { DEMO_DOCUMENT_DEFS, buildMockFile, isMockProvided } from '@/lib/demo/mockDocuments';
import { clearAdminEvents } from '@/lib/adminEvents';
import { clearNotificationOutbox, type DocumentSubjectType } from '@/lib/documentVerification';
import { useLocalStorage } from '@/lib/storage';
import { emptyFile, type ReviewStatus, type UploadedFile } from '@/lib/types';

/** Persisted review state per roster entry per document. The sample files themselves are regenerated, never stored. */
type DemoStates = Record<string, Record<string, { review: ReviewStatus; reason?: string }>>;

/** Clears everything a demo run leaves behind (review decisions and recorded notifications). */
export function resetDemoState() {
  try {
    window.localStorage.removeItem(DEMO_DOCUMENTS_KEY);
    window.localStorage.setItem(DEMO_RESET_KEY, 'true');
  } catch {
    // ignore
  }
  clearNotificationOutbox();
  clearAdminEvents();
}

/** Subtle control to put every document back to PENDING_REVIEW for the next walkthrough. Demo Mode only. */
export function DemoResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="inline-flex items-center gap-1.5 rounded-s px-2 py-1 text-[12px] font-semibold text-ink-faint hover:bg-surface-2 hover:text-ink"
    >
      <RefreshIcon size={13} /> Reset Demo State
    </button>
  );
}

/**
 * Documents for a seeded roster entry, which has no registration record behind it. Stands in for the records an API would
 * return: realistic sample files (photo, certificate, PDF) that can always be previewed and reviewed. Each starts in the
 * status the person's own record implies (approved people get approved documents; a "document" flag or a pending
 * person means pending review). Only the reset control and notification previews are Demo Mode extras.
 */
export default function DemoDocuments({
  entryId,
  role,
  fullName,
  approved,
  flags,
  readOnly = false
}: {
  entryId: string;
  role: DocumentSubjectType;
  fullName: string;
  approved: boolean;
  flags: string[];
  /** Locked record: rows offer Preview only. */
  readOnly?: boolean;
}) {
  const [states, setStates] = useLocalStorage<DemoStates>(DEMO_DOCUMENTS_KEY, {});
  const [allPending, setAllPending] = useLocalStorage<boolean>(DEMO_RESET_KEY, false);
  const [runId, setRunId] = useState(0); // bumping this remounts the rows, clearing their notification previews

  // Optional documents are omitted for some people, so empty slots are exercised too.
  const samples = useMemo(
    () => DEMO_DOCUMENT_DEFS[role].map((def) => ({ def, base: isMockProvided(def, fullName) ? buildMockFile(def, fullName) : emptyFile() })),
    [role, fullName]
  );

  // Approved people have approved documents unless their record flags a document problem.
  const hasDocumentFlag = flags.some((f) => /document/i.test(f));
  const defaultReview: ReviewStatus = !allPending && approved && !hasDocumentFlag ? 'approved' : 'pending';

  function setReview(docId: string, review: ReviewStatus, reason = '') {
    setStates((prev) => ({ ...prev, [entryId]: { ...prev[entryId], [docId]: { review, reason } } }));
  }

  function reset() {
    resetDemoState();
    setStates({});
    setAllPending(true);
    setRunId((n) => n + 1);
  }

  const files: UploadedFile[] = samples.map(({ def, base }) => {
    const saved = states[entryId]?.[def.id];
    return base.uploaded ? { ...base, review: saved?.review ?? defaultReview, reason: saved?.reason ?? '' } : base;
  });

  return (
    <div>
      {DEMO_MODE && (
        <div className="mb-1 flex justify-end">
          <DemoResetButton onReset={reset} />
        </div>
      )}
      <DocumentReviewTable files={files}>
        {samples.map(({ def }, i) => (
          <DocumentReviewRow
            key={`${runId}-${def.id}`}
            label={def.label}
            subtitle={def.required ? 'Required' : 'Optional'}
            documentId={def.id}
            subject={{ type: role, id: entryId }}
            readOnly={readOnly}
            value={files[i]}
            onApprove={() => setReview(def.id, 'approved')}
            onReject={(reason) => setReview(def.id, 'rejected', reason)}
          />
        ))}
      </DocumentReviewTable>
    </div>
  );
}
