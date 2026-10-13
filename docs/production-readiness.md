# Face-X: production readiness runbook

Status as of 2026-10-09. This is what must still happen before launch, with exact commands. Nothing here has been run against a
production system; every step that needs credentials, infrastructure or a decision is marked **[needs you]**.
See also `docs/deployment.md` (configuration reference and a self-hosted shape) and `docs/architecture.md`.

## 1. Pending database migration: `push_subscriptions`

`apps/api/db/migrations/20261012000001_push_subscriptions.sql` creates one table (`public.push_subscriptions`) and one index, and
nothing else. It is additive and safe to apply to a live database:

- It references only `public.users(id)` (uuid) and the existing `public.set_updated_at()` trigger function, and uses
  `gen_random_uuid()` (built in since PostgreSQL 13). All three were confirmed present in the development database (PostgreSQL 18).
- It does not touch any existing table, so nothing already working can break; the API works without it (push is simply off).
- The API's restricted `facex_app` user cannot create tables, so it **must be run by the database owner** (the migrator user).
  The app user then gets read/write on the new table automatically through the default privileges that
  `apps/api/db/setup/create-database.sql` sets up.

**[needs you / the database owner]** run, from the repository root:

```bash
# Development (tsx; reads the migrator URL from the environment, NOT from apps/api/.env which holds the app user):
DATABASE_URL='postgres://facex_migrator:<migrator password>@localhost:5432/facex' pnpm --filter @facex/api db:migrate

# A built/production host (compiled build, no dev tooling):
pnpm build:api
DATABASE_URL='postgres://facex_migrator:<migrator password>@<db host>:5432/facex' pnpm --filter @facex/api db:migrate:prod
```

Expected output: `Applied: 20261012000001_push_subscriptions` (or `Database is up to date` if it was already applied). Verify, as any user:

```sql
select name from pgmigrations order by id desc limit 1;                          -- 20261012000001_push_subscriptions
select count(*) from public.push_subscriptions;                                  -- 0, and no error
select has_table_privilege('facex_app', 'public.push_subscriptions', 'INSERT');  -- true
```

Then restart the API (no code change needed). Migrations take an advisory lock, so running them twice or concurrently is safe.

## 2. Push notifications

What the code already does (all covered by tests, none verified against a real browser push service yet):

- Subscribe / unsubscribe endpoints (`/api/v1/notifications/push/subscriptions`), one row per browser endpoint, the endpoint is unique, the browser's
  keys are stored but never returned, at most 10 devices per user, subscriptions are deleted when the push service says they are gone (404/410) or after 5
  consecutive failures.
- Sent after the business change has committed and never able to fail it: **document accepted**, **document rejected** (with the reason), and **event-day access
  granted** (when readiness or a payment makes a registration READY_FOR_EVENT).
- The service worker shows the notification and, on click, opens only a same-origin path (`/dashboard/player`, `/register/coach`, `/register/staff`,
  `/coach/my-team/event-day`), reusing an open window.
- Not covered: nothing is sent when an admin *re-enables* event-day access that was switched off. Say so if you want it.

Steps to turn it on and verify **[needs you]**:

