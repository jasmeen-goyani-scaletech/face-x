# Architecture notes and decisions

Status: foundation, PostgreSQL schema, authentication and authorization are done, on plain PostgreSQL (Supabase was removed).
Nothing else is implemented yet.

## Repository layout and package managers

- The repository is a **pnpm workspace** (`pnpm-workspace.yaml`, one root `pnpm-lock.yaml`, pinned by `packageManager` in the root
  `package.json`). Root scripts only orchestrate; each app owns its dependencies, scripts, TypeScript config and env file.
- `apps/web` is the Next.js frontend (`@facex/web`); `apps/api` is the Express backend (`@facex/api`). Their TypeScript settings differ
  on purpose (bundler/ESM-ish for Next, CommonJS/Node for the API), so there is no shared `tsconfig.base` yet.
- Vercel (if the frontend is deployed there): set the project's **Root Directory** to `apps/web` and keep "include source files outside
  the root directory" on, so it installs from the root lockfile.
- Shared packages (`packages/*` is already in the workspace globs) do not exist yet; decide how to share contracts when the first shared
  type is needed.

## Stack

```text
Next.js frontend (unchanged, Vercel)
  -> Express + TypeScript API (apps/api)         middleware -> controller -> service -> repository
  -> managed PostgreSQL (pg, parameterized SQL, node-pg-migrate SQL migrations)
  -> private S3-compatible object storage (signed URLs only; metadata stays in PostgreSQL)
```

Supabase is NOT used: no Supabase Auth, Storage, RLS or client library anywhere.

```text
apps/api/src/
  config/            env validation (zod), logger
  infrastructure/
    database/        pg pool + transactions (database.ts), migration runner and CLI
    auth/            Argon2id hasher (password.ts), JWT + refresh-token helpers (tokens.ts)
    storage/         StorageProvider interface, S3 implementation, key/MIME/size policy (file-storage.ts)
  middleware/        auth (requireAuth / requireRole / requireEventAccess), rate-limit, trusted-origin, errors
  modules/           auth, users, events (access rules), health   (more arrive per phase)
  shared/errors/
apps/api/db/         migrations/*.sql and seed.sql
```

Business logic (services) depends on repository/provider *interfaces*; only `infrastructure/` and the repositories know about `pg`,
argon2, jose or the AWS SDK.

## Identity, roles and profiles

```text
public.users                  account identity (id, email, name, organization, is_active). No secrets.
  ├─ public.user_credentials  Argon2id password hash (separate table; only the auth repository reads it)
  ├─ public.refresh_tokens    hashed refresh tokens, grouped in token families
  └─ public.user_roles        ADMIN | COACH | STAFF | PARENT | PLAYER (several allowed)

domain profiles (person data, optionally linked to a user via user_id)
   ├─ players          (+ player_parents -> parents, shared between siblings)
   ├─ parents
   └─ staff_profiles   profile_type COACH | STAFF  (+ staff_role for STAFF)
   (admins have a role only, no profile)

registrations          one per person per event; registrant_type PLAYER | COACH | STAFF;
                       exactly one of player_id / staff_profile_id
```

Coach and Staff are one table (`staff_profiles`) because the frontend treats them as the same kind of record (details, live photo,
certificates, admin approval, team invite, check-in). Certificates are `documents`, the AB 506 acknowledgement is a `consent`, the
approval is the registration status, a coach's team is `teams.coach_profile_id`. Roles live in `user_roles`, not on `users`.

## Authentication (implemented)

Authentication answers "who is this?"; it is separate from authorization ("what may they do?", below).

- **Passwords:** Argon2id (`argon2` package; 19 MiB, 2 passes, 1 lane = OWASP minimum, raise as hardware allows), stored in
  `user_credentials`; rehashed on login if parameters are weaker than current; 10 to 128 characters accepted. Login runs a dummy hash
  for unknown emails so response time does not reveal which emails exist.
- **Access token:** 15-minute HS256 JWT (`jose`) with `sub` (user id) and standard claims only. Roles, organization and active status
  are read from PostgreSQL on every request, so disabling an account or changing roles takes effect immediately. Sent as
  `Authorization: Bearer <token>`; the frontend keeps it in memory.
- **Refresh token:** 256-bit random opaque value (`crypto.randomBytes`), delivered only in an `HttpOnly`, `Secure` (in production),
  `SameSite` cookie scoped to `Path=/api/v1/auth`; never in a JSON body. Stored only as HMAC-SHA256 under `REFRESH_TOKEN_SECRET`.
  **Rotated on every use** inside a transaction with a row lock; presenting an already-rotated token is treated as theft and revokes
  the whole token family. Expires after `REFRESH_TOKEN_TTL_DAYS`.
- **Logout:** revokes the caller's token family (this device/session only); idempotent; clears the cookie. An access token already
  issued stays valid until it expires (at most 15 minutes) unless the account is disabled.
- **CSRF:** the cookie endpoints (refresh, logout) reject a present-but-foreign `Origin`. Prefer same-site hosting
  (`COOKIE_SAME_SITE=lax`, e.g. `app.example.com` + `api.example.com`). If frontend and API are on different sites, `none` is needed
  (HTTPS only) and the Origin check becomes the main CSRF defence.
- **Rate limiting:** login (per IP, and per target account counting failures only), register and refresh, answering `429 RATE_LIMITED`.
  Counters are in process memory: use a shared store (e.g. Redis) before running more than one API instance.
- **Endpoints:** `POST /api/v1/auth/register | login | refresh | logout`, `GET /api/v1/auth/me`.
  Codes: 401 `AUTH_TOKEN_MISSING | AUTH_TOKEN_MALFORMED | AUTH_TOKEN_INVALID | AUTH_TOKEN_EXPIRED | INVALID_CREDENTIALS | AUTH_REFRESH_*`;
  403 `ACCOUNT_DISABLED | USER_PROFILE_MISSING | INSUFFICIENT_ROLE | EVENT_ACCESS_DENIED | ORIGIN_NOT_ALLOWED`;
  409 `EMAIL_ALREADY_REGISTERED`.
