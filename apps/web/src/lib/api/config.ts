/**
 * Where the browser sends API calls. The default is the same-origin `/api/v1`, which `next.config.mjs` proxies to the
 * API server: the refresh cookie then stays first-party and CORS never comes into play. Set
 * `NEXT_PUBLIC_API_BASE_URL` to call an API on another origin directly (that needs `COOKIE_SAME_SITE=none` on the API).
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '/api/v1').replace(/\/+$/, '');
