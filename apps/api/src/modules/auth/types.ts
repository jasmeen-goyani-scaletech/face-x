import type { Role } from '../users';

/** Who is making the request. Deliberately has no token and no credentials. */
export interface AuthContext {
  userId: string;
  email: string;
  fullName: string | null;
  organizationId: string | null;
  roles: Role[];
}

export interface MeResponse {
  id: string;
  email: string;
  fullName: string | null;
  organizationId: string | null;
  roles: Role[];
}

/** Returned by login and refresh. The refresh token goes into an HttpOnly cookie, never the JSON body. */
export interface Session {
  accessToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: MeResponse;
}

export type RotationResult =
  | { kind: 'ROTATED'; userId: string }
  | { kind: 'INVALID' }
  | { kind: 'EXPIRED' }
  /** An already-rotated token was presented: the whole token family has been revoked. */
  | { kind: 'REUSED' }
  | { kind: 'INACTIVE' };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      eventAccess?: import('../events/types').EventAccess;
    }
  }
}