- **New accounts have no roles.** Roles are granted separately (onboarding / admin); signup input can never grant one. There is no
  onboarding endpoint yet, so roles are currently granted in SQL.
- **Known trade-offs:** `register` reveals whether an email is taken (409). Two tabs refreshing the same token at the same moment trip
  reuse detection and sign the user out (no grace window). Email verification and password reset are not implemented.

## Authorization (implemented, in code, not in the database)

There is no row-level security. The API is the only database client; it authenticates every request and enforces access in
`middleware/auth.ts` and `modules/events/access-service.ts`. Constraints and triggers in the schema remain the last line of defence.
Connect with a dedicated, non-superuser database role.

- **ADMIN:** has the ADMIN role and the same `organization_id` as the event.
- **COACH / STAFF:** holds that role AND has a registration for THIS event of the matching type in an approved status (`VERIFIED` or
  `READY_FOR_EVENT`; `APPROVED_PERSONNEL_STATUSES`). A role alone, or a registration alone, grants nothing.
- **PLAYER / PARENT:** no event-level access; ownership-based access (own registrations, own children) is enforced in the
  registration/player modules when they are built.
- Middleware: `requireAuth` (401), `requireRole(...)` (403 `INSUFFICIENT_ROLE`), `requireEventAccess({ allow? })` (404 unknown event,
  422 malformed id, 403 `EVENT_ACCESS_DENIED`).

## Storage (infrastructure only; no document APIs yet)

A private S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Spaces...) configured by `STORAGE_*`. PostgreSQL holds metadata only
(`documents.storage_key`). The frontend never receives credentials: it gets short-lived presigned URLs (upload 10 min, download 5 min)
issued by `FileStorage` only after the calling module has authorized the user for the registration. Keys are generated server-side as
`<area>/<registrationId>/<uuid>`; downloads and deletes refuse any key outside the given registration; uploads are limited by MIME
type and size per area; downloads are served as attachments. The bucket must have no public ACL or policy.

## Players, guardians and registrations (Phase 4A, implemented)

`/api/v1/players` and `/api/v1/registrations` (PLAYER registrations only; coach/staff registrations come with their own phase).
Controller -> service -> repository; transactions live in the repositories (`repository.transaction(fn)`), so services stay free of `pg`.

**Ownership.** A player belongs to the account that IS the player (`players.user_id`, created with `forSelf: true`, PLAYER role) or to
accounts linked as a guardian (`parents.user_id` via `player_parents`, created by a PARENT). Owners read and edit; one SQL predicate
(`ownsPlayerSql`) defines this everywhere. An ADMIN can **read** (never edit) players and registrations of events owned by their own
organization. Anyone else gets **404** (not 403) so other families' records are not even confirmed to exist. There is no admin edit or
override. Coaches and staff get no access to family data in this phase.

