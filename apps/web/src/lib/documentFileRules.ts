// The rules every document upload follows, kept free of imports so they can be unit-tested on their own.

/** No document may be larger than this, whatever its type (the API enforces the same limit). */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** What a document upload accepts: images (PNG, JPG, JPEG, WebP), PDFs and Word files (DOC, DOCX). */
export const ALLOWED_DOCUMENT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'doc', 'docx'] as const;
export const DOCUMENT_MIME_BY_EXTENSION: Record<(typeof ALLOWED_DOCUMENT_EXTENSIONS)[number], string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const ALLOWED_DOCUMENT_MIME_TYPES = new Set(Object.values(DOCUMENT_MIME_BY_EXTENSION));
/** The file picker's `accept` list: image/*, PDF and Word. */
export const DOCUMENT_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', ...ALLOWED_DOCUMENT_EXTENSIONS.map((e) => `.${e}`), 'application/msword', DOCUMENT_MIME_BY_EXTENSION.docx].join(',');

const extensionOf = (name: string) => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/**
 * The type a document is sent as. The browser's own type is used when it is one we accept; otherwise the extension decides
 * (browsers often report nothing for .doc / .docx). Null when the file is not an accepted kind.
 */
export function documentMimeType(file: { name: string; type: string }): string | null {
  if (ALLOWED_DOCUMENT_MIME_TYPES.has(file.type)) return file.type;
  const ext = extensionOf(file.name) as keyof typeof DOCUMENT_MIME_BY_EXTENSION;
  return DOCUMENT_MIME_BY_EXTENSION[ext] ?? null;
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns a precise, user-facing message if the file can't be accepted, else null. */
export function validateDocumentFile(file: File): string | null {
  if (!documentMimeType(file)) return `“${file.name}” isn’t a supported file type. Upload a PNG, JPG, WebP, PDF, DOC or DOCX file.`;
  if (file.size === 0) return `“${file.name}” is empty. Choose a different file.`;
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `“${file.name}” is ${formatFileSize(file.size)}. Files must be ${formatFileSize(MAX_DOCUMENT_BYTES)} or smaller.`;
  }
  return null;
}
