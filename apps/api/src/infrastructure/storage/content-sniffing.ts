/**
 * Identifies a file type from its first bytes ("magic numbers"), so a client cannot upload an executable or
 * HTML page while declaring `image/png`. Only the types the platform accepts are recognized; anything else is
 * `null`. This is a content check, not a malware scan.
 */
export type SniffedType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/msword';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOC = 'application/msword';

/** Bytes needed to tell every supported type apart. */
export const SNIFF_BYTES = 12;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

/**
 * `declared` is the type the client claimed. A DOCX is a ZIP archive and its first bytes cannot tell it from any other
 * ZIP, so a ZIP header counts as DOCX only when DOCX was declared, and is `null` otherwise (an arbitrary .zip is never
 * accepted).
 */
export function sniffContentType(bytes: Uint8Array, declared?: string): SniffedType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8) // WEBP
  ) {
    return 'image/webp';
  }
  if (declared === DOCX && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return DOCX; // PK\x03\x04
  // An OLE2 compound file: .xls and .ppt share the header, so it counts as .doc only when .doc was declared.
  if (declared === DOC && startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return DOC;
  }
  return null;
}