**Data model.** The frontend's "guardian" (name, relationship, phone) is a `parents` row (reused for all of a family's children) plus
the relationship on `player_parents`; the first guardian is `is_primary`. The guardian's email is always the account email. Additional
guardians (`POST /players/:id/parents`) are records without an account (no anonymous guardian login exists). Registration data not
stored on the player: team (`team_id`), guests (`guest_count`, 0 to 10, the frontend's range), and the fee snapshot.

**Registration lifecycle.** `POST /registrations` creates a DRAFT (history row `null -> DRAFT`, audit `REGISTRATION_CREATED`).
`PATCH` edits a DRAFT only (team, guests); calling it repeatedly is "save as draft". `POST .../submit` moves DRAFT -> SUBMITTED after
checking completeness (team selected, active and in the event; at least one guardian when the player is under 18 on the event's local
start date) and fixes the fee. Every status change goes through `modules/registrations/transitions.ts`, which is the one definition of
the workflow; an illegal move is a 409 `INVALID_STATUS_TRANSITION`, never a silent change. Only DRAFT -> SUBMITTED is reachable now.
Registration status is the workflow position only: payment, documents, consent and check-in keep their own tables and are not
touched by this phase.

**Concurrency.** Duplicate creation is stopped by `unique(event_id, player_id)` with `ON CONFLICT DO NOTHING` (8 simultaneous requests
create exactly one registration and one history row). Submit and edit take a row lock (`SELECT ... FOR UPDATE`), so simultaneous
submits produce one 200 and the rest 409. Editing a player and submitting lock in a compatible order (no deadlock). A database trigger
refuses moving a registration to another event or person.

**Validation.** Zod, strict (unknown fields such as `status`, `userId`, `createdBy` are 422, not ignored). Phone and guest rules mirror the
frontend. Event must be PUBLISHED (DRAFT events are 404 to families, CLOSED are 409 `EVENT_NOT_OPEN`).

Decisions taken conservatively (confirm with the client):

1. A PLAYER/PARENT role is required to create players and registrations. Roles are still granted in SQL until onboarding exists.
2. A team is required to submit (the roster needs it). Teams are chosen by id; invite-code checking is not done yet.
3. "Minor" means under 18 on the event-local start date (`ADULT_AGE`); guardian is then required to submit. Consent itself is a later phase.
4. Once any registration of a player is past DRAFT the player's details are locked (409 `PLAYER_LOCKED`); corrections need an admin flow.
5. Guardians: another family's guardian record, or a guardian who has an account, is never attached to a child
   (409 `GUARDIAN_EMAIL_CONFLICT` / `PARENT_ACCOUNT_LINK_NOT_SUPPORTED`), because that would grant that account access to the child.
   Inviting a second guardian to use their own account is the pending guardian-authentication decision. A first-time parent whose email
   already exists as someone's guardian record gets 409 too (claiming it is undecided). Guardians cannot be unlinked yet.
6. After REJECTED the only move is CANCELLED, and a failed payment has no way back to SUBMITTED yet; the payment and review phases decide.
7. No cancel endpoint yet (the transition exists in the table); no admin listing of an event's registrations yet.
8. The frontend sends one guardian full name; the API takes `firstName` and `lastName`. Splitting is a frontend integration detail.

## Documents and consent (Phase 4B, implemented)

**Documents** (`modules/documents`) reuse the existing `documents`, `document_reviews` tables and the `FileStorage` / `StorageProvider`
abstraction (unchanged). Types are the frontend's player documents only: `PROFILE_PHOTO`, `BIRTH_CERTIFICATE`, `SCHOOL_ID`,
`SCHOOL_TRANSCRIPT`, `CALIFORNIA_KID_ID` (required: all except `SCHOOL_ID`). Coach/staff certificate types come with that phase.

Workflow (per document; a document step never edits the registration status itself, the readiness evaluator below reacts to it):

```text
POST /registrations/:id/documents/upload-url   server validates type/MIME/size, generates the key, returns a signed PUT URL   -> AWAITING_UPLOAD
   (browser PUTs the file straight to private storage with the signed URL; the API never sees the bytes)
POST /documents/:id/complete                   server reads the stored object back: size must match and the first bytes must
                                               match the declared type (PDF/JPEG/PNG/WebP signatures), else 422 and the file is deleted   -> UPLOADED
POST /documents/:id/submit                     owner sends it for review                                                     -> IN_REVIEW
PATCH /documents/:id/review                    ADMIN: APPROVED, or REJECTED with reasonCode + reason (notes optional, internal)  -> APPROVED | REJECTED
```

- **Replace / resubmit:** requesting an upload again replaces an unsubmitted document in place (same row, new key, the old file is
  deleted). A rejected document stays as history and a new upload creates a new row (at most 10 rejected attempts per type). A document
  in review or approved cannot be replaced (409). Documents of a CANCELLED or REJECTED registration are frozen.
- **State is derived** from `uploaded_at`, `submitted_at` and the review `status` (new columns; the review status itself is unchanged):
  `AWAITING_UPLOAD`, `UPLOADED`, `IN_REVIEW`, `APPROVED`, `REJECTED`. A document is reviewed once; there is no re-review yet.
- **Completeness** (`GET /registrations/:id/documents` -> `completeness`) says which required documents are `MISSING` / in what state and
  whether all are approved. It is information only: the same facts feed the readiness evaluator (Phase 4D-B0), which is the only thing that moves a registration past `PAYMENT_COMPLETED`.
- **Security:** the storage key is generated by the server as `<area>/<registrationId>/<uuid>` and never accepted from or returned to the
  client; file names are sanitized metadata only; downloads re-check the key belongs to the registration (403 `STORAGE_KEY_DENIED`);
  signed URLs live 10 minutes (upload) / 5 minutes (download), come with `Cache-Control: no-store`, and are never logged or audited;
  storage failures are 503 `STORAGE_UNAVAILABLE` with the cause only in the server log; without `STORAGE_*` configured, file operations
  are 503 `STORAGE_NOT_CONFIGURED` (metadata still works). Content sniffing checks file signatures; it is not a malware scan.
- **Access:** the owner uploads, submits and downloads. An ADMIN of the event's organization can read, download and review only
  *submitted* documents (not drafts a family is preparing). Everyone else gets 404. Every download-URL issuance is audited.

**Consent** (`modules/consents`) reuses `consents` (versioned, immutable wording published by the client) and `consent_records`
(append-only). The code contains no wording.

- `GET /registrations/:id/consents` returns the requirements (guardian consent is required when the player is under 18 on the event-local
  date), the current published version's text, and every acceptance ever recorded.
- `POST /registrations/:id/consents {consentId, signedName, accepted: true}` records one acceptance of that exact version, with the
  account, linked guardian record, time, IP and user agent (the last two are stored for audit and never returned). A minor's guardian
  consent must be signed by a linked guardian with an account; the signature must match that person's name (the frontend's rule).
- **Versions:** only the newest published version can be newly accepted (409 `CONSENT_VERSION_OUTDATED` otherwise). A new version never
  edits an old record; the family accepts it as an additional record, and the history keeps both. Duplicates of the same version are
  409 (also under concurrency). The database refuses edits and deletes of consent records and of published wording.
- There is no "declined" state in the schema, so only acceptances are recorded. Recording consent changes nothing else.
- Not built (pending decisions): guardian authentication without an account, email-based consent links, biometric consent (face phase),
  the final wording itself (published by the client into `consents`).

Open decisions for documents and consent:

1. Which documents are required follows the frontend today (all except School ID); confirm with the client.
2. Registration statuses where documents stay editable: all except CANCELLED and REJECTED. Confirm.
3. Admin re-review of an approved or rejected document is not supported; an approved document cannot be replaced.
4. Orphaned objects (a signed upload the family never completes) are not cleaned up by the API: add a storage lifecycle rule that expires
   unreferenced objects, and keep the bucket private.
5. The S3 inspection (`HeadObject` + ranged `GetObject`) and presigned upload/download are verified only against test doubles and local
   URL signing, never against a real bucket.
6. Whether admins may see a family's not-yet-submitted documents (currently: no).

## Registration readiness (Phase 4D-B0, implemented)

`modules/readiness`. One central, idempotent evaluator, `evaluateReadiness(registrationId)`, moves a PLAYER registration forward through the
EXISTING transition table (`registrations/transitions.ts`, via `assertTransition`) as the **system**: history rows have `changed_by = null`,
`metadata = {actor: "SYSTEM", source: "READINESS"}` and a reason, and one audit entry `REGISTRATION_READINESS_ADVANCED` records each run that moved something.
It never moves a registration backward, never rejects or cancels, never forces anything, and ignores coach/staff registrations (their workflow is a later phase).

| Status | Moves to | When |
| --- | --- | --- |
| `SUBMITTED` -> `PAYMENT_PENDING` -> `PAYMENT_COMPLETED` | payment satisfied | a `PAID` payment exists, or the fee fixed at submission is zero |
| `PAYMENT_COMPLETED` | `DOCUMENT_REVIEW` | every required document is submitted for review (in review or approved) |
| `DOCUMENT_REVIEW` | `VERIFIED` | every required document is approved |
| `VERIFIED` | `READY_FOR_EVENT` | payment satisfied AND documents approved AND required consent accepted |

