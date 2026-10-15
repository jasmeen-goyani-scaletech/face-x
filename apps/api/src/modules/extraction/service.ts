import type { Logger } from 'pino';
import {
  EXTRACTABLE_MIME_TYPES,
  type DocumentExtractor,
  type ExtractableMimeType,
  type ExtractionFailureReason,
  type ExtractionOutcome,
} from '../../infrastructure/extraction/document-extractor';
import { withDeadline } from '../../infrastructure/face/deadline';
import { sniffContentType } from '../../infrastructure/storage/content-sniffing';
import type { ObjectReader } from '../../infrastructure/storage/object-reader';
import { AppError } from '../../shared/errors/app-error';
import { safeCause } from '../../shared/utils/scrub';
import type { AuthContext } from '../auth/types';
import { EXTRACTION_FIELDS } from './fields';
import { compareWithProfile } from './matching';
import type { ExtractionRepository } from './repository';
import type { ExtractionResultDto } from './types';
import { verdictOf } from './verdict';

/** The provider and its limits. Absent (or no storage reader): extraction answers 503. */
export interface DocumentExtractionConfig {
  extractor: DocumentExtractor;
  /** Deadline for one provider call. */
  timeoutMs: number;
  /** Largest file read back from storage (DOCUMENT_MAX_BYTES). */
  maxBytes: number;
}

export interface ExtractionService {
  extract(ctx: AuthContext, documentId: string): Promise<ExtractionResultDto>;
}

export interface ExtractionServiceDeps {
  repository: ExtractionRepository;
  config?: DocumentExtractionConfig;
  reader?: ObjectReader;
  logger: Logger;
}

class ExtractionTimeout extends Error {}

const docNotFound = () => AppError.notFound('DOCUMENT_NOT_FOUND', 'Document not found');

/**
 * Reads the configured fields off one uploaded document with the AI provider and compares them with the profile on record.
 *
 * Access is that of reading the document: the owner (the player or a linked guardian; the coach or staff member), or an
 * ADMIN of the organization that owns the event once the document has been submitted. Everyone else gets 404.
 *
 * Nothing is stored and nothing extracted is logged: the log line carries the outcome, model, duration and token counts.
 */
export function createExtractionService({
  repository,
  config,
  reader,
  logger,
}: ExtractionServiceDeps): ExtractionService {
  const isAdminOf = (ctx: AuthContext, organizationId: string) =>
    ctx.roles.includes('ADMIN') &&
    ctx.organizationId !== null &&
    ctx.organizationId === organizationId;

  return {
    async extract(ctx, documentId) {
      const target = await repository.findTarget(documentId, ctx.userId);
      if (!target) throw docNotFound();
      const adminView = isAdminOf(ctx, target.eventOrganizationId) && target.submitted;
      if (!target.isOwner && !adminView) throw docNotFound();

      if (!target.uploaded) {
        throw AppError.conflict('UPLOAD_NOT_COMPLETE', 'The file has not been uploaded yet');
      }
      const specs = EXTRACTION_FIELDS[target.documentType];
      if (specs.length === 0) {
        throw new AppError(
          422,
          'DOCUMENT_NOT_EXTRACTABLE',
          'Fields cannot be extracted from this document type',
        );
      }
      if (!config || !reader) {
        throw AppError.unavailable(
          'EXTRACTION_NOT_CONFIGURED',
          'Document extraction is not configured',
        );
      }

      const started = Date.now();
      const finish = (outcome: ExtractionOutcome): ExtractionResultDto => {
        const base = { documentId, documentType: target.documentType };
        // A document from which nothing at all could be read is a failed read, not a set of NOT_FOUNDs.
        const nothingRead = outcome.ok && Object.values(outcome.fields).every((v) => v === null);
        const failureReason: ExtractionFailureReason | undefined = !outcome.ok
          ? outcome.reason
          : nothingRead
            ? 'UNREADABLE'
            : undefined;
        logger.info(
          {
            documentId,
            documentType: target.documentType,
            status: failureReason ? 'FAILED' : 'SUCCEEDED',
            failureReason,
            model: outcome.ok ? outcome.model : undefined,
            durationMs: Date.now() - started,
            inputTokens: outcome.ok ? outcome.usage?.inputTokens : undefined,
            outputTokens: outcome.ok ? outcome.usage?.outputTokens : undefined,
          },
          'Document extraction',
        );
        if (!outcome.ok || failureReason) {
          return {
            ...base,
            status: 'FAILED',
            failureReason,
            fields: {},
            derived: {},
            model: outcome.ok ? outcome.model : null,
            verdict: verdictOf(failureReason, {}),
          };
        }
        const compared = compareWithProfile(specs, outcome.fields, target.profile);
        return {
          ...base,
          status: 'SUCCEEDED',
          ...compared,
          model: outcome.model,
          verdict: verdictOf(undefined, compared.fields),
        };
      };

      // Read outside any transaction: a slow provider call must not hold a database connection.
      const stored = await reader
        .read(target.storageKey, { maxBytes: config.maxBytes })
        .catch((e: unknown) => {
          const err = AppError.unavailable('STORAGE_UNAVAILABLE', 'File storage is unavailable');
          (err as { cause?: unknown }).cause = safeCause(e);
          throw err;
        });
      if (!stored.exists) {
        throw AppError.conflict('UPLOAD_NOT_COMPLETE', 'The file is not available');
      }
      // The owner's own check is what the API remembers: a document the AI read and accepted may be approved without an admin
      // (see the documents service). Anything else, including a check that could not run, clears it.
      const record = async (result: ExtractionResultDto): Promise<ExtractionResultDto> => {
        if (target.isOwner) {
          await repository
            .setAiAccepted(documentId, result.status === 'SUCCEEDED' && result.verdict.accepted)
            .catch((e: unknown) => logger.error({ err: safeCause(e), documentId }, 'Could not record the AI check'));
        }
        return result;
      };
      // Too large (the limit was lowered after upload) or not a type the provider reads: shown as a failed read.
      const mimeType = stored.tooLarge ? null : sniffContentType(stored.bytes, target.mimeType);
      if (
        stored.tooLarge ||
        !mimeType ||
        !(EXTRACTABLE_MIME_TYPES as readonly string[]).includes(mimeType)
      ) {
        return record(finish({ ok: false, reason: 'UNSUPPORTED' }));
      }

      const outcome = await withDeadline(
        config.timeoutMs,
        (signal) =>
          config.extractor.extract({
            bytes: stored.bytes,
            mimeType: mimeType as ExtractableMimeType,
            fields: specs,
            signal,
          }),
        () => new ExtractionTimeout(),
      ).catch((e: unknown): ExtractionOutcome => {
        if (e instanceof ExtractionTimeout) return { ok: false, reason: 'TIMEOUT' };
        // An adapter should not throw; if one does, its scrubbed error is logged and the call is a failed read.
        logger.error({ err: safeCause(e), documentId }, 'Document extractor threw');
        return { ok: false, reason: 'PROVIDER_ERROR' };
      });
      return record(finish(outcome));
    },
  };
}
