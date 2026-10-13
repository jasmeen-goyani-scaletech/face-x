/**
 * Provider-independent boundary for face recognition. The rest of the application depends on this interface only;
 * a real provider (AWS Rekognition, Azure Face, a self-hosted model...) is one adapter file that implements it,
 * with its own SDK and request/response types kept inside that file.
 *
 * Privacy rules for every implementation:
 *  - the provider holds the biometric template/identity; this application keeps only the opaque `reference`
 *    returned by enroll(), never an image, template or embedding;
 *  - nothing from an image, a reference or a provider credential may be logged or put in an error message;
 *  - `subjectId` is our internal player id: the provider is never given a name, date of birth or any other
 *    personal data.
 */
export type FaceImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** What an enrolled person is to the application. The provider may tag the template with it; it takes no part in matching. */
export type FaceSubjectRole = 'PLAYER' | 'STAFF' | 'COACH';

export interface FaceImage {
  bytes: Uint8Array;
  mimeType: FaceImageType;
}

/** Every call can be cancelled; implementations should stop work and reject when the signal aborts. */
interface Cancellable {
  signal?: AbortSignal;
}

export interface EnrollRequest extends Cancellable {
  /** Our player id, an opaque external id for the provider. No personal data. */
  subjectId: string;
  image: FaceImage;
  /** Stable per attempt, so a retried call cannot create a second identity at the provider. */
  idempotencyKey: string;
  /** Tags the provider's template with the person's role. Adapters that have no use for it ignore it. */
  role?: FaceSubjectRole;
}

export interface EnrollResult {
  /** The provider's opaque identifier for the enrolled face. Never shown to clients. */
  reference: string;
}

export interface IdentifyRequest extends Cancellable {
  image: FaceImage;
  /** The event being scanned for. A provider that keeps the scanned frame files it under this event. */
  eventId?: string;
  /** At most this many candidates, best first. */
  maxCandidates: number;
}

export interface FaceCandidate {
  /** A reference previously returned by enroll(). */
  reference: string;
  /**
   * 0 to 1, higher is more similar. The ADAPTER normalizes whatever scale its provider uses into this range, so the
   * application never sees provider-specific scores. The decision threshold is application policy, not the provider's.
   */
  similarity: number;
}

export interface IdentifyResult {
  candidates: FaceCandidate[];
  /**
   * Where the provider stored the scanned frame, when it kept one. An address in the provider's storage; the
   * application records it with the scan and never reads the image itself.
   */
  scanImageUrl?: string | null;
}

export interface VerifyRequest extends Cancellable {
  reference: string;
  image: FaceImage;
}

export interface VerifyResult {
  /** Same 0 to 1 scale as FaceCandidate.similarity. */
  similarity: number;
}

export type FaceProviderErrorCode =
  /** The image has no detectable face. A property of the image, not an outage. */
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES'
  | 'LOW_QUALITY'
  /** The provider refused the request for another input reason. */
  | 'IMAGE_REJECTED'
  /** The provider or the network failed. Retrying later may work. */
  | 'UNAVAILABLE'
  | 'TIMEOUT';

/** The only error type an implementation should throw on purpose. Its message must be safe to log. */
export class FaceProviderError extends Error {
  constructor(
    public readonly code: FaceProviderErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'FaceProviderError';
  }
}

/** Reasons that are about the image (the user can fix them), as opposed to provider outages. */
export const IMAGE_PROBLEM_CODES: readonly FaceProviderErrorCode[] = [
  'NO_FACE_DETECTED',
  'MULTIPLE_FACES',
  'LOW_QUALITY',
  'IMAGE_REJECTED',
];

export interface FaceRecognitionProvider {
  /** Short stable name stored with each profile (e.g. "rekognition"). Not a secret. */
  readonly name: string;
  enroll(request: EnrollRequest): Promise<EnrollResult>;
  /** Deletes the identity at the provider. MUST succeed (not throw) when it is already gone, so removal can be retried. */
  remove(reference: string, options?: Cancellable): Promise<void>;
  /** 1:N search over everything enrolled. Not used until event-day matching. */
  identify(request: IdentifyRequest): Promise<IdentifyResult>;
  /** 1:1 comparison against one enrolled identity. Not used until event-day matching. */
  verify(request: VerifyRequest): Promise<VerifyResult>;
}