It advances as many steps as the facts allow in one run (e.g. a payment that arrives last carries a registration from `PAYMENT_PENDING` to `READY_FOR_EVENT`).
**A face profile is never required**: manual check-in must remain possible. Face enrollment does not touch readiness.

**Single sources of truth reused, not copied:** the required documents and "approved" (`documents/completeness.ts`, `documents/state.ts`, extracted unchanged
from the documents module); the consent rule (`consents/requirements.ts`: guardian consent is required for a minor on the event-local date and never for an
adult, and "accepted" means the CURRENT published version; the consent API now uses the same function); the workflow (`transitions.ts`). The rules themselves are pure
(`readiness/rules.ts`) and tested as a full matrix.

**Zero-fee registrations.** The existing model had no zero-fee state (`PAYMENT_NOT_REQUIRED` at checkout, no payment row). Smallest safe solution: payment counts as
satisfied when `registrations.fee_cents` (fixed at submission) is 0, the evaluator walks the existing `PAYMENT_PENDING -> PAYMENT_COMPLETED` steps with the reason
"System: no payment required (fee is zero)", and **no payment record and nothing Stripe-related is created**. Submitting itself is unchanged, so a free registration advances
at its first later trigger (document submission, review, consent) or on demand, not at submit.

**When it runs.** (a) Inside the payment webhook's own transaction (the payment and the workflow it unlocks commit together; a forced failure rolls both back and Stripe's
retry applies them). (b) Right AFTER a document submission, a document review, or a consent record has committed, in a separate transaction. Evaluating inside those
transactions is deliberately avoided: they hold a SHARE lock on the registration row, and two of them upgrading to the evaluator's exclusive lock at the same moment would
deadlock (concurrent reviews of different documents are tested). If that follow-up evaluation fails, the document or consent change is still reported as done, the error is
logged (ids only) and the next trigger or `POST .../readiness/evaluate` catches up (tested). The evaluator locks the registration row first and holds nothing else,
so concurrent runs queue and each step happens exactly once (tested with simultaneous evaluations, approvals, consent and a payment webhook).

**API:** `GET /api/v1/registrations/:id/readiness` (read-only: status, `ready`, `blockers`, payment / documents / consent facts) and
`POST /api/v1/registrations/:id/readiness/evaluate` (idempotent recovery; empty body, anything else is a 422). Owner, or admin of the event's organization; everyone else 404.
There is no way for a client to supply a status or force a step, and no admin override.

Decisions and caveats (confirm with the client):

1. Meaning of the positions above (in particular that `DOCUMENT_REVIEW` = all documents submitted and `VERIFIED` = all documents approved, with consent only required for `READY_FOR_EVENT`).
2. A rejected document does not reject or reverse the registration; it waits (status stays `DOCUMENT_REVIEW`) until the document is replaced and approved. Rejecting a registration is a separate admin decision that does not exist yet.
3. Consent is judged at the current published version. If new wording is published while a registration is still waiting, the family must accept the new version; if no wording
   is published at all, a required consent cannot be met and a minor's registration stays `VERIFIED`. (Once `READY_FOR_EVENT`, a registration is not moved back.)
4. No regression: a refunded payment or a later problem leaves a `READY_FOR_EVENT` registration where it is; `readiness.blockers` shows the regressed requirement as a warning.
   Event-day checks should re-verify (planned for the check-in phase). Refunds are not handled by the payments module yet.
5. Free registrations advance lazily (see above) rather than at submit, to leave the submit endpoint unchanged.
6. `READY_FOR_EVENT` does not check the event window, `event_access_disabled`, or that the team is still active; those belong to event-day check-in.

## Face recognition foundation (Phase 4D-A, implemented: enrollment only)

Provider-independent. One real provider is registered, **`node-native`** (`infrastructure/face/providers/node-native.provider.ts`): face-api
(`@vladmandic/face-api`) on its pure-JS/WASM TensorFlow backend, running inside this API in a worker thread, with `sharp` decoding the image. No
cloud service, no native module, no Python; the model weights ship in the npm package. A fake exists only in the tests.
- **Templates.** A face_profiles row still holds only the opaque reference. The 128-number descriptor lives in `face_templates`, owned by the adapter:
  `nonce || AES-256-GCM ciphertext || tag` under `FACE_ENCRYPTION_KEY`, with the reference as authenticated data, so a row cannot be moved to another
  reference. Removing a profile deletes the template. No endpoint returns it. Losing the key makes every enrolled face unreadable (re-enroll).
- **Enrollment.** Automatic when an admin approves a player's PROFILE_PHOTO, if face recognition is configured and the guardian accepted the optional
  `BIOMETRIC_CONSENT` (`FACE_CONSENT_CODE`); otherwise skipped and the player is checked in by hand. The approval never fails because of it. If the guardian
  consents AFTER the photo was approved, recording the consent enrolls that photo at once (the consent never fails because of it either). A family can
  still enroll explicitly (`POST /players/:id/face-profile`). The consent is optional and never holds a registration back; its approved wording is
  published by migration `20261013000002_biometric_consent_wording.sql` (consent text is immutable: a new wording is a new version).
- **Matching.** Euclidean distance between descriptors, mapped to the 0..1 similarity the shared policy uses (0.4 -> 0.90, 0.6 -> 0.75); only ACTIVE
  profiles are searched. At the door one dominant face is scanned (several similar faces: `MULTIPLE_FACES`); enrollment requires exactly one.
- **Scanner.** `AdminScanScreen` sends the camera frame, in natural (un-mirrored) orientation even from a front camera, to `POST /events/:id/face-scan` and, only for a clear MATCH of someone cleared to enter, checks in with
  `{method:"FACE", scanId}`. A doubtful match is shown to staff and confirmed as a manual check-in.
Twins/duplicates and retention are not part of this phase.

```text
application (modules/face) -> FaceRecognitionProvider (infrastructure/face/face-provider.ts) -> one adapter file per provider (later)
```

