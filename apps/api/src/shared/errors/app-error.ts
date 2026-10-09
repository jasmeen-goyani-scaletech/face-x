export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

export interface ErrorDetail {
  path: string;
  message: string;
}

/** An error whose message is safe to show a client. Anything that is not an AppError is reported as a 500. */
export class AppError extends Error {
  constructor(
    public readonly status: ErrorStatus,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(code: string, message: string) {
    return new AppError(400, code, message);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }
  static forbidden(message = 'You do not have access to this resource', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }
  static notFound(code: string, message: string) {
    return new AppError(404, code, message);
  }
  static conflict(code: string, message: string) {
    return new AppError(409, code, message);
  }
  static validation(details: ErrorDetail[], message = 'Request validation failed') {
    return new AppError(422, 'VALIDATION_ERROR', message, details);
  }
  static tooManyRequests(message = 'Too many requests, try again later') {
    return new AppError(429, 'RATE_LIMITED', message);
  }
  static unavailable(code: string, message: string) {
    return new AppError(503, code, message);
  }
}
