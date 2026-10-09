# Deployment guide (Hetzner or any Linux host)

Nothing here has been deployed yet. This is how the current code is meant to be deployed, what is configuration versus code, and
what is still undecided. Every environment-specific value is an environment variable; the code has no host names, paths or
credentials in it.

## 1. Shape of a deployment

```text
Internet ──HTTPS──▶ reverse proxy (Caddy / nginx / Hetzner Load Balancer)
                      ├─ /api/v1/*  ───────────▶ API   (Node 22, port 4000)  ──▶ PostgreSQL (private network only)
                      └─ everything else ──────▶ Web   (Next.js, port 3000)
                                               API ──▶ object storage (S3-compatible bucket)
                                               API ◀── Stripe webhook   POST /api/v1/webhooks/stripe
```

**Recommended: route `/api/v1/*` to the API in the reverse proxy**, not through Next.js. Reasons:

- The rate limits (login, uploads, payment, scan) key on the client's IP. Behind a proxy the API reads it from `X-Forwarded-For`
  through `TRUST_PROXY_HOPS` proxies (default 1 in production). With one proxy in front of the API this is right; if Next.js also
  proxied the API, every user would appear to come from the web server and share one limit.
- The browser then talks to a single origin, so the refresh cookie stays first-party and CORS is not involved.
- Next.js bakes `API_ORIGIN` into its build, so a Next proxy would tie the build to one API address.

If you do use the Next.js proxy (fine for a single small server), set `API_ORIGIN` **before** `next build`, and set
`TRUST_PROXY_HOPS=2`.

## 2. Configuration reference

**API** (`apps/api/.env.example` is the full, commented list; the API refuses to start if a value is invalid)

| Setting | Notes |
| --- | --- |
| `NODE_ENV=production`, `PORT`, `LOG_LEVEL` | Logs are JSON on stdout (journald / `docker logs`). Request bodies, tokens and personal data are not logged. |
| `DATABASE_URL` | The **app** user (read/write only). Migrations use a different, owner user (section 3). |
| `DATABASE_SSL`, `DATABASE_SSL_CA_FILE` | TLS to the database; the CA file is for a self-signed certificate. Not needed if the DB listens on localhost only. |
| `DATABASE_POOL_MAX` | Default 10. |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Two different random values (generator command in the example file). |
| `FRONTEND_URL` | The public site origin(s), e.g. `https://facex.example.org`. Used for CORS, the cookie origin check **and Stripe's return URLs**. |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE` | Secure by default in production. Keep `lax` when the site and API share one origin. |
| `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the API. Get this right; see section 1. |
| `STORAGE_DRIVER=s3` + `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `STORAGE_FORCE_PATH_STYLE` | Any S3-compatible bucket. `local` is **refused in production**. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments are off without them. |
| `FACE_*` | Unused until a face provider is chosen. |

**Web** (`apps/web/.env.example`). `NEXT_PUBLIC_*` and `API_ORIGIN` are fixed **when `next build` runs**.

| Setting | Notes |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | The public address (link previews). |
| `API_ORIGIN` | Only if Next.js proxies the API (section 1). |
| `NEXT_PUBLIC_DEMO_MODE` | Demo-only (a simulated face matcher on the scanner). Leave unset in a real deployment. |

Secrets live in the server's environment (a root-only env file used by systemd, or the container runtime's secrets), never in the
repository.

## 3. Database

Reproducible from files in the repository:

```bash
# once per database, as a PostgreSQL superuser (passwords come from you, not from the file)
psql -h localhost -U postgres -f apps/api/db/setup/create-database.sql \
     -v db_name=facex -v migrator_password='...' -v app_password='...'

# on every release, as the migrator user (works from the compiled build; no dev tooling needed)
DATABASE_URL=postgres://facex_migrator:...@localhost:5432/facex  pnpm --filter @facex/api db:migrate:prod
```

- The script is idempotent (safe to re-run) and creates two users: a migrator that owns the tables, and an app user that can only
  read and write data. Tested end to end with the full registration, payment, review and check-in flow as the app user.
- Needs PostgreSQL 13 or newer and no extensions. Tested on 18.x.
- **Never run `db:seed` against a database that will hold real data**: it loads demo data and a placeholder consent that can never
  be removed (consent text is immutable). The seed refuses to run when `NODE_ENV=production`.
- Real starting data (organization, events, teams, admins, approved consent wording) is a separate bootstrap script, written once
  the real values are known.

## 4. Build and run

```bash
pnpm install --frozen-lockfile        # once, at the repository root (Node 22, pnpm 9)
pnpm build:api && pnpm db:migrate:prod
pnpm start:api                        # port 4000
# Web (needs internet at build time: it downloads the Google fonts). Set NEXT_PUBLIC_* / API_ORIGIN first.
pnpm build:web && pnpm start:web      # port 3000
```