**The interface** (`enroll`, `remove`, `identify`, `verify`) uses only application types: an image (bytes + type), our player id as an opaque
`subjectId`, an idempotency key, an abort signal, an opaque `reference` back, a 0-to-1 `similarity` (each adapter normalizes its own scale, the
decision threshold is application policy), and `FaceProviderError` codes (`NO_FACE_DETECTED`, `MULTIPLE_FACES`, `LOW_QUALITY`, `IMAGE_REJECTED`,
`UNAVAILABLE`, `TIMEOUT`). `remove` must succeed when the identity is already gone. Provider SDK types stay inside the adapter. A reusable contract
suite (`tests/helpers/face-provider-contract.ts`) defines the behaviour any adapter must pass; it runs against two different fakes now and must be run
against a real adapter's sandbox before it is registered in `provider-registry.ts` (the single place to plug it in).

**What is stored.** `face_profiles` keeps: the player, the provider NAME, the provider's opaque reference, status (`ACTIVE`/`REVOKED`), the registration
photo document it was enrolled from (`source_document_id`), the consent record it was enrolled under, who enrolled/removed it and when, and a short
revocation code. There is no column for an image, template or embedding (a test asserts the column list). The photo is the existing private
`PROFILE_PHOTO` document: it is read into memory for the provider call (`ObjectReader`, a new read-only capability beside the unchanged
`StorageProvider`/`FileStorage`), never copied, written elsewhere, logged or given a public URL; the provider receives only our player id, never a name or date of birth.
One ACTIVE profile per player across all providers (existing unique index): switching provider means removing first (tested).

**API** (`/api/v1`, no anonymous access):

```text
POST   /players/:playerId/face-profile   {documentId}   enroll from that approved registration photo     (PARENT/PLAYER owner)
GET    /players/:playerId/face-profile                  NOT_ENROLLED | ACTIVE | REVOKED + timestamps    (owner, or admin of an organization the player is registered with)
DELETE /players/:playerId/face-profile                  delete at the provider, then revoke               (owner only)
```

Responses contain no provider name, reference, score or image. Admins can read status only; they cannot enroll or remove (no override).