1. Apply the migration (section 1).
2. Generate keys once: `npx web-push generate-vapid-keys`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:ops@your-domain` or an https URL) on the API,
   all three or none. Keep the same keys across deployments, or every existing subscription stops working. The private key is backend only.
3. Use HTTPS (or localhost). Push does not work on plain http elsewhere, and on iOS only from an installed home-screen app.
4. In a production build (the service worker only registers there): sign in as a family, tap the "Alerts" control, accept the permission prompt, and check
   `select user_id, left(endpoint, 40), failure_count from push_subscriptions;` shows one row.
5. As an admin, reject then approve a document of that family. Expect two system notifications; clicking one must open the dashboard. Check the API log for
   `Push delivery failed` (it should be absent) and that `last_success_at` is set.
6. Turn the alerts off in the UI and confirm the row is gone; block notifications in the browser and confirm the control shows "blocked".

## 3. Payments (Stripe)

Implemented: hosted Checkout created server-side for the amount fixed at submission, webhook-only confirmation (the return page proves nothing), idempotent
webhook processing, retry that closes the earlier session first, and amount/currency checks. About 45 tests cover success, failed, cancelled, expired, abandoned,
asynchronous methods, duplicate and simultaneous webhooks, invalid signatures, rollback on internal errors and final payment state. They use a fake provider plus real
Stripe signature verification; **no live or test-mode Stripe call has been made**.

Required configuration **[needs you]** (values never go in the repository or the web app):

| Variable | Where | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | API | A `sk_test_...` key first. Without it the payment endpoints answer 503 `PAYMENT_NOT_CONFIGURED` (verified). |
| `STRIPE_WEBHOOK_SECRET` | API | The endpoint's `whsec_...` signing secret. Without it payments cannot be confirmed. |
| `FRONTEND_URL` | API | Stripe returns customers to `<FRONTEND_URL>/register/player/payment-return`. Must be the site's real origin. |

Webhook endpoint (Stripe dashboard, test mode first): `https://<API host>/api/v1/webhooks/stripe`, events `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`.
With the Vercel frontend the webhook goes **directly to the API host**, not through Vercel. For local testing use the Stripe CLI:
`stripe listen --forward-to localhost:4000/api/v1/webhooks/stripe` (it prints a local `whsec_`).

Live test-mode run to do once keys exist: pay a paid-event registration with `4242 4242 4242 4242`; a declined card (`4000 0000 0000 9995`); abandon the hosted page and
retry; close the browser right after paying; resend the same event from the dashboard (duplicate delivery). After each, check `payments`, `payment_webhook_events` and the
registration status in PostgreSQL, and that the logs hold no keys, signatures or checkout links.

## 4. Event-day scanning: two separate product decisions

- **Face recognition: the `node-native` provider is built (face-api on WASM, inside the API); it is not calibrated.** Set `FACE_PROVIDER=node-native`, `FACE_ENCRYPTION_KEY`
  (back it up: without it every enrolled face is unreadable) and `FACE_CONSENT_CODE=BIOMETRIC_CONSENT`. The approved biometric consent wording is published by migration `20261013000002`. Decisions still needed:
  match/review thresholds calibrated on real event photos (`FACE_MATCH_THRESHOLD`, `FACE_REVIEW_THRESHOLD`, `FACE_AMBIGUITY_MARGIN`; the mapping puts face-api distance 0.4 at 0.90 and 0.6 at 0.75), whether
  photos from a mirrored front camera and an un-mirrored one must match (they match less closely), retention, and capacity (a scan costs about half a second of one CPU core; scans queue behind each other).
- **QR check-in: not built.** There is no QR generation or scanner. Decisions needed: what the code encodes (a signed, expiring token is safer than a registration number), where families get it
  (dashboard, email, wallet pass), what the scanner reads it with, and whether it must work offline.
- Manual search, the eligibility rules and the offline queue are implemented and were verified (see the end-to-end report).
- Camera behaviour on a real phone is **not tested**; automated tests used a synthetic video feed. Test on an iPhone (Safari) and an Android phone (Chrome) over HTTPS before launch.

## 5. Deployment plan: Vercel frontend + separately hosted API

Nothing is deployed except a stale, web-only Vercel project. Do not change production settings until the items marked **[needs you]** are settled.

**Topology.** Browser → Vercel (`/api/v1/*` is rewritten to the API, so the refresh cookie stays first-party and CORS is not involved) → API behind HTTPS → PostgreSQL (private network
only). Browsers upload and download documents directly to and from Hetzner Object Storage with short-lived signed URLs.

**Order of work**

