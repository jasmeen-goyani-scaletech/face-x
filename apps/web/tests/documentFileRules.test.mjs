import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOCUMENT_ACCEPT, MAX_DOCUMENT_BYTES, documentMimeType, validateDocumentFile } from '../src/lib/documentFileRules.ts';

const file = (name, type, size = 1000) => ({ name, type, size });

describe('document file rules', () => {
  it('accepts images, PDFs and Word files, by type or by extension', () => {
    for (const [name, type] of [
      ['a.png', 'image/png'],
      ['a.jpg', 'image/jpeg'],
      ['a.jpeg', 'image/jpeg'],
      ['a.webp', 'image/webp'],
      ['a.pdf', 'application/pdf'],
      ['a.doc', 'application/msword'],
      ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      // Browsers often report no type for Word files: the extension decides.
      ['a.doc', ''],
      ['A.DOCX', '']
    ]) {
      assert.equal(validateDocumentFile(file(name, type)), null, `${name} (${type})`);
    }
  });

  it('sends a file as the type its extension names when the browser reported none', () => {
    assert.equal(documentMimeType(file('x.docx', '')), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(documentMimeType(file('x.doc', 'application/octet-stream')), 'application/msword');
  });

  it('refuses other kinds of file before anything is uploaded', () => {
    for (const [name, type] of [
      ['run.exe', 'application/x-msdownload'],
      ['page.html', 'text/html'],
      ['logo.svg', 'image/svg+xml'],
      ['sheet.xlsx', 'application/vnd.ms-excel'],
      ['archive.zip', 'application/zip'],
      ['noextension', '']
    ]) {
      assert.match(validateDocumentFile(file(name, type)) ?? '', /isn’t a supported file type/, name);
    }
  });

  it('allows up to 5 MB and refuses anything larger, or empty', () => {
    assert.equal(MAX_DOCUMENT_BYTES, 5 * 1024 * 1024);
    assert.equal(validateDocumentFile(file('a.pdf', 'application/pdf', MAX_DOCUMENT_BYTES)), null);
    assert.match(validateDocumentFile(file('a.pdf', 'application/pdf', MAX_DOCUMENT_BYTES + 1)) ?? '', /5\.0 MB or smaller/);
    assert.match(validateDocumentFile(file('a.png', 'image/png', 12 * 1024 * 1024)) ?? '', /smaller/);
    assert.match(validateDocumentFile(file('a.png', 'image/png', 0)) ?? '', /is empty/);
  });

  it('offers the same kinds in the file picker', () => {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.doc', '.docx']) assert.ok(DOCUMENT_ACCEPT.split(',').includes(ext), ext);
  });
});
