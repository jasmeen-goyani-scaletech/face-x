import type {
  DocumentExtractor,
  ExtractRequest,
  ExtractionOutcome,
} from '../../src/infrastructure/extraction/document-extractor';

/**
 * A stand-in extractor whose answer is decided by markers in the document's bytes, so each test's "file" says what
 * the provider does with it:
 *   SLOW        never answers; resolves only when the call is aborted (deadline)
 *   UNREADABLE  { ok: false, reason: 'UNREADABLE' }
 *   EXPLODE     throws (an adapter bug), with a secret-looking text
 *   FIELDS:{...}\n   returns those fields (missing keys are null)
 * Anything else returns every requested field as null.
 */
export function createFakeExtractor() {
  const calls: Pick<ExtractRequest, 'mimeType' | 'fields'>[] = [];
  const extractor: DocumentExtractor = {
    name: 'fake',
    async extract({ bytes, mimeType, fields, signal }): Promise<ExtractionOutcome> {
      calls.push({ mimeType, fields });
      const text = Buffer.from(bytes).toString('latin1');
      if (text.includes('SLOW')) {
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
        return { ok: false, reason: 'TIMEOUT' };
      }
      if (text.includes('UNREADABLE')) return { ok: false, reason: 'UNREADABLE' };
      if (text.includes('EXPLODE'))
        throw new Error('provider blew up with sk-proj-ABCDEFGHIJKLMNOPQRSTUV');
      const json = /FIELDS:(\{[^\n]*\})\n/.exec(text)?.[1];
      const given = json ? (JSON.parse(json) as Record<string, string | null>) : {};
      return {
        ok: true,
        fields: Object.fromEntries(fields.map((f) => [f.key, given[f.key] ?? null])),
        model: 'fake-model-1',
        usage: { inputTokens: 1200, outputTokens: 80 },
      };
    },
  };
  return { extractor, calls };
}

/** A file of the given type whose bytes carry an instruction for the fake extractor. */
export function markedFile(head: number[], marker: string, size = 2048): Uint8Array {
  const body = [...head, ...Buffer.from(` ${marker}\n`, 'latin1')];
  return Uint8Array.from([...body, ...new Array(Math.max(0, size - body.length)).fill(0x20)]);
}
