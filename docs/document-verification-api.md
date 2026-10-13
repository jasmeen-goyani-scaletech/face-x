# Document verification and notifications

Document decisions are real and live in the API (`apps/api/src/modules/documents`):

- `PATCH /api/v1/documents/:documentId/review`: an admin of the event's organization approves, or rejects with a reason code
  (`UNREADABLE`, `WRONG_TYPE`, `NAME_MISMATCH`, `EXPIRED`, `CUSTOM`) and the text the registrant reads. Decisions are append-only
  (`document_reviews`), audited, and the reviewer is the signed-in admin taken from the session, never from the body.
- A rejected document stays on record; the registrant uploads a replacement, which returns to the review queue.
- Once every required document is approved (and, for players, payment and consent are done) the registration advances by itself
  (`modules/readiness`).
- `GET /api/v1/documents/:documentId/download-url` gives an admin a short-lived signed link to view a file (audited).

**Not built: delivering a notification.** Nothing is emailed or pushed when a decision is made. The registrant sees the outcome (and the
rejection reason) the next time they open their registration. Sending email/SMS/push needs a provider and sender decision first
(see `docs/deployment.md`, "Decisions and unknowns").

## AI field extraction (OCR by a language model)

`POST /api/v1/documents/:documentId/extract` reads a fixed set of fields off one uploaded document and compares them with the
profile on record, so the reviewer can see a likely `NAME_MISMATCH` or `EXPIRED` at a glance. It is an aid: the admin still decides.

- **Who:** the document's owner (the player or a linked guardian; the coach or staff member), or an ADMIN of the event's organization
  once the document is submitted. Everyone else gets 404, as for every other document endpoint. Rate limit: 10 calls per user per minute.
- **Synchronous and not stored:** every call sends the file to the provider again; there is no table and no cache. Call it once after
  upload (or when the reviewer opens the document), not on every page view.
- **Which fields** (server-side, `apps/api/src/modules/extraction/fields.ts`):

  | Document type | Fields | Compared with |
  | --- | --- | --- |
  | BIRTH_CERTIFICATE, CALIFORNIA_KID_ID, SCHOOL_TRANSCRIPT | firstName, middleName, lastName, fullName, dateOfBirth | first/last name, full name, player's date of birth |
  | SCHOOL_ID | fullName, studentId, schoolName, schoolYear | full name |
  | FIRST_AID_CPR, YALF_TACKLE, SAFESPORT, BACKGROUND_CHECK | fullName, issueDate, expiryDate, issuer | full name; expiry on or after the event's local start date |
  | PROFILE_PHOTO | none | 422 `DOCUMENT_NOT_EXTRACTABLE` |

  Names compare ignoring case, accents and hyphens/spaces ("MATEIALONA HOWE" = "Mateialona-Howe"); a full name matches when every part
  of the profile's first and last name appears in it. Age is never read off the document (a printed age goes stale): it is computed
  from the extracted date of birth at the event date and returned as `derived.age`.
- **Response** (`200`):

  ```json
  {
    "documentId": "…", "documentType": "BIRTH_CERTIFICATE", "status": "SUCCEEDED",
    "fields": { "firstName": { "value": "TAI", "match": "MATCH" }, "middleName": { "value": "MATTHEW", "match": null }, "…": {} },
    "derived": { "age": 15 },
    "model": "gpt-5.6-luna-…"
  }
  ```

  `match` is `MATCH`, `CLOSE`, `MISMATCH`, `NOT_FOUND` (the document gave no usable value) or `null` (reported only). `CLOSE` is
  for names only: off by about one letter per six of the name on record (names under six letters must match exactly). It is
  usually the model misreading small or typed print, so the UI should show it as "check by eye", neither confirmed nor flagged.
  A failed read is still a `200` with `status: "FAILED"`, empty `fields` and `failureReason`: `UNREADABLE` (nothing legible, refused, or cut off), `UNSUPPORTED`
  (file type or size the provider cannot take), `TIMEOUT` (`EXTRACTION_TIMEOUT_MS`, default 20 s) or `PROVIDER_ERROR`.
- **Errors:** `404 DOCUMENT_NOT_FOUND`, `409 UPLOAD_NOT_COMPLETE`, `422 DOCUMENT_NOT_EXTRACTABLE`, `429`, `503 EXTRACTION_NOT_CONFIGURED`
  (no `EXTRACTION_PROVIDER` or no storage), `503 STORAGE_UNAVAILABLE`.
- **Provider:** `EXTRACTION_PROVIDER=openai` with `OPENAI_API_KEY` (see `apps/api/.env.example`). The Responses API is called with
  Structured Outputs (a strict JSON schema), `store: false`, no reasoning by default and at most 500 output tokens. JPEG/PNG go as
  images; PDF and DOCX as files (OpenAI reads a PDF's text and page images, a DOCX's text only). Legacy `.doc` is not accepted at upload.
- **Uploads:** documents may now be PDF, JPEG, PNG or DOCX, each up to `DOCUMENT_MAX_BYTES` (default 5 MiB, at most 10 MiB).

### Privacy

- Minors' identity documents (birth certificates, IDs, transcripts) are sent to OpenAI on each call. Requests use `store: false`. Before
  go-live: request **Zero Data Retention** for the API key's organization (otherwise OpenAI may keep inputs up to 30 days for abuse
  monitoring) and list OpenAI as a **subprocessor** in the privacy notice and the consent wording families accept.
- The uploaded file name is never sent (it often contains the child's name); the provider sees `document.<ext>`.
- Extracted values exist only in the HTTP response (`Cache-Control: no-store`). Logs carry the outcome, model, duration and token counts,
  never a value; errors are scrubbed (`shared/utils/scrub.ts`, which now also redacts OpenAI keys).

### Cost (gpt-5.6-luna, from OpenAI billing)

The OpenAI dashboard billed 9 live test calls $0.002: **about $0.0002 per image call** (1.2k–2.2k input and ~50 output tokens,
1.5–3.5 s). A 2-page PDF is estimated at about $0.0006. An event of ~2,200 documents costs about $0.80 when admins extract once per
review, or about $1.70 if registrants are also checked after upload; 100,000 calls a year is about $30. gpt-4.1-mini costs about
$0.001 per call. The full breakdown, and how the frontend's call pattern drives it, is in
`docs/document-extraction-frontend-guide.md` (section 8).
