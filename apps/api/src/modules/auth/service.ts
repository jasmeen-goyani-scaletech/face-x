import { randomUUID } from 'node:crypto';
import type { PasswordHasher } from '../../infrastructure/auth/password';
import {
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  type AccessTokenService,
} from '../../infrastructure/auth/tokens';
import { AppError } from '../../shared/errors/app-error';
import type { UserRepository } from '../users';
import type { AuthRepository } from './repository';
import { bearerHeaderSchema } from './schema';
import type { AuthContext, MeResponse, Session } from './types';

/**
 * Authentication only: who is this caller? What they may do is decided elsewhere (middleware roles,
 * modules/events access rules).
 */
export interface AuthService {
  register(input: { email: string; password: string; fullName?: string }): Promise<MeResponse>;
  /**
   * Public registration form: creates a passwordless guest account with its role and signs it in, in one step, so the
   * registrant never meets an account screen. 409 when the email already has an account (they sign in instead).
   */
  startGuestSession(input: { email: string; fullName?: string; role: string }): Promise<Session>;
  login(input: { email: string; password: string }): Promise<Session>;
  /** Rotates the refresh token: the presented one stops working, a new one is issued. */
  refresh(refreshToken: string | undefined): Promise<Session>;
  /** Ends the session the refresh token belongs to. Always succeeds, even for an unknown token. */
  logout(refreshToken: string | undefined): Promise<void>;
  /** Validates the Bearer access token and loads the caller. Never returns an anonymous user. */
  authenticate(authorizationHeader: string | undefined): Promise<AuthContext>;
  toMe(ctx: AuthContext): MeResponse;
}

export interface AuthServiceDeps {
  repository: AuthRepository;
  users: UserRepository;
  hasher: PasswordHasher;
  accessTokens: AccessTokenService;
  refreshTokenSecret: string;
  refreshTokenTtlDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const invalidCredentials = () =>
  AppError.unauthorized('Email or password is incorrect', 'INVALID_CREDENTIALS');

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { repository, users, hasher, accessTokens } = deps;
  const hash = (token: string) => hashRefreshToken(token, deps.refreshTokenSecret);
  const refreshExpiry = () => new Date(Date.now() + deps.refreshTokenTtlDays * DAY_MS);

