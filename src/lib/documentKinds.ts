/** What a document *is*, so every upload and review row shows the same type icon for it. */
export type DocumentKind = 'document' | 'certificate' | 'id' | 'safety' | 'photo';

const KIND_BY_DOCUMENT: Record<string, DocumentKind> = {
  birthCertificate: 'document',
  schoolTranscript: 'document',
  schoolId: 'id',
  californiaKidId: 'id',
  firstAidCpr: 'certificate',
  yalfTackle: 'certificate',
  backgroundCheckRef: 'safety',
  safeSportUpload: 'safety',
  profilePhoto: 'photo',
  livePhoto: 'photo'
};

/** Unknown ids fall back to a plain document. */
export function documentKind(documentId: string): DocumentKind {
  return KIND_BY_DOCUMENT[documentId] ?? 'document';
}

/** Human names for document ids, for places that only have the id (e.g. the audit trail). */
export const DOCUMENT_LABELS: Record<string, string> = {
  profilePhoto: 'Face-X identification photo',
  livePhoto: 'Live photo',
  birthCertificate: 'Birth Certificate',
  schoolId: 'School ID',
  schoolTranscript: 'School Transcript',
  californiaKidId: 'California Kid ID / Government Photo ID',
  firstAidCpr: 'First Aid / CPR Certificate',
  yalfTackle: 'YALF Tackle Certificate',
  backgroundCheckRef: 'Background check',
  safeSportUpload: 'Safe-Sport compliance upload'
};
