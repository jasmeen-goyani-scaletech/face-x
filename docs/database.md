# Database

Plain PostgreSQL (tested on 18.4; PostgreSQL 13+ is required for the built-in `gen_random_uuid()`; no extensions are needed).
`apps/api/db/migrations/*.sql` is the source of truth, applied by `node-pg-migrate`. Everything is in `public`, uses UUID primary
keys and `timestamptz` (UTC), and `ON DELETE RESTRICT` unless noted (records are cancelled or deactivated, not deleted).
Identity/profile design and the decisions behind it: `docs/architecture.md`.

## Tables

| Group | Tables |
| --- | --- |
| Identity | `organizations`, `users` (account identity, no secrets), `user_roles` (ADMIN/COACH/STAFF/PARENT/PLAYER, several per user) |
| Authentication | `user_credentials` (Argon2id hash only), `refresh_tokens` (HMAC of the token, family id, rotation/revocation fields) |
| Events | `events` (DRAFT/PUBLISHED/CLOSED, fee in cents, required IANA `timezone`), `teams` (unique per event + name + club; `invite_code`; `coach_profile_id`) |
| People | `players`, `parents` (unique email), `player_parents` (many-to-many, one primary guardian per player), `staff_profiles` (`COACH`/`STAFF`, `staff_role`) |
| Registration | `registrations` (9 statuses, `registrant_type` PLAYER/COACH/STAFF, exactly one registrant, `event_access_disabled`), `registration_status_history` (append-only) |
| Documents | `documents` (metadata + `storage_key` only; player and coach/staff types), `document_reviews` (append-only; a rejection needs a reason) |
| Consent | `consents` (immutable, versioned text), `consent_records` (append-only: version, signer, time, IP, user agent) |
| Payments | `payments` (5 statuses; at most one open and one PAID per registration) |
| Face | `face_profiles` (provider reference ID only; a player or a staff profile), `face_scans` (MATCH/NO_MATCH/REVIEW_REQUIRED/ERROR) |
| Event day | `check_ins`, `audit_logs` (append-only) |

## Integrity guarantees enforced by the database

- One registration per person per event (`unique(event_id, player_id)`, `unique(event_id, staff_profile_id)`); a team must belong to the registration's event.
- `check_ins` references `registrations(id, event_id)`, so a registration cannot be checked in to another event. `unique(registration_id)` means one check-in per person per event, so two devices racing yield exactly one row (verified with two concurrent connections on real PostgreSQL). `check_ins` has no `player_id` of its own: the person comes from the registration.
- A trigger allows check-in only when the registration is `READY_FOR_EVENT` and `event_access_disabled` is false (unpaid, unverified, cancelled, rejected are refused). It takes `FOR SHARE` on the registration so a concurrent status change waits. There is no override path (see architecture.md).
- Status history, document reviews, consent records and audit logs cannot be updated or deleted. Consent text cannot be edited; publish a new version.
- Password hashes live only in `user_credentials` and must be Argon2id; refresh tokens are stored only as HMACs, with unique hashes and consistent revocation fields.
- `registrations.status` values are validated, but **which transition is legal is enforced by the API** (Phase 5), per registrant type. "Change status + write history" and "check in + audit" should be one transaction (`Database.transaction`) or a PostgreSQL function so they are atomic.
- Deleting a user is blocked while that user has history (`audit_logs`, `registration_status_history`, `document_reviews`, `check_ins`, ... use `RESTRICT`). Deactivate (`users.is_active`) instead. A privacy-driven hard delete needs a deliberate procedure.

## Phase 4A changes (`20261007000001_registration_guest_count_and_identity_lock.sql`)

Added on top of the earlier migrations (which are never edited once applied): `registrations.guest_count` (0 to 10, default 0) and the
trigger `registrations_lock_identity`, which refuses changing a registration's event, player/staff profile or type after creation.
Everything else the phase needs (players, parents, player_parents, registrations, registration_status_history, audit_logs and their
unique constraints) already existed.

## Phase 4B changes (`20261008000001_document_upload_and_submission_state.sql`)

`documents` gains `uploaded_at` and `submitted_at` (the review `status` PENDING/APPROVED/REJECTED is unchanged), with checks that a
document cannot be submitted before it is uploaded nor reviewed before it is submitted, a trigger that stops a document being moved to
another registration or type, and an index for the admin review queue. Consent needed no schema change: `consents` (immutable wording,
unique per code + version) and `consent_records` (append-only, unique per version + registration) already fit.

