import { z } from 'zod';

/** Empty strings (".env.example" placeholders) count as unset for optional values. */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

/** A number setting where an empty value (an ".env.example" placeholder) means "use the default". */
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().pipe(schema).optional(),
  );

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');
const optionalBoolean = z
  .enum(['true', 'false', ''])
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v === 'true'));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // How many reverse proxies sit in front of the API (0 = none). The real client IP, which the rate limits key on, is
    // read from X-Forwarded-For through this many proxies. Default: 1 in production, 0 otherwise.
    TRUST_PROXY_HOPS: optionalNumber(z.number().int().min(0).max(5)),

    // PostgreSQL. Set DATABASE_SSL=true for managed databases that require TLS.
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// URL'),
    DATABASE_SSL: booleanString.default(false),
    // Optional CA certificate (a PEM file path) to trust when DATABASE_SSL=true, e.g. a self-signed server certificate.
    DATABASE_SSL_CA_FILE: optionalString,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    // Authentication. Two independent secrets: one signs access tokens, one keys the refresh-token hash.
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    REFRESH_TOKEN_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_SECURE: optionalBoolean, // default: true in production

    // Browser origin(s) allowed by CORS and by the cookie-endpoint Origin check.
    FRONTEND_URL: z
      .string()
      .min(1)
      .transform((v) => v.split(',').map((o) => o.trim().replace(/\/$/, '')))
      .pipe(z.array(z.url()).min(1)),

    // Where uploaded documents and photos are kept.
    //   s3     any S3-compatible service (AWS S3, Hetzner Object Storage, MinIO, R2...): needs the STORAGE_* group below.
    //   local  a folder on this machine. DEVELOPMENT ONLY: refused when NODE_ENV=production.
    // Unset: 's3' when the STORAGE_* group is set, otherwise uploads are disabled.
    STORAGE_DRIVER: z
      .enum(['s3', 'local'])
      .optional()
      .or(z.literal('').transform(() => undefined)),
    STORAGE_LOCAL_DIR: optionalString, // default .local-storage (relative to where the API starts)
    // Prefix of the upload/download links the browser is given. Empty = same origin as the page (the usual local setup).
    STORAGE_LOCAL_PUBLIC_URL: optionalString,

    // Private object storage (any S3-compatible service). The group is optional, but if one credential is set the whole
    // group must be.
    STORAGE_ENDPOINT: optionalString, // omit for AWS S3 itself
    STORAGE_REGION: z.string().min(1).default('auto'),
    STORAGE_ACCESS_KEY: optionalString,
    STORAGE_SECRET_KEY: optionalString,
    STORAGE_BUCKET: optionalString,
    STORAGE_FORCE_PATH_STYLE: booleanString.default(false), // true for MinIO and some self-hosted stores

    // Optional until the payments / face-recognition phases land.
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    // Face recognition. FACE_PROVIDER names a registered adapter (none exist yet). FACE_CONSENT_CODE is the biometric
    // consent that must be on record before enrollment, or NONE to explicitly waive it. Unset = enrollment disabled.
    FACE_PROVIDER: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,40}$/, 'must be a short lowercase name')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    FACE_CONSENT_CODE: z
      .string()
      .trim()
      .regex(/^([A-Z][A-Z0-9_]{0,49})$/, 'must be an upper-case consent code, or NONE')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    FACE_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    // Event-day matching policy (application-side; adapters never decide). Similarity is 0..1, higher = closer.
    // The defaults are PROVISIONAL starting points: calibrate them against the chosen provider before go-live.
    FACE_MATCH_THRESHOLD: optionalNumber(z.number().min(0).max(1)),
    FACE_REVIEW_THRESHOLD: optionalNumber(z.number().min(0).max(1)),
    FACE_AMBIGUITY_MARGIN: optionalNumber(z.number().min(0).max(1)),
    FACE_SCAN_TIMEOUT_MS: optionalNumber(z.number().int().min(500).max(30_000)),
    // Sign-up and sign-in limits per client address. A venue's Wi-Fi puts many families behind one address, so these are
    // generous by default; the per-account login limit (5 failures per 15 minutes) is what stops password guessing.
    RATE_LIMIT_REGISTER_PER_IP_HOUR: optionalNumber(z.number().int().min(1).max(10_000)),
    RATE_LIMIT_LOGIN_PER_IP_15MIN: optionalNumber(z.number().int().min(1).max(10_000)),
    // Web Push (VAPID). Generate once with: npx web-push generate-vapid-keys. All three or none: without them, push is off.
    VAPID_PUBLIC_KEY: optionalString,
    VAPID_PRIVATE_KEY: optionalString,
    VAPID_SUBJECT: optionalString, // mailto:you@example.org or an https URL
    FACE_PROVIDER_API_KEY: optionalString,
    // true (default): a profile photo is enrolled with the face provider as soon as it is uploaded, before an admin reviews it and
    // without the face-scan consent. false: enrollment waits for admin approval and the consent (the stricter, earlier behaviour).
    FACE_ENROLL_ON_UPLOAD: z
      .enum(['true', 'false', ''])
      .optional()
      .transform((v) => v !== 'false'),
    // DEVELOPMENT ONLY: when the provider cannot answer a scan, match the newest enrolled person so the flow can be tested.
    FACE_SCAN_MOCK: z
      .enum(['true', 'false', ''])
      .optional()
      .transform((v) => v === 'true'),
    // The "rust-remote" provider: base URL of the face_z_BE service including its version prefix, e.g. https://host/v1
    RUST_FACE_SERVICE_URL: z
      .string()
      .trim()
      .refine(
        (v) => URL.canParse(v) && /^https?:$/.test(new URL(v).protocol),
        'must be an http(s) URL',
      )
      .optional()
      .or(z.literal('').transform(() => undefined)),
    // Bearer token for the face service's /admin routes (its ADMIN_TOKEN). It is what lets this API hard-delete a person's
    // face data when they are removed or re-enroll. Backend only.
    RUST_FACE_SERVICE_TOKEN: optionalString,
    FACE_PROVIDER_URL: optionalString,
    // The "node-native" provider keeps face descriptors in this database, encrypted with AES-256-GCM under this key: 32 random
    // bytes, base64 (node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"). Backend only; losing it makes
    // every enrolled face unreadable (people would have to be enrolled again).
    FACE_ENCRYPTION_KEY: z
      .string()
      .trim()
      .refine((v) => /^[A-Za-z0-9+/]{43}=$/.test(v), 'must be 32 random bytes, base64-encoded')
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_SECRET === env.REFRESH_TOKEN_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['REFRESH_TOKEN_SECRET'],
        message: 'must differ from JWT_SECRET',
      });
    }
    if ((env.FACE_REVIEW_THRESHOLD ?? 0.75) > (env.FACE_MATCH_THRESHOLD ?? 0.9)) {
      ctx.addIssue({
        code: 'custom',
        path: ['FACE_REVIEW_THRESHOLD'],
        message: 'must not be higher than FACE_MATCH_THRESHOLD',
      });
    }
    if (env.FACE_SCAN_MOCK && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['FACE_SCAN_MOCK'],
        message: 'must not be enabled in production (it fakes face matches)',
      });
    }
    if (env.FACE_PROVIDER === 'rust-remote' && !env.RUST_FACE_SERVICE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['RUST_FACE_SERVICE_URL'],
        message: 'is required when FACE_PROVIDER=rust-remote',
      });
    }
    // Removing a face needs the token. Development may run without it (enrolling and scanning work; removing answers 503 with
    // a log line), production may not: a deployment that cannot delete biometric data must not start.
    if (
      env.FACE_PROVIDER === 'rust-remote' &&
      env.NODE_ENV === 'production' &&
      !env.RUST_FACE_SERVICE_TOKEN
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['RUST_FACE_SERVICE_TOKEN'],
        message: 'is required when FACE_PROVIDER=rust-remote (removing a face needs the service admin token)',
      });
    }
    if (env.FACE_PROVIDER === 'node-native' && !env.FACE_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['FACE_ENCRYPTION_KEY'],
        message:
          'is required when FACE_PROVIDER=node-native (face descriptors are stored encrypted)',
      });
    }
    if (env.STORAGE_DRIVER === 'local' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message:
          '"local" stores files on the server\'s own disk and is for development only; use "s3" in production',
      });
    }
    if (
      env.STORAGE_DRIVER === 's3' &&
      !(env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY && env.STORAGE_BUCKET)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_BUCKET'],
        message:
          'STORAGE_DRIVER=s3 needs STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY and STORAGE_BUCKET',
      });
    }
    const storage = [env.STORAGE_ACCESS_KEY, env.STORAGE_SECRET_KEY, env.STORAGE_BUCKET];
    if (storage.some(Boolean) && !storage.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_BUCKET'],
        message: 'STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY and STORAGE_BUCKET must be set together',
      });
    }
    const vapid = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT];
    if (vapid.some(Boolean) && !vapid.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message: 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together',
      });
    }
    if (env.VAPID_SUBJECT && !/^(mailto:.+|https:\/\/.+)$/.test(env.VAPID_SUBJECT)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_SUBJECT'],
        message: 'must be a mailto: address or an https URL',
      });
    }
    const secure = env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
    if (env.COOKIE_SAME_SITE === 'none' && !secure) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SAME_SITE'],
        message: '"none" requires secure cookies',
      });
    }
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    FACE_MATCH_THRESHOLD: env.FACE_MATCH_THRESHOLD ?? 0.9,
    FACE_REVIEW_THRESHOLD: env.FACE_REVIEW_THRESHOLD ?? 0.75,
    FACE_AMBIGUITY_MARGIN: env.FACE_AMBIGUITY_MARGIN ?? 0.05,
    FACE_SCAN_TIMEOUT_MS: env.FACE_SCAN_TIMEOUT_MS ?? 5_000,
  }));

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Validates a raw environment. Reports variable names only, never their values (they may be secrets). */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