1. **[needs you]** Decide hosting for the API and database (Hetzner Cloud VPS or another host), the API hostname, the region, and who owns backups. Create a dedicated Hetzner project and bucket for Face-X (section 7).
2. Provision PostgreSQL (13+). Run `apps/api/db/setup/create-database.sql` as a superuser with generated passwords, then `db:migrate:prod` as the migrator (section 1). Never run `db:seed` on a real database.
3. Deploy the API (Node 22) with the environment below, behind a TLS proxy (Caddy/nginx) that forwards `/api/v1/*`, `/health` and `/health/ready`. One instance (rate-limit counters are in memory).
4. Vercel project: Root Directory `apps/web`, enable including source files outside the root directory (the monorepo lockfile is at the repository root), set the web variables below, redeploy.
5. Bucket CORS: add the site origin(s) (`PUT`, `GET`, `HEAD`, any header, expose `ETag`). The Vercel preview/production domains that will actually be used must be listed.
6. Stripe webhook and keys (section 3), VAPID keys (section 2).
7. Smoke test the deployed stack end to end (health, sign-up, cookie refresh, Player/Coach/Staff upload, review, rejection, re-upload, download, check-in), then take a backup and restore it somewhere to prove it works.

**API environment** (secrets in a root-only env file / secret store, never in git; `apps/api/.env.example` is the full commented list):

| Variable | Value for deployment |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT`, `LOG_LEVEL` | `4000`, `info` |
| `DATABASE_URL` | the **app** user (read/write only), over a private network; `DATABASE_SSL=true` (+ `DATABASE_SSL_CA_FILE`) if the database is on another host |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | two different random values of 32+ characters, generated for this environment |
| `FRONTEND_URL` | the exact site origin(s), comma separated, e.g. `https://app.example.org`; used for CORS, the cookie origin check and Stripe return URLs |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE` | `true` (default in production), `lax` |
| `TRUST_PROXY_HOPS` | the real number of proxies in front of the API (see the risk below) |
| `STORAGE_DRIVER=s3`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `STORAGE_FORCE_PATH_STYLE=true` | the Face-X-only Hetzner project's key and bucket |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | section 3 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | section 2 |
| `FACE_*` | leave unset until a provider is chosen |

**Web (Vercel) environment** (`NEXT_PUBLIC_*` and `API_ORIGIN` are baked in at build time, so redeploy after changing them): `API_ORIGIN=https://<API host>`,
`NEXT_PUBLIC_SITE_URL=https://<site>`, `NEXT_PUBLIC_DEMO_MODE` unset (it only enables a simulated matcher). Leave `NEXT_PUBLIC_API_BASE_URL` unset.

**Health checks and monitoring.** Uptime monitor on `GET /health/ready` (it checks the database). Alerts on disk, 5xx rate and the API process. Logs are JSON on stdout (no bodies, headers or query strings);
ship them off the host.

**Backups.** Nightly `pg_dump -Fc` copied off the server plus the provider's server backups, and a restore rehearsal before real data. The bucket has no versioning plan yet.

**Known risk to verify on the deployed stack.** The API rate-limits by client IP. With Vercel rewriting to a proxy in front of the API, the API may see Vercel's address for every user, so all users would share
one login/sign-up limit. Check what address the API logs for two different clients; if they match, either put the API on the same origin through the reverse proxy (recommended in `docs/deployment.md`), or raise
`RATE_LIMIT_LOGIN_PER_IP_15MIN` / `RATE_LIMIT_REGISTER_PER_IP_HOUR` for the demo.

**Node networking note.** On some networks (it happened on a Windows development machine) the Hetzner hostname's IPv6 address does not answer and Node waits 20-40 s before falling back. The API's `dev` script now
starts with `--dns-result-order=ipv4first`. Production is **not** changed: add `NODE_OPTIONS=--dns-result-order=ipv4first` to the production service only if you see the same delay there.

**Web build.** `next build` now works on Windows and Linux. The link-preview image is the static file `apps/web/src/app/opengraph-image.png`, generated by `pnpm --filter @facex/web generate:og`.

## 6. Consent text: where the placeholders are, and what is needed

No legal wording exists in this repository. Do not publish anything until counsel/the league approves it **[needs you]**.

Placeholders and hardcoded wording found:

