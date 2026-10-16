'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { checkDocument } from '@/lib/api/documents';
import { hasCode } from '@/lib/api/errors';
import type { ApiDocument, ApiDocumentType } from '@/lib/api/types';

/**
 * The AI check that follows every document upload (never the profile photo, which has nothing to read), shared by the player,
 * coach and staff wizards.
 *
 *  - A document the AI accepts passes.
 *  - The first time the AI turns a document down, `review` returns its message to show. The document is held back
 *    (`isBlocked`) until it is replaced, so the person cannot continue with it.
 *  - After that, a rejection is silent: the person goes on as if the document had passed, and it is remembered as AI-rejected
 *    (`aiRejected`) so it can be sent with the document when it is submitted for review.
 *
 * A check that cannot run (offline, rate-limited, provider down) is not a rejection and counts for nothing. The counts live in
 * this component's state only: a reload starts them again.
 */
/** The server answered EXTRACTION_NOT_CONFIGURED: the feature is off there, so stop asking for the rest of the session (as the API guide says). */
let extractionOff = false;

export function useAiDocumentCheck() {
  /** Times the AI has turned down a document of each type. */
  const rejections = useRef(new Map<ApiDocumentType, number>());
  const flagged = useRef(new Set<ApiDocumentType>());
  /** Types whose earlier upload an admin rejected: the new file replaces it and goes straight to staff review, with no AI check. */
  const adminRejected = useRef(new Set<ApiDocumentType>());
  const [blocked, setBlocked] = useState<ReadonlySet<ApiDocumentType>>(new Set());

  const setBlockedFor = useCallback((type: ApiDocumentType, on: boolean) => {
    setBlocked((prev) => {
      if (prev.has(type) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(type);
      else next.delete(type);
      return next;
    });
  }, []);

  /** Runs the check on a freshly uploaded document. Resolves with the message to show the person, or null to carry on. */
  const review = useCallback(
    async (document: ApiDocument): Promise<string | null> => {
      const type = document.documentType;
      if (type === 'PROFILE_PHOTO' || extractionOff || adminRejected.current.has(type)) return null;
      const verdict = await checkDocument(document.id).then(
        (r) => r.verdict,
        (e) => {
          if (hasCode(e, 'EXTRACTION_NOT_CONFIGURED')) extractionOff = true;
          return null;
        }
      );
      if (!verdict || verdict.accepted) {
        flagged.current.delete(type);
        setBlockedFor(type, false);
        return null;
      }
      const earlier = rejections.current.get(type) ?? 0;
      rejections.current.set(type, earlier + 1);
      if (earlier === 0) {
        setBlockedFor(type, true);
        return verdict.message ?? 'This document was not accepted. Please upload a clearer or correct copy.';
      }
      // The second rejection: no message, the person goes on, and the reviewer is told.
      flagged.current.add(type);
      setBlockedFor(type, false);
      return null;
    },
    [setBlockedFor]
  );

  /** Whether this type was turned down twice, i.e. must be submitted with `aiRejected`. */
  const aiRejected = useCallback((type: ApiDocumentType) => flagged.current.has(type), []);

  /** Call with the registration's documents each time they are loaded, so a replacement of a rejected one is recognised. Only ever adds. */
  const noteRejected = useCallback((documents: ApiDocument[]) => {
    for (const d of documents) if (d.state === 'REJECTED') adminRejected.current.add(d.documentType);
  }, []);

  /** Whether an admin rejected an earlier file of this type, i.e. a file uploaded now is its replacement. */
  const replacesRejected = useCallback((type: ApiDocumentType) => adminRejected.current.has(type), []);

  return useMemo(() => ({ review, aiRejected, noteRejected, replacesRejected, blocked }), [review, aiRejected, noteRejected, replacesRejected, blocked]);
}