  async function loadMe(userId: string): Promise<MeResponse> {
    const [profile, roles] = await Promise.all([users.findById(userId), users.findRoles(userId)]);
    if (!profile)
      throw AppError.forbidden('User profile has not been set up', 'USER_PROFILE_MISSING');
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      organizationId: profile.organizationId,
      roles,
    };
  }

  async function buildSession(
    userId: string,
    refreshToken: string,
    expiresAt: Date,
  ): Promise<Session> {
    const [accessToken, user] = await Promise.all([accessTokens.sign(userId), loadMe(userId)]);
    return {
      accessToken,
      expiresIn: accessTokens.ttlSeconds,
      refreshToken,
      refreshExpiresAt: expiresAt,
      user,
    };
  }

  return {
    async register({ email, password, fullName }) {
      const passwordHash = await hasher.hash(password);
      const created = await repository.createUserWithPassword({
        email,
        fullName: fullName ?? null,
        passwordHash,
      });
      if (!created)
        throw AppError.conflict(
          'EMAIL_ALREADY_REGISTERED',
          'An account with this email already exists',
        );
      // New accounts have no roles: roles are granted separately (onboarding / admin), never by signup.
      return {
        id: created.id,
        email: created.email,
        fullName: created.fullName,
        organizationId: created.organizationId,
        roles: [],
      };
    },

    async startGuestSession({ email, fullName, role }) {
      const created = await repository.createUserWithPassword({
        email,
        fullName: fullName ?? null,
        passwordHash: null,
        role,
      });
      if (!created)
        throw AppError.conflict(
          'EMAIL_ALREADY_REGISTERED',
          'An account with this email already exists. Sign in instead.',
        );
      const refreshToken = generateRefreshToken();
      const expiresAt = refreshExpiry();
      await repository.createRefreshToken({
        userId: created.id,
        familyId: randomUUID(),
        tokenHash: hash(refreshToken),
        expiresAt,
      });
      return buildSession(created.id, refreshToken, expiresAt);
    },

    async login({ email, password }) {
      const credentials = await repository.findCredentialsByEmail(email);
      if (!credentials) {
        await hasher.burn(password); // same cost as a real check: do not reveal which emails exist
        throw invalidCredentials();
      }
      if (!(await hasher.verify(credentials.passwordHash, password))) throw invalidCredentials();
      if (!credentials.isActive)
        throw AppError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');

      if (hasher.needsRehash(credentials.passwordHash)) {
        await repository.updatePasswordHash(credentials.userId, await hasher.hash(password));
      }

      const refreshToken = generateRefreshToken();
      const expiresAt = refreshExpiry();
      await repository.createRefreshToken({
        userId: credentials.userId,
        familyId: randomUUID(),
        tokenHash: hash(refreshToken),
        expiresAt,
      });
      return buildSession(credentials.userId, refreshToken, expiresAt);
    },

    async refresh(presented) {
      if (!presented) throw AppError.unauthorized('Refresh token required', 'AUTH_REFRESH_MISSING');
      if (!isWellFormedRefreshToken(presented)) {
        throw AppError.unauthorized('Refresh token is invalid', 'AUTH_REFRESH_INVALID');
      }
      const next = generateRefreshToken();
      const expiresAt = refreshExpiry();
      const result = await repository.rotateRefreshToken({
        presentedHash: hash(presented),
        newHash: hash(next),
        newExpiresAt: expiresAt,
      });
      switch (result.kind) {
        case 'ROTATED':
          return buildSession(result.userId, next, expiresAt);
        case 'EXPIRED':
          throw AppError.unauthorized('Session has expired, sign in again', 'AUTH_REFRESH_EXPIRED');
        case 'REUSED':
          throw AppError.unauthorized('Session was revoked, sign in again', 'AUTH_REFRESH_REUSED');
        case 'INACTIVE':
          throw AppError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
        default:
          throw AppError.unauthorized('Refresh token is invalid', 'AUTH_REFRESH_INVALID');
      }
    },

    async logout(presented) {
      if (presented && isWellFormedRefreshToken(presented)) {
        await repository.revokeFamilyByTokenHash(hash(presented), 'LOGOUT');
      }
    },

    async authenticate(header) {
      if (header === undefined || header.trim() === '') {
        throw AppError.unauthorized('Authentication required', 'AUTH_TOKEN_MISSING');
      }
      if (!bearerHeaderSchema.safeParse(header).success) {
        throw AppError.unauthorized(
          'Authorization header must be "Bearer <token>"',
          'AUTH_TOKEN_MALFORMED',
        );
      }
      const check = await accessTokens.verify(header.slice('Bearer '.length));
      if (!check.ok) {
        throw check.reason === 'EXPIRED'
          ? AppError.unauthorized('Access token has expired', 'AUTH_TOKEN_EXPIRED')
          : AppError.unauthorized('Access token is invalid', 'AUTH_TOKEN_INVALID');
      }

      // Read from the database on every request, so disabling an account or changing roles is immediate.
      const [profile, roles] = await Promise.all([
        users.findById(check.userId),
        users.findRoles(check.userId),
      ]);
      if (!profile)
        throw AppError.forbidden('User profile has not been set up', 'USER_PROFILE_MISSING');
      if (!profile.isActive)
        throw AppError.forbidden('This account is disabled', 'ACCOUNT_DISABLED');
      return {
        userId: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        organizationId: profile.organizationId,
        roles,
      };
    },

    toMe: (ctx) => ({
      id: ctx.userId,
      email: ctx.email,
      fullName: ctx.fullName,
      organizationId: ctx.organizationId,
      roles: ctx.roles,
    }),
  };
}
