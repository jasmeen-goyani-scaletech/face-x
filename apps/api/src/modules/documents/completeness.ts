import {
  REQUIRED_DOCUMENT_TYPES,
  type CompletenessState,
  type DocumentCompleteness,
  type DocumentDto,
  type DocumentRegistrantType,
  type DocumentType,
} from './types';

/**
 * Where the required documents stand, per type, using the newest document of each type. A leaf module (no
 * database, no other module): the documents API and registration readiness both use this single definition of
 * which documents are required (it depends on who is registering) and what "approved" means.
 */
export function completenessOf(
  documents: readonly Pick<DocumentDto, 'documentType' | 'state' | 'createdAt'>[],
  registrantType: DocumentRegistrantType = 'PLAYER',
): DocumentCompleteness {
  const newest = new Map<DocumentType, Pick<DocumentDto, 'documentType' | 'state' | 'createdAt'>>();
  for (const d of documents) {
    const current = newest.get(d.documentType);
    if (!current || d.createdAt > current.createdAt) newest.set(d.documentType, d);
  }
  const required = REQUIRED_DOCUMENT_TYPES[registrantType].map((documentType) => ({
    documentType,
    state: (newest.get(documentType)?.state ?? 'MISSING') as CompletenessState,
  }));
  return { required, allRequiredApproved: required.every((r) => r.state === 'APPROVED') };
}
