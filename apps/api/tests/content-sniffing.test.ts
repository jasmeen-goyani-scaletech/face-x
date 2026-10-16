import { describe, expect, it } from 'vitest';
import { sniffContentType } from '../src/infrastructure/storage/content-sniffing';
import { fileBytes } from './helpers/fake-storage';

describe('sniffContentType', () => {
  it('recognizes the accepted file types from their first bytes', () => {
    expect(sniffContentType(fileBytes.pdf())).toBe('application/pdf');
    expect(sniffContentType(fileBytes.png())).toBe('image/png');
    expect(sniffContentType(fileBytes.jpeg())).toBe('image/jpeg');
    expect(sniffContentType(fileBytes.webp())).toBe('image/webp');
  });

  it('returns null for everything else, including executables, HTML and truncated or empty input', () => {
    for (const bytes of [
      fileBytes.html(),
      fileBytes.exe(),
      new Uint8Array(),
      Uint8Array.from([0x25, 0x50]),
      Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]),
    ]) {
      expect(sniffContentType(bytes)).toBeNull();
    }
  });

  it('recognizes DOCX (a ZIP) only when DOCX was declared, and a legacy .doc only when .doc was declared', () => {
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(sniffContentType(fileBytes.docx(), DOCX)).toBe(DOCX);
    expect(sniffContentType(fileBytes.docx())).toBeNull();
    expect(sniffContentType(fileBytes.docx(), 'application/zip')).toBeNull();
    expect(sniffContentType(fileBytes.doc(), DOCX)).toBeNull();
    expect(sniffContentType(fileBytes.doc(), 'application/msword')).toBe('application/msword');
    expect(sniffContentType(fileBytes.doc())).toBeNull();
    expect(sniffContentType(fileBytes.docx(), 'application/msword')).toBeNull();
    // A declared type never overrides a real signature.
    expect(sniffContentType(fileBytes.pdf(), DOCX)).toBe('application/pdf');
  });
});