**Enrollment rules.** The photo must be a `PROFILE_PHOTO` of this player that an admin has APPROVED (an unreviewed photo could be anyone's face) on a registration
that is not cancelled/rejected; the stored file must really be a JPEG/PNG/WebP. Concurrent requests serialize on a per-player lock: of N simultaneous
requests exactly one calls the provider and one profile is created. The provider is called inside the transaction with a deadline (`FACE_PROVIDER_TIMEOUT_MS`,
abort signal passed). If anything fails after the provider created an identity (database error, audit error), the identity is removed again; if that cleanup
itself fails it is logged (player id only) for manual cleanup. Removal asks the provider first: if it fails the profile stays ACTIVE and removal can be retried.
Provider errors become 422 (image problems, with the reason code) or 503, with the provider's text only in the scrubbed server log. Audit records
`FACE_PROFILE_CREATED` / `FACE_PROFILE_REMOVED` with ids only. Enrollment changes no registration, payment, document or consent state (tested).
A face profile can never be deleted, reassigned or reactivated in the database (REVOKED rows remain as the record that an enrollment existed).

**Biometric consent: a pending product decision, nothing is assumed.** No biometric consent wording or code exists. `FACE_CONSENT_CODE` decides:
unset = enrollment disabled (503 `FACE_CONSENT_POLICY_NOT_CONFIGURED`); `NONE` = explicitly waived by the operator (startup warning); a consent code =
that consent, at its CURRENT published version, must be on record for the photo's registration (409 `BIOMETRIC_CONSENT_REQUIRED`), and the record is linked.
To use a real consent: the client publishes the wording as a new `consents` row, and the code is added to `PLAYER_REGISTRATION_CONSENT_CODES` in
`modules/consents/types.ts` so families can accept it through the existing consent endpoint.

**Configuration to add later, per provider** (none are set now): `FACE_PROVIDER` (adapter name), `FACE_PROVIDER_API_KEY`, `FACE_PROVIDER_URL`, and whatever that
provider needs (region, project/collection id, similarity thresholds), plus `STORAGE_*` (the photo is read from private storage).

Open decisions for face recognition:

1. Which provider; where it stores data (region, sub-processors, contract); its template/identity retention at the provider.
2. The biometric consent policy and wording above, including guardian consent for minors and re-consent when the wording changes.
3. Retention and deletion policy: how long a profile and the source photo may exist, deletion on request / after the season, and what happens to REVOKED
   rows. Only user-initiated removal exists. Admin-initiated removal is not provided.
4. Whether enrollment should wait for admin approval of the photo (implemented: yes, conservative) and whether the player or the system should trigger it.
5. Per-event vs per-player profiles (implemented: one per player), re-enrollment limits, and twins/duplicate detection.
6. An orphaned provider identity after a crash between the provider call and the commit cannot be detected automatically; provider-side reconciliation is not built.
7. Coach/staff enrollment (the table supports it; no API yet).

## Event-day check-in (Phase 4D-B2, implemented backend foundation)

Scope: scan, check-in and search endpoints and their rules. Not in scope (later): a real face-provider adapter, frontend integration, offline
check-in, coach/staff scanner access, any override.

**Flow.** `POST /events/:eventId/face-scan` records a scan on the server; `POST /events/:eventId/check-ins` with `{method:"FACE", scanId, clientRequestId}`
turns a valid scan into a check-in. The client never says who was recognized: the player is derived from the scan row.

**Authorization.** `requireAuth` + `requireEventAccess({allow:['ADMIN']})`: only an ADMIN of the event's organization. The model already supports
approved COACH/STAFF as a second access level (`PERSONNEL`), but no coach/staff registration API exists and whether they may run the scanner is a
**pending product decision**; changing it is one `allow` list. PLAYER and PARENT never operate scanners. Authentication and authorization happen before
the body is read; scan and search are rate limited per operator (60/min each).

**Eligibility** (`modules/eventday/eligibility.ts`), re-derived from the database at every check-in, reusing the readiness fact-gathering (one definition of
payment / documents / consent): registration belongs to the event and is a player registration; event is `PUBLISHED` (the rule registration already
uses); status `READY_FOR_EVENT`; `event_access_disabled = false`; payment satisfied (PAID, or fee 0); required documents approved; required consent accepted
at its current version; for FACE only, the matched face profile is still ACTIVE. Failures are structured reason codes (`PAYMENT_NOT_COMPLETED`,
`DOCUMENTS_NOT_APPROVED`, `CONSENT_NOT_ACCEPTED`, `EVENT_ACCESS_DISABLED`, `REGISTRATION_NOT_READY`, `EVENT_NOT_OPEN`, `FACE_PROFILE_NOT_ACTIVE`,
`REGISTRATION_NOT_FOUND`), nothing personal. There is no override and no manual bypass.

**Event window: not modelled.** Events have `starts_at`/`ends_at` and a DRAFT/PUBLISHED/CLOSED status, but no door-open / check-in window, and inventing one
is a product decision (how early may people arrive? may a CLOSED event still check people in on the day? what about multi-day events?). Until decided the
only event rule is `PUBLISHED`. The service is provider-independent and the window would be one more fact in `reasonsFor`.

**Matching policy** (`modules/eventday/matching.ts`, pure, application-side; thresholds from `FACE_MATCH_THRESHOLD`, `FACE_REVIEW_THRESHOLD`,
`FACE_AMBIGUITY_MARGIN`; the provider deadline from `FACE_SCAN_TIMEOUT_MS`; the defaults 0.90 / 0.75 / 0.05 / 5 s are provisional and must be calibrated):
the provider's global index is asked for 10 candidates (`identify()` only); each reference is mapped to an ACTIVE face profile, its player, and **a registration
for this event**: anything else is dropped as if it did not exist, so a player registered only elsewhere is NO_MATCH and nothing about other events or
organizations can be learned or can influence the result. Then: nothing at or above the review threshold -> **NO_MATCH**; best below the match threshold ->
**REVIEW_REQUIRED** (LOW_CONFIDENCE); two or more at/above the match threshold -> REVIEW_REQUIRED (MULTIPLE_STRONG_CANDIDATES); leader within the margin of the
runner-up -> REVIEW_REQUIRED (AMBIGUOUS_MATCH); one clear leader -> eligibility is run, and only an eligible player is a **MATCH** (an ineligible clear match is
REVIEW_REQUIRED / NOT_ELIGIBLE with the reason codes). Eligibility is deliberately applied *after* the ambiguity check, not before: filtering out an ineligible
look-alike first could auto-check-in the wrong twin. A review answer names at most three people (registration number and first name + last initial) and
can never be turned into a check-in. Scores, provider references and candidate lists are never returned or stored (only a MATCH keeps its score).
Provider failures (no face, multiple faces, low quality, timeout, unavailable) are safe structured errors; the provider's own text is never returned and
only a scrubbed cause is logged. With no provider configured the scan answers 503 `FACE_NOT_CONFIGURED`: nothing is recorded and nothing is fabricated.

**Check-in** (one transaction): lock the scan row (FOR UPDATE) -> idempotent replay lookup by `clientRequestId` -> validate the scan (exists, this event, this
operator, MATCH, not older than 120 s, not already used) -> resolve the registration from the scan's player -> eligibility re-run holding the registration
FOR SHARE (an admin cannot disable access between the check and the insert) -> `insert ... on conflict do nothing` -> audit. Another event's or operator's scan
is 404 (nothing revealed). The database is the final guard: `unique(registration_id)`, `unique(face_scan_id)`, `unique(client_request_id)`, the ready/disabled trigger
and the valid-scan trigger (see database.md).

**Concurrency and idempotency.** Two scanners on one player: one 201, the other a controlled 409 `ALREADY_CHECKED_IN` (tested with 8 parallel requests and with two
operators' scans on real PostgreSQL). One scan used twice at once: one 201, the rest 409 `SCAN_ALREADY_USED`. `clientRequestId` (required UUID, generated once per attempt,
resent unchanged on retry): the same id creates one check-in and an exact retry (also concurrent) returns it with 200 `idempotentReplay: true`, even if the player's
state changed since; the id cannot be replayed for a different registration, event, operator, scan or method (409 `CLIENT_REQUEST_ID_REUSED`).

**Manual** (`method: "MANUAL"`): the client sends the registration id from search; the server checks it belongs to the event (404 otherwise) and runs the same
eligibility, except that no face profile is needed. **Search**: event-scoped through `registrations`, minimum 3 characters, 20 results (with `truncated`), exact
for registration number / school ID / date of birth, name by prefix on first or last name (every word must match), no fuzzy search (`pg_trgm` is not enabled),
parameterized SQL, DRAFT and CANCELLED hidden; returns only registration id and number, first/last name, team name, a `ready` hint and `checkedIn`.

**Audit** (ids, result and reason codes only; never image bytes, scores, provider data, references, URLs, keys or tokens): `FACE_SCAN_PERFORMED` (every scan, including
failed ones), `CHECK_IN_COMPLETED`, `CHECK_IN_REFUSED` (written outside the rolled-back transaction).

**Privacy.** The image arrives over HTTPS as the raw request body (2 MiB cap, only after authorization), stays in memory for one `identify()` call and is never written,
logged (request logging records method and path only) or audited. Wiring note: scanning uses the provider from `faceRecognition`, which `server.ts` currently builds
only when `STORAGE_*` is also set (enrollment needs it); a scan-only deployment would relax that.

**Open product decisions:** the event window; whether COACH/STAFF may operate the scanner (and staff face profiles/check-in, which `face_profiles`/`face_scans` already
allow); final thresholds and margin per provider; scan lifetime (120 s) and whether a provider collection should be scoped per event/organization instead of a
global index (a busy multi-organization index can crowd out the 10 requested candidates); whether to also surface a REVIEW_REQUIRED outcome for ineligible players
at all; offline check-in reconciliation (the frontend queue keys on the registration number).

## Decisions for later phases (not implemented)

1. COACH/STAFF roles may be assigned at signup/onboarding; permissions still come from event access + registration approval.
2. Coach/staff registrations have no payment step and no payment records; the per-type status path is defined in Phase 5.
3. **Guardian / parent authentication is a pending product decision.** No anonymous or email-link guardian access exists; guardians
   need a normal account (`parents.user_id`) for now.
4. The admin check-in override is not implemented (below).

## Admin "check in anyway" override

What the frontend does today (checked in `src/`): **there is no override.** `markPresent(id, method, override)` is only ever called with
`override = false`; `AdminScanScreen`, `ManualCheckInPanel`, `AdminUserHeader` and `accessCompliance.ts` all state "there is no
override"; a blocked person is resolved on their profile instead (approve documents, "Clear Flags & Approve", or the admin
Enable/Disable access toggle). An earlier version had a "Check In Anyway" button for flagged-but-approved people (removed in commit
`a240aa8`); the `override` field that remains is leftover plumbing (and a stale comment in `src/lib/seed.ts`).

