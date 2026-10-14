import type { CookieOptions, RequestHandler } from 'express';
import { parse } from 'cookie';
import { AppError } from '../../shared/errors/app-error';
import { guestBodySchema, loginBodySchema, registerBodySchema } from './schema';
import type { AuthService } from './service';
import type { Session } from './types';

export const REFRESH_COOKIE = 'facex_refresh';
/** The cookie is only sent to the auth endpoints, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface CookieConfig {
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
}

export interface AuthController {
  register: RequestHandler;
  guest: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
}

export function createAuthController(service: AuthService, cookies: CookieConfig): AuthController {
  const baseCookie: CookieOptions = {
    httpOnly: true, // not readable from JavaScript, so XSS cannot steal it
    secure: cookies.secure,
    sameSite: cookies.sameSite,
    path: REFRESH_COOKIE_PATH,
  };

  const sendSession: RequestHandler = (_req, res) => {
    const session = res.locals.session as Session;
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...baseCookie,
      expires: session.refreshExpiresAt,
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        tokenType: 'Bearer',
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        user: session.user,
      },
    });
  };

  const presentedRefreshToken = (header: string | undefined) =>
    header ? parse(header)[REFRESH_COOKIE] : undefined;

  return {
    register: async (req, res) => {
      const body = registerBodySchema.parse(req.body);
      const user = await service.register(body);
      res.set('Cache-Control', 'no-store');
      res.status(201).json({ success: true, data: user });
    },

    guest: async (req, res, next) => {
      res.locals.session = await service.startGuestSession(guestBodySchema.parse(req.body));
      res.status(201);
      sendSession(req, res, next);
    },

    login: async (req, res, next) => {
      res.locals.session = await service.login(loginBodySchema.parse(req.body));
      sendSession(req, res, next);
    },

    refresh: async (req, res, next) => {
      try {
        res.locals.session = await service.refresh(presentedRefreshToken(req.headers.cookie));
      } catch (err) {
        // A refresh token that is dead should not be kept by the browser.
        if (err instanceof AppError && err.status === 401)
          res.clearCookie(REFRESH_COOKIE, baseCookie);
        throw err;
      }
      sendSession(req, res, next);
    },

    logout: async (req, res) => {
      await service.logout(presentedRefreshToken(req.headers.cookie));
      res.clearCookie(REFRESH_COOKIE, baseCookie);
      res.set('Cache-Control', 'no-store');
      res.status(204).end();
    },

    me: (req, res) => {
      if (!req.auth) throw AppError.unauthorized();
      // Identity responses must never be cached by browsers or proxies.
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: service.toMe(req.auth) });
    },
  };
}
