import { isIP } from 'node:net';
import type { Request } from 'express';

/** What an audit entry records about the HTTP request. Never headers, bodies or tokens. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function getRequestMeta(req: Request): RequestMeta {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip && isIP(req.ip) ? req.ip : null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
  };
}