Backend decisions:

- The normal rule is unchanged and enforced by the database: only `READY_FOR_EVENT` registrations whose `event_access_disabled` is false
  can be checked in (trigger on `check_ins`). It is not relaxed for anyone.
- The frontend's **Disable access** toggle is modelled as `registrations.event_access_disabled` (+ reason) and blocks check-in at the
  database level too.
- An override is **not implemented**. If the client wants it back, it is a Phase 10 rule: only the ADMIN role; a written reason; limited
  to registrations that are otherwise approved (never `CANCELLED`, `REJECTED`, or access-disabled); recorded on the check-in
  (`override_by`, `override_reason`) and in `audit_logs`; enforced in a PostgreSQL function and its own trigger branch, not by
  loosening the current trigger. Needs the client to confirm it is wanted and which flags it may bypass.

## Time

- Every instant is `timestamptz` (UTC). No migration depends on the session time zone.
- `events.timezone` is an IANA zone name, required, with no database default (each event states it; the admin UI or API may pre-fill a
  default). It is used only to display event-local times and to decide which local calendar day an instant falls on. No business logic
  hard-codes a zone.
- `players.date_of_birth` is a plain date. Age and division are computed against the event's local date (using `events.timezone`),
  never the server's.
- The API must validate `timezone` against the IANA database and convert in code, not by string comparison.

## Payments (Phase 4C, implemented)

`modules/payments` + `infrastructure/payments`. The old requirement ("webhook handling MUST be idempotent") is met; see below.

```text
browser -> POST /api/v1/registrations/:id/payment -> API creates a Stripe Checkout Session (hosted page) -> {checkoutUrl}
browser -> redirected to Stripe, pays there (card data never touches this server)
Stripe  -> POST /api/v1/webhooks/stripe (signed)   -> API verifies the signature, applies the event once, updates payment + registration
browser -> returns to /register/player/payment-return?status=...&registrationId=...   (the existing frontend page: informational only)
browser -> GET /api/v1/registrations/:id/payment   to show the real, webhook-confirmed state
```

**Source of truth.** Only a webhook with a valid signature can mark a payment PAID. The browser's return page proves nothing, and the
backend is correct if the browser never comes back (tested). Hosted Checkout needs no publishable key on our side.

**Amount.** Always the registration's own `fee_cents`/`currency`, fixed when the registration was submitted (from `events.registration_fee_cents`).
The request body must be empty (strict); a client-supplied amount, currency or status is a 422. A paid event notification whose amount or
currency differs from the payment is rejected (`AMOUNT_MISMATCH`, audited) and never marks the payment paid.

**Payment state** reuses the existing `payments.status` vocabulary: `PAYMENT_PENDING`, `PAID`, `FAILED`, `CANCELLED` (and `REFUNDED`, not used yet).
It is independent of documents, consent and check-in. The one coupling is the registration's workflow step, defined in
`registrations/transitions.ts`: creating a checkout moves `SUBMITTED -> PAYMENT_PENDING`; a confirmed payment moves
`PAYMENT_PENDING -> PAYMENT_COMPLETED`. The payment code itself never makes a registration `VERIFIED` or `READY_FOR_EVENT`: after it completes the payment step, the readiness evaluator (below) decides, from documents and consent as well, whether the registration can go further.

| Event | Payment | Registration |
| --- | --- | --- |
| checkout created | `PAYMENT_PENDING` (any earlier open checkout is closed at Stripe first, then `CANCELLED` / `SUPERSEDED`) | `SUBMITTED -> PAYMENT_PENDING` (history by the user) |
| `checkout.session.completed` / `async_payment_succeeded`, paid | `PAID` (also from `FAILED`/`CANCELLED`: money wins over an earlier state) | `PAYMENT_PENDING -> PAYMENT_COMPLETED` (history by the system); unchanged if it is in any other state |
| `checkout.session.completed`, unpaid (async method) | unchanged (waits for the later event) | unchanged |
| `checkout.session.async_payment_failed` | `FAILED` | unchanged (retry is possible without moving the registration back) |
| `payment_intent.payment_failed` | stays `PAYMENT_PENDING`, short failure code recorded (the customer can retry on the same page) | unchanged |
| `checkout.session.expired` | `CANCELLED` / `CHECKOUT_EXPIRED` | unchanged |
| paid, but the registration already has a PAID payment | `CANCELLED` / `DUPLICATE_NEEDS_REFUND`, audited as rejected | unchanged |

**Idempotency.** Every handled event is inserted into `payment_webhook_events (provider, event_id)` (primary key) in the SAME transaction that
applies it. A replay, sequential or simultaneous, finds the row and does nothing; two simultaneous deliveries serialize on the key, so exactly
one applies (10 at once is tested). If anything fails the whole transaction (including the event row) rolls back and the provider's retry applies it,
so a payment can neither be applied twice nor lost. An event that references one of our payments we cannot find yet answers 409 so Stripe
retries; events with no reference of ours, and event types we do not use, are acknowledged. Event rows cannot be deleted.

