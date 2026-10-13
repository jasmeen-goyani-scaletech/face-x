import type { RequestHandler } from 'express';
import { AppError } from '../shared/errors/app-error';

/**
 * CSRF defence for endpoints that act on a cookie (refresh, logout). Browsers always send `Origin` on
 * cross-site POSTs, so a present-but-foreign Origin is refused. A request with no Origin (curl, server to
 * server) is allowed: it cannot be a cross-site browser request, and it still needs the cookie value.
 */
export function requireTrustedOrigin(allowedOrigins: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      throw AppError.forbidden('Origin not allowed', 'ORIGIN_NOT_ALLOWED');
    }
    next();
  };
}