## Phase 4C changes (`20261009000001_stripe_payments.sql`)

`payments` (already holding status, amount, currency, Stripe session / payment-intent references and the one-open / one-PAID indexes) gains
`provider`, `checkout_expires_at`, `created_by`, and checks (amount > 0, short failure codes, a PAID payment carries a provider reference).
New table `payment_webhook_events (provider, event_id)`: the idempotency record, one row per applied provider event, with its outcome
(`APPLIED`, `NOOP`, `IGNORED`, `REJECTED`) and a short code; rows cannot be deleted. No card data exists anywhere in the schema.

## Phase 4D-A changes (`20261010000001_face_enrollment.sql`)

`face_profiles` (already holding the provider name, the provider's opaque reference, ACTIVE/REVOKED status, the consent link and one-active-per-player
uniqueness) gains `source_document_id` (the registration photo it was enrolled from), `revoked_by` and a short `revoked_reason`. A trigger makes a
profile's player, provider, reference, source and consent immutable and a revoked profile permanently revoked; face profiles cannot be deleted.
**No biometric data is stored in PostgreSQL**: no image, template, embedding or score column exists (asserted by a test).

## Phase 4D-B2 changes (`20261011000001_event_day_check_ins.sql`)

`check_ins` gains `client_request_id uuid` with a unique constraint (idempotent retries; the service also refuses to replay an id for a different
registration, event, operator or scan) and `unique(face_scan_id)` (a scan backs at most one check-in; replaces the old plain partial index). A new
trigger `check_ins_require_valid_scan` makes a FACE check-in valid only if its scan is a MATCH for the same event, the registration's player and the
checking-in operator; it sits beside the existing `check_ins_require_ready_registration`. `face_scans` is unchanged: it stores only the outcome
(`result`, the matched player/profile for a MATCH, the provider name, the top score of a MATCH, and a short reason code in `error_code`). No image,
template, embedding or candidate list is stored. Scan recency is a time policy and lives in the service, not in the database.

## Authorization and database privileges

There is **no row-level security**; the API is the only database client and enforces authorization in code. Run it with a dedicated
role that is not a superuser, owns no schema, and has only `SELECT/INSERT/UPDATE/DELETE` on the tables and `USAGE` on the sequence it
needs (run migrations with a separate, more privileged role). Never expose the database port to the internet.

## Storage

Files are not in PostgreSQL. `documents.storage_key` points to an object in the private bucket (`<area>/<registration_id>/<uuid>`).
See architecture.md ("Storage").

## Running migrations

```bash
cd apps/api
pnpm db:migrate          # (repo root or apps/api)   applies pending migrations (advisory-locked, idempotent); needs DATABASE_URL
pnpm db:seed             # development data only; refuses to run when NODE_ENV=production
```

Migrations are plain SQL with a `-- Up Migration` header. There are no down migrations: fix forward with a new migration.
Edited-in-place migrations (done before anything was deployed) are no longer acceptable once a real database has applied them.

## Seed

`apps/api/db/seed.sql` (development only): one organization, one published event (with its timezone), two teams, one guardian with
two children, two registrations, and two consents clearly marked `[DEV PLACEHOLDER ... NOT LEGAL TEXT]`. No users are seeded.

## What is verified

All migrations, constraints, triggers and the seed run against a **real PostgreSQL 18.4 server** in the test suite
(`embedded-postgres` runs the genuine PostgreSQL binaries; set `TEST_DATABASE_URL` to use your own server instead).
Not verified: a managed PostgreSQL provider (TLS settings, role setup, connection limits) and PostgreSQL versions other than 18.

## Decisions still open (client / privacy)

See `docs/architecture.md`: coach/staff approval and event-access rules, the optional admin override, biometric
retention/deletion/consent/provider storage, approved consent wording, audit-log retention vs. user deletion, Stripe idempotency
(Phase 8). Other notes: duplicate players are not blocked by name + DOB (siblings/twins make that unreliable); event-day search uses
btree indexes on name, DOB and `school_id`, so add `pg_trgm` if fuzzy/partial matching is needed; `division` is free text; expired
`refresh_tokens` rows are not purged yet (add a periodic `delete ... where expires_at < now() - interval '7 days'`).