**Retry and concurrency.** Starting a checkout takes a per-registration advisory lock (without locking the registration row), closes the previous
checkout at Stripe, and never starts a second one when Stripe reports the old session already completed (409 `PAYMENT_IN_PROGRESS`; the webhook will
confirm it). The database allows at most one open and one PAID payment per registration. If creating the Stripe session fails, the whole step rolls
back (503, nothing created) and the user can retry.

**Security.** Webhook signature is verified over the raw bytes by the Stripe SDK before anything is parsed (route mounted before the JSON parser and
before the rate limiter). The Stripe SDK is imported in one file (`stripe-provider.ts`); everything else sees provider-neutral events. API
responses never contain Stripe ids, checkout links are `no-store` and never logged or stored, only short failure codes are kept (no provider
messages), no card data is stored, and errors from Stripe are scrubbed of keys/secrets/signed links before logging (`shared/utils/scrub.ts`).
Invalid-signature attempts are logged (IP only) rather than written to `audit_logs`, which an unauthenticated caller could flood.

**Access.** The owner (PARENT/PLAYER) starts and reads payment state; an admin of the event's organization can read it; everyone else gets 404; admins cannot start or change a payment.

Open decisions for payments:

1. **Amount/fee.** The fee comes from `events.registration_fee_cents` (the frontend's `REGISTRATION_FEE = 95` is display-only today and must be replaced
   by this value). Currency is USD. Taxes, coupons, and per-division pricing are not modelled.
2. **Free events (fee 0)** need no payment; nothing moves such a registration to `PAYMENT_COMPLETED` yet (409 `PAYMENT_NOT_REQUIRED`).
3. **Refunds and duplicate charges** are not automated: a duplicate charge is flagged (`DUPLICATE_NEEDS_REFUND`, audit) for manual refund in Stripe,
   and `charge.refunded` is not handled yet. A payment confirmed for a cancelled registration is recorded but the registration is left alone.
4. **Abandoned checkout** (customer clicks back on Stripe) sends no event: the payment stays pending until it expires (31 minutes) or is superseded.
5. **Success/cancel URLs** use the first `FRONTEND_URL` origin plus the existing return path; confirm the production URL.
6. **Stripe account setup** (not done here): create the webhook endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, and set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
   Behaviour against real Stripe (session creation, expiry, real signed deliveries) is unverified; only the SDK's own signing/verification is exercised.
7. A user can start a new checkout up to 10 times a minute per IP (rate limited); there is no per-registration cap on retries.

## Biometric data (TODO before any real face data is enrolled)

Current approach, unchanged: our database stores only the provider's profile/reference ID (`face_profiles`) and scan outcomes
(`face_scans`). No templates, embeddings or raw face images are stored by us, and logs redact image/template fields. No face provider
is implemented (no fake one either).

Open items that need the client's and counsel's written approval (nothing is assumed):

- **Retention period** for provider profiles and scan records (e.g. delete at season end?).
- **Deletion**: deleting at the provider, not only revoking our row; guardian-initiated deletion for minors; what happens to
  `face_scans` history.
- **Provider storage**: where the provider stores data (region, sub-processors), what it retains, contract/DPA.
- **Consent**: approved biometric-consent wording for minors, collected per person and versioned (`face_profiles.consent_record_id`);
  enrolment must be refused without it.
- **Privacy requirements** that apply (state law, e.g. California, and any school/league rules).

## Push notifications (implemented)

Web Push (VAPID) tells a registrant's devices when a document is accepted or rejected (with the reviewer's reason) and when the
registration becomes `READY_FOR_EVENT` (event-day access). Backend, module `modules/notifications`:

- **Triggers are real backend events, after commit, never from the frontend:** `documents.review` (accept/reject),
  and any readiness evaluation that moves a registration into `READY_FOR_EVENT` (document review, consent, the `readiness/evaluate`
  endpoint, and the payment webhook). Modules receive a `NotificationPublisher`; calls never throw, so a push problem can never fail a
  review, registration or payment. Duplicate webhooks and repeated evaluations do not re-notify (only an actual transition does).
- **Recipients** are the accounts that own the registration (the player's own login, their guardians, or the coach/staff member),
  resolved on the server; every device of each.
- **Storage:** `push_subscriptions`, one row per browser endpoint (unique), owned by the authenticated user. Subscribing again from the
  same browser refreshes the row (no duplicates); if another user signs in on that browser the row moves to them. At most 10 devices per
  user (oldest dropped). A 404/410 from the push service deletes the row; other failures are counted and the row is removed after 5 in a row.
  Keys are never returned by the API.
- **API:** `GET /api/v1/notifications/push/public-key`, `POST|DELETE /api/v1/notifications/push/subscriptions` (all need sign-in; 503
  `PUSH_NOT_CONFIGURED` without VAPID keys).
- **Payload** is typed (`NotificationPayload`) and the wording/destination per type lives in `templates.ts` (overridable per type).
- **Config:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (all or none; generate once with `npx web-push generate-vapid-keys` and
  keep them stable). Without them push is off and nothing else changes.
- **Frontend:** a bell in the top bar asks permission only when tapped; `public/sw.js` shows the notification and opens the linked page on
  click (same-origin paths only, reusing an open window). Sign-out removes this device's subscription. The service worker is registered in
  production builds only, so push works there (and not in `next dev`). iOS needs the app installed to the home screen.
- **Known limits:** deliveries are attempted once inline (no queue/retry); `pushsubscriptionchange` is handled by re-syncing when the app is
  next opened (the worker has no access token). Coach/staff "event-day access" notification is sent at `READY_FOR_EVENT`, not at `VERIFIED`.

## Consent text

All consent text in this repo is placeholder. The seed marks every consent `[DEV PLACEHOLDER ... NOT LEGAL TEXT]`.
**TODO(client): approved wording for the guardian consent, AB 506 acknowledgement and biometric consent must be supplied before
production.** Consent text is immutable once inserted; approved text is published as a new version. The seed never runs in production,
so placeholder rows cannot ship through it.
