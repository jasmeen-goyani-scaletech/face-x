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
  router.post('/login', ...mw.limiters.login, controller.login);
  // Cookie-driven endpoints: Origin check against CSRF.
  router.post('/refresh', mw.trustedOrigin, ...mw.limiters.refresh, controller.refresh);
  router.post('/logout', mw.trustedOrigin, controller.logout);
  router.get('/me', mw.requireAuth, controller.me);
  return router;
}
