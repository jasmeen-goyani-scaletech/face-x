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
