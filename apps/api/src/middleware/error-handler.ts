import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError, type ErrorDetail } from '../shared/errors/app-error';

export interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: ErrorDetail[] };
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound('ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

/** The single place that turns any thrown value into the standard error envelope. Never leaks internals. */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appError = toAppError(err);

    if (appError.status >= 500) {
      // Log the original error (stack included) server-side only; the client gets the generic message.
      logger.error({ err, method: req.method, path: req.path }, 'Request failed');
    }

    const body: ErrorBody = {
      success: false,
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
      },
    };
    if (appError.status === 401) res.set('WWW-Authenticate', 'Bearer');
    res.status(appError.status).json(body);
  };
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return AppError.validation(
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  // body-parser errors carry an HTTP status and a `type`.
  const status = (err as { status?: unknown } | null)?.status;
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') {
    return AppError.badRequest('INVALID_JSON', 'Request body is not valid JSON');
  }
  if (type === 'entity.too.large' || status === 413) {
    return AppError.badRequest('PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong');
}
