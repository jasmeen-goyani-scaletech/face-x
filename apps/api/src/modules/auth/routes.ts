import { Router, type RequestHandler } from 'express';
import type { AuthController } from './controller';

export interface AuthRouteMiddleware {
  requireAuth: RequestHandler;
  trustedOrigin: RequestHandler;
  limiters: { login: RequestHandler[]; register: RequestHandler[]; refresh: RequestHandler[] };
}

export function createAuthRouter(controller: AuthController, mw: AuthRouteMiddleware): Router {
  const router = Router();
  router.post('/register', ...mw.limiters.register, controller.register);
  // Public: a registration form starts a passwordless guest session from the contact email it collects.
  router.post('/guest', ...mw.limiters.register, controller.guest);
  router.post('/login', ...mw.limiters.login, controller.login);
  // Public: an admin-issued, single-use link signs a coach or staff member in without a password.
  router.post('/sign-in-link/redeem', ...mw.limiters.refresh, controller.redeemSignInLink);
  // Cookie-driven endpoints: Origin check against CSRF.
  router.post('/refresh', mw.trustedOrigin, ...mw.limiters.refresh, controller.refresh);
  router.post('/logout', mw.trustedOrigin, controller.logout);
  router.get('/me', mw.requireAuth, controller.me);
  return router;
}
