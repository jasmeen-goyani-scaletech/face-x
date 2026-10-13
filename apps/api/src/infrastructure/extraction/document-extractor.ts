/**
 * Provider-independent boundary for reading fields off an uploaded document (OCR by a language model). The rest of the
 * application depends on this interface only; a provider is one adapter file under `providers/`, with its SDK and
 * request/response types kept inside it.
 *
 * Privacy rules for every implementation:
 *  - the document is sent for this one call and must not be stored by the provider where that can be switched off;
 *  - nothing from the document, the extracted values or a credential may be logged or put in an error message.
 */
export type ExtractableMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

export const EXTRACTABLE_MIME_TYPES: readonly ExtractableMimeType[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  DOCX_MIME_TYPE,
];

/** One value to read. The key is what the caller gets back; the description is what the model is told to look for. */
export interface FieldSpec {
  key: string;
  description: string;
  /** Dates come back as YYYY-MM-DD. */
  kind: 'name' | 'date' | 'text';
}

export interface ExtractRequest {
  bytes: Uint8Array;
  /** Sniffed from the bytes, not the client's claim. The uploaded file name is never sent (it often holds a name). */
  mimeType: ExtractableMimeType;
  fields: readonly FieldSpec[];
  /** Implementations must stop and resolve (not hang) when this aborts. */
  signal?: AbortSignal;
}

export type ExtractionFailureReason =
  /** The provider could read the file but not the document on it (blurry, blank, refused). */
  | 'UNREADABLE'
  /** The provider cannot take this kind of file. */
  | 'UNSUPPORTED'
  | 'TIMEOUT'
  /** The provider or the network failed. Retrying later may work. */
  | 'PROVIDER_ERROR';

export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ExtractionOutcome =
  | {
      ok: true;
      /** One entry per requested key: the raw printed value, or null when it is absent or illegible. */
      fields: Record<string, string | null>;
      model: string;
      usage?: ExtractionUsage;
    }
  | { ok: false; reason: ExtractionFailureReason };

export interface DocumentExtractor {
  /** Short stable name (e.g. "openai"). Not a secret. */
  readonly name: string;
  /** Never throws for an expected failure: those are `{ ok: false }`. */
  extract(request: ExtractRequest): Promise<ExtractionOutcome>;
}