Run both as services (systemd units or containers) with restart-on-failure. There is no Dockerfile or unit file in the repository
yet; writing them is part of the estimate below. Health checks: `GET /health` (alive) and `GET /health/ready` (database reachable).
The API shuts down gracefully on SIGTERM.

## 5. Storage

The storage layer has three small interfaces (signed links, server-side verification, server-side read) and two drivers chosen by
`STORAGE_DRIVER`:

- `s3`: any S3-compatible service. Changing provider is a settings change (endpoint, region, keys, bucket, path style).
- `local`: a folder on the development machine, with the same signed-link flow, for local testing only.

For a bucket: keep it private; allow the browser to `PUT` from the site origin only (CORS: methods `PUT`, header `Content-Type`).
Browsers upload directly to the bucket with a short-lived link, so the bucket's address must be reachable from users' browsers.
**Unverified against any real bucket yet** (including Hetzner Object Storage: confirm presigned `PUT`, CORS and the
`response-content-disposition` header behave as on AWS).

### Switching from the local driver to Hetzner Object Storage

Player, coach and staff documents all use this one storage layer; nothing in the code changes, only `apps/api/.env` (backend only,
never the web app). Replace `STORAGE_DRIVER=local` with:

```bash
STORAGE_DRIVER=s3
STORAGE_ENDPOINT=https://<location>.your-objectstorage.com   # e.g. https://fsn1.your-objectstorage.com (your bucket's location)
STORAGE_REGION=<location>                                    # e.g. fsn1
STORAGE_ACCESS_KEY=<access key from the Hetzner console>
STORAGE_SECRET_KEY=<secret key from the Hetzner console>
STORAGE_BUCKET=<private bucket name>
STORAGE_FORCE_PATH_STYLE=false                               # set true only if virtual-hosted-style requests fail
```

Then, once, in the Hetzner console / with an S3 tool: keep the bucket **private** and add a CORS rule for the site origin allowing
`PUT` with header `Content-Type` (browsers upload straight to the bucket). Restart the API and run one upload per kind (a player
document, a coach certificate, a staff proof) plus a download from the admin screen. The web app needs no change.

## 6. Stripe

Create a webhook endpoint at `https://<site>/api/v1/webhooks/stripe` for: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`,
`payment_intent.payment_failed`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Stripe returns customers to
`<FRONTEND_URL>/register/player/payment-return`. Test mode first; **not yet run against real Stripe**.

## 7. Operations to put in place

- **Backups:** nightly `pg_dump -Fc` kept off the server (plus the provider's server backups), and a restore tested before real
  data goes in. Bucket contents need their own retention plan.
- **Updates:** OS and PostgreSQL patching; a named owner.
- **Monitoring:** uptime check on `/health/ready`, disk space, error logs.
- **One API instance** to start. The rate-limit counters are in memory; running several instances needs a shared store first.

## 8. Effort to deploy to Hetzner (rough, one person with access and decisions made)

| Work | Estimate |
| --- | --- |
| Servers, firewall, private network, DNS | 0.5 day |
| PostgreSQL install, users, migrations, backups and a tested restore | 1 day |
| Object storage bucket, keys, CORS, upload and download test | 0.5 day |
| Dockerfiles or systemd units, reverse proxy with TLS, secrets, first deploy | 1.5 days |
| Stripe test-mode run, then live webhook | 0.5 day |
| Real starting data and admin accounts, consent wording as a migration | 0.5 day |
| Smoke test of the whole flow on the server, fixes | 1 day |
| Optional: automated deploy pipeline | 0.5 to 1 day |
| Optional: monitoring and alerting | 0.5 to 1 day |
| **Total** | **about 5 to 7 working days, nearly all setup; roughly 0 to 1 day of code (the container files)** |

## 9. Decisions and unknowns that can hold a deployment up

1. **Region and data residency.** Users are in California and the data is about minors. Choose the server region deliberately;
   Hetzner's object storage was believed to be offered in EU locations only (verify before relying on it).
2. **Email/SMS sender.** Hetzner does not provide one; notifications (and later password reset) need a third party.
3. **Real S3-compatible behaviour** on the chosen provider (section 5) and **real Stripe** (section 6): both unverified.
4. **Approved consent wording**, the **face provider** and the coach and staff flows are product work, not deployment work.
5. **Database operations ownership** (no managed PostgreSQL at Hetzner): someone must own backups, upgrades and restores.
6. **Domain name and TLS** (a Let's Encrypt certificate via Caddy or the load balancer needs the DNS record first).