| Where | What |
| --- | --- |
| `apps/api/db/seed.sql` lines 23-27 | `GUARDIAN_CONSENT` v1 and `AB506_ACKNOWLEDGEMENT` v1, both titled/prefixed `[DEV PLACEHOLDER ... NOT LEGAL TEXT]`. The seed refuses to run when `NODE_ENV=production`. The development database holds these rows. |
| `apps/api/db/migrations/20261006000005_documents_consents_payments.sql` line 49 | `TODO(client)` comment: production wording is required for the guardian consent, the AB 506 acknowledgement and the biometric/face-scan consent. The table itself is correct. |
| `apps/web/src/app/register/coach/page.tsx` line 211 | The AB 506 checkbox label ("I acknowledge California Child Abuse Prevention Act (AB 506) compliance requirements and consent to a background check.") is **hardcoded in the web app**. The consent recorded in the database is the database wording, which the coach never sees on screen. The label must be replaced by the published wording once approved. |
| `apps/web/src/components/registration/player/GuardianConsentStep.tsx` line 159 | The heading "Liability Release & Waiver" is hardcoded; the body shown is the published database wording. |
| `docs/architecture.md` line 546, `docs/database.md` line 95 | Documentation of the above. |
| Tests | Test-only strings marked `[TEST CONSENT TEXT - not legal wording]`; they never reach a real database. |

Wording needed: (1) guardian consent / liability waiver for minors (player registration); (2) AB 506 acknowledgement and background-check consent for coaches (and decide whether staff need one);
(3) biometric / face-scan consent, only if face matching is chosen. Consent text is immutable: approved wording is published as a **new version** in a migration (insert a new `(code, version)` row) and everyone is asked
to accept the new version. The placeholder rows can never be deleted, so a database that has held them should not become the production database; create the production database fresh.

## 7. Rejected documents: retention recommendation

Today a rejected document is kept: its row (with the review and reason) and its object stay in the bucket after the family uploads a replacement. That preserves the audit trail but keeps identity documents of minors
longer than needed. Recommendation (the periods are a legal/policy decision **[needs you]**):

- Keep a rejected document's *review* (reason code, reason, reviewer, time) and audit rows indefinitely; they contain no document content.
- Delete the rejected *file* a short fixed time after it is superseded or its registration is closed (for example 30 days), and every document of a registration a fixed time after the event ends, as counsel advises.
- Do it as one coordinated, idempotent job, never by hand: (1) select the eligible documents; (2) delete each object and wait for success; (3) only then, in a transaction, mark the row purged (a `purged_at` column plus clearing the key,
  added by a migration) and write a `DOCUMENT_PURGED` audit row; (4) a failed delete leaves the row untouched so the next run retries. Never delete the row first (it would orphan the object) and never delete an object whose row is still the
  live, approved or in-review document. Run it first in a report-only mode and review the list.
- Add a reconciliation report that compares the bucket listing with `documents.storage_key` to find orphans in either direction.

Nothing has been deleted. Test data from end-to-end runs (accounts `uptest-*@example.com`, their registrations and the matching objects in the `face-x` bucket) is still in place.

## 8. Rotating the shared development storage key, and moving to Face-X-only credentials

Hetzner S3 keys work on every bucket in their project, and the development key can also see another bucket. Plan **[needs you: you create the project, bucket and keys]**:

1. Create a Hetzner Cloud project used only by Face-X (one per environment is better: demo and production), create the bucket in it, and generate an S3 key there. The secret is shown once: put it straight into the secret store.
2. Apply the bucket CORS rule for the site origin(s) (section 5, step 5) and keep the bucket private.
3. Copy existing objects if they matter (`rclone sync` from the old bucket to the new one; the database stores only the object key, which does not change). Verify counts and sizes.
4. Update `STORAGE_*` (endpoint/region if different, key, secret, bucket) in the API's environment, restart, and run one upload, one admin review and one download per role.
5. Verify the new key is scoped: listing any bucket outside the new project must fail.
6. Delete the old development key in the Hetzner console. Because the old key was once written in a tracked file and printed during testing, treat it as exposed and delete it, not just stop using it.
7. Never put keys in `.env.example`, the web app, logs or chat. Rotate by creating the new key first, switching, then deleting the old one.
