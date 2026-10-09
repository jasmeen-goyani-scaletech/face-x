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
});
