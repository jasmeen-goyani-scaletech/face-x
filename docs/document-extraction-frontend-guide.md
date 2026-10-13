# Document field extraction: frontend integration guide

How the web app (`apps/web`) uses `POST /api/v1/documents/:documentId/extract`. The endpoint has the AI read a fixed set of fields off
an uploaded document (names, date of birth, expiry date…) and the API compares them with the profile on record in code. The frontend only
calls it and shows the result. Backend details, privacy and cost are in `docs/document-verification-api.md`.

## 1. What it is for

- **Admin review (main use).** When an admin opens a submitted document, show what was read next to what is on record, so a likely
  name mismatch, wrong date of birth or expired certificate stands out. The admin still approves or rejects; nothing is decided
  automatically.
- **Registrant check after upload (optional).** Right after an upload completes, warn the family early ("the name on this document
  doesn't look like the player's"). Treat it as a hint only; never block the upload or submission on it.

The result is **not stored** and each call is a paid AI call taking 1.5–3.5 s (up to 20 s). Call it once per document view, keep
the result in component state, and never call it on render, focus, polling or list pages.

## 2. The request

```http
POST /api/v1/documents/{documentId}/extract
Authorization: Bearer <access token>
(no body)
```

- **Who can call:** the document's owner (the parent/player, coach or staff member it belongs to), or an ADMIN of the event's
  organization once the document is **submitted**. Anyone else gets 404.
- **When:** only after the upload is confirmed (`state` is `UPLOADED`, `IN_REVIEW`, `APPROVED` or `REJECTED`). Not for
  `PROFILE_PHOTO`.
- **Rate limit:** 10 calls per user per minute (429 after that).

### API client (`apps/web/src/lib/api/documents.ts`)

```ts
/** Reads the document's fields with the AI and compares them with the profile. Not cached by the API: call once per view. */
export const extractDocument = (documentId: string) =>
  apiRequest<ApiExtractionResult>(`/documents/${documentId}/extract`, { method: 'POST', body: {} });
```

`apiRequest` unwraps `{ success, data }`, so this resolves with `data` below. The API's 20 s deadline sits under `apiRequest`'s
30 s timeout, so a slow read comes back as `status: 'FAILED'` with `failureReason: 'TIMEOUT'`, not as a network error.

### Types (`apps/web/src/lib/api/types.ts`)

```ts
/** MATCH / MISMATCH against the profile; CLOSE (names only): about one letter off, check by eye; NOT_FOUND: not on the document. */
export type ApiFieldMatch = 'MATCH' | 'CLOSE' | 'MISMATCH' | 'NOT_FOUND';

export interface ApiExtractedField {
  /** As read; dates as YYYY-MM-DD. Null when absent or illegible. */
  value: string | null;
  /** Null for a field that is shown but not compared (e.g. issuer, school name). */
  match: ApiFieldMatch | null;
}

export type ApiExtractionFailureReason = 'UNREADABLE' | 'UNSUPPORTED' | 'TIMEOUT' | 'PROVIDER_ERROR';

export interface ApiExtractionResult {
  documentId: string;
  documentType: ApiDocumentType;
  status: 'SUCCEEDED' | 'FAILED';
  /** Only when FAILED. */
  failureReason?: ApiExtractionFailureReason;
  /** Empty when FAILED. Keys depend on the document type (section 3). */
  fields: Record<string, ApiExtractedField>;
  /** Computed by the API, not read: age at the event date, from the extracted date of birth. */
  derived: { age?: number };
  /** The AI model that answered (for support/debugging; no need to show it). */
  model: string | null;
}
```

## 3. Fields per document type

Keys come back in this order. Render them in this order with these labels.

| Document type | Field key | Label | Compared with |
| --- | --- | --- | --- |
| `BIRTH_CERTIFICATE`, `CALIFORNIA_KID_ID`, `SCHOOL_TRANSCRIPT` | `firstName` | First name | Player's first name |
| | `middleName` | Middle name | (shown only) |
| | `lastName` | Last name | Player's last name |
| | `fullName` | Full name | Player's first + last name |
| | `dateOfBirth` | Date of birth | Player's date of birth |
| `SCHOOL_ID` | `fullName` | Full name | Player's first + last name |
| | `studentId` | Student ID | (shown only) |
| | `schoolName` | School | (shown only) |
| | `schoolYear` | School year | (shown only) |
| `FIRST_AID_CPR`, `YALF_TACKLE`, `SAFESPORT`, `BACKGROUND_CHECK` | `fullName` | Name on certificate | Coach/staff first + last name |
| | `issueDate` | Issued | (shown only) |
| | `expiryDate` | Expires | Must be on or after the event's start date |
| | `issuer` | Issued by | (shown only) |
| `PROFILE_PHOTO` | none | | Not extractable (the API answers 422) |

For identity documents also show `derived.age` ("Age at event: 15") when present. It is computed from the extracted date of birth.

How the API compares (so the UI copy is accurate):

- **Names** ignore case, accents and hyphens/spaces: "MATEIALONA HOWE" = "Mateialona-Howe" → `MATCH`. A full name may contain extra
  middle names and be in any order. About one wrong letter in a long name ("MATTIALONA-HOWE") → `CLOSE`. Short names (under 6
  letters) must match exactly.
- **Dates** are exact. `expiryDate` is `MATCH` when it is on or after the event date and `MISMATCH` when it has already expired
  by then.

## 4. How to show each result

| `match` | Meaning | Suggested UI |
| --- | --- | --- |
| `MATCH` | Agrees with the profile | Green check, "Matches" |
| `CLOSE` | Name about one letter off, usually the AI misreading small print | Amber, "Close — check by eye" |
| `MISMATCH` | Differs from the profile (or the certificate expires before the event) | Red, "Doesn't match profile: {value on record}"; for `expiryDate`: "Expired before the event" |
| `NOT_FOUND` | The document didn't show a usable value | Grey, "Not found on document" |
| `null` | Shown for information only | Plain value, no badge |

Important: the AI sometimes misreads names on low-quality scans, especially unusual names in typed print. Name results are
**advisory**: never pre-select `NAME_MISMATCH` as the reject reason or hide the document preview because of them. Show the read value
next to the value on record and let the admin look at the document. Date of birth and expiry results are much more reliable but are
still shown, not acted on automatically.

### Failed reads (`status: 'FAILED'`, still HTTP 200)

| `failureReason` | Suggested copy | Retry button? |
| --- | --- | --- |
| `UNREADABLE` | "Couldn't read this document. Check it by eye." | No (same file, same result) |
| `UNSUPPORTED` | "This file can't be read automatically." | No |
| `TIMEOUT` | "Reading the document took too long." | Yes |
| `PROVIDER_ERROR` | "Automatic reading is unavailable right now." | Yes, after a moment |

A failed read never means the document is bad: it only means the reviewer checks it by eye, as before.

## 5. Errors (`ApiError`)

| Status / code | When | Handle as |
| --- | --- | --- |
| 404 `DOCUMENT_NOT_FOUND` | No such document, not yours, or (admin) not submitted yet | Don't show the panel |
| 409 `UPLOAD_NOT_COMPLETE` | Upload not confirmed yet | Don't call before `completeUpload` resolves |
| 422 `DOCUMENT_NOT_EXTRACTABLE` | `PROFILE_PHOTO` | Don't call for photos |
| 429 | More than 10 calls a minute | "Please wait a minute and try again" |
| 503 `EXTRACTION_NOT_CONFIGURED` | The feature is switched off on this server | Hide the panel for the session (remember it, don't retry) |
| 503 `STORAGE_UNAVAILABLE` | File storage hiccup | Same as `PROVIDER_ERROR` |

Use the existing helpers in `lib/api/errors.ts`: `hasCode(e, 'EXTRACTION_NOT_CONFIGURED')` and `describeError(e)`.

## 6. Example: admin review panel

```tsx
function ExtractionPanel({ document }: { document: ApiDocument }) {
  const [result, setResult] = useState<ApiExtractionResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await extractDocument(document.id));
    } catch (e) {
      if (isApiError(e)) setError(e);
      else throw e;
    } finally {
      setLoading(false);
    }
  }, [document.id]);

  // Once per opened document, not on every render.
  useEffect(() => {
    if (document.documentType !== 'PROFILE_PHOTO') void run();
  }, [document.id, document.documentType, run]);

  if (document.documentType === 'PROFILE_PHOTO') return null;
  if (error && hasCode(error, 'EXTRACTION_NOT_CONFIGURED', 'DOCUMENT_NOT_FOUND')) return null;
  if (loading) return <p>Reading document…</p>; // 1.5–3.5 s typically
  if (error) return <p>{describeError(error)}</p>;
  if (!result) return null;
  if (result.status === 'FAILED') return <FailedRead reason={result.failureReason!} onRetry={run} />;

  return (
    <dl>
      {Object.entries(result.fields).map(([key, field]) => (
        <FieldRow key={key} label={FIELD_LABELS[key] ?? key} field={field} />
      ))}
      {result.derived.age !== undefined && <FieldRow label="Age at event" value={String(result.derived.age)} />}
    </dl>
  );
}
```

`FIELD_LABELS` is the label column from section 3; `FieldRow` renders the badge from section 4. Keep the result in this
component's state (or the page's cache), so switching tabs or re-rendering doesn't call the API again.

## 7. Related upload changes

These shipped with the extraction API and the frontend should follow them:

- **One size limit for every document:** 5 MB by default (`DOCUMENT_MAX_BYTES` on the server, at most 10 MB). The web limits in
  `lib/registration/uploads.ts` and `lib/playerDocuments.ts` are already set to 5 MB. The profile photo stays at 2 MB.
- **DOCX is now accepted by the API** (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`). Legacy `.doc` is
  refused. The web app does not offer DOCX yet. To add it:
  - add `.docx` and the DOCX MIME type to the `accept` attribute in `components/ui/DocumentUploadRow.tsx`;
  - allow it in `validateDocumentFile` (`lib/playerDocuments.ts`) and pass it through unchanged in `prepareFile`
    (`lib/registration/uploads.ts`), like a PDF (no re-encoding);
  - in `components/admin/DocumentPreviewDialog.tsx`, browsers can't preview DOCX: show a download link instead of the preview;
  - the offline/browser-storage mode can't preview it either, so allow DOCX only when uploading to the API.
  DOCX extraction reads the document's text only (no images inside it) and has not yet been tried against the live model.

## 8. Cost

Every call to the extract endpoint is a paid AI call; the API caches nothing. How often the frontend calls it is the biggest factor
in what the feature costs.

**Basis: real billing.** The OpenAI usage dashboard for the live test runs showed 9 gpt-5.6-luna requests, about 17.7k tokens, billed
**$0.002**, which is **about $0.0002 per call** and an effective rate of roughly $0.11 per 1M tokens. The dashboard rounds to $0.001, so
the true figure lies between about $0.00017 and $0.00028 per call. The same dashboard billed 4 gpt-4.1-mini calls at $0.004
($0.001 per call), which matches that model's $0.40-per-1M list price exactly, so the dashboard and the logged token counts agree.

### Per call

Token counts are from live runs on the sample documents (identical across repeated runs). PDF and DOCX were not tested, so those
rows are estimates scaled from their token counts.

| Document | Input tokens | Output tokens | Cost per call |
| --- | --- | --- | --- |
| Birth certificate (scan, ~960×1250) | 1,710 | 60 | ~$0.0002 |
| School ID (phone photo) | 2,221 | 45 | ~$0.00025 |
| Transcript (screenshot) | 1,237 | 51 | ~$0.00015 |
| California ID (scan) | 1,882 | 45 | ~$0.0002 |
| **Image average (billed)** | **~1,760** | **~50** | **~$0.0002** |
| 2-page PDF (estimate: text + page images) | ~5,500 | ~50 | ~$0.0006 |
| DOCX (estimate: text only) | ~1,500–2,500 | ~50 | ~$0.0002 |

A call takes 1.5–3.5 s. Image size barely matters: OpenAI scales large photos down before reading, so a 10 MB photo costs about the same as a
1 MB one. Only longer PDFs cost more, roughly $0.0003 per extra page.

For comparison, gpt-4.1-mini cost **$0.001 per call (about 4–5× luna)** on the same samples and read the names less accurately.

### Per event

Assumptions: 500 players × 4 extractable documents, 50 coaches × 3, 20 staff × 2, so **~2,200 documents**. Blended cost
**~$0.0003 per call** (80% photos/scans, 20% multi-page PDFs).

| How the frontend calls it | Calls per document | Calls per event | Cost per event |
| --- | --- | --- | --- |
| Admin review only, once per opened document (recommended) | ~1.2 (some documents are re-reviewed or replaced) | ~2,600 | **~$0.80** |
| Admin review + registrant check after each upload | ~2.5 | ~5,500 | **~$1.70** |
| Mistake: called on every render, page view or tab switch | 10+ | 22,000+ | $7+ and rising |

**Per year:** 100,000 calls ≈ **$30**.

These figures come from a small sample (9 calls, rounded billing). Check them against the dashboard after the first real event.
The billing line shows as "cache writes": the instructions and field schema are the same on every call, so OpenAI may bill part
of them at cached rates when calls come close together, which only lowers the cost.

### Limits that cap the bill

- **Rate limit:** 10 calls per user per minute. One user calling non-stop could at most cost about $0.35 an hour (all multi-page PDFs).
  This guards against bugs and abuse; it is not a budget.
- **No retries on unreadable documents:** the guide's UI only offers a retry for `TIMEOUT` and `PROVIDER_ERROR`. Re-reading the same
  unreadable file costs the same and gives the same result.
- **What the frontend must do:** call once per document view and keep the result in state (section 6). This is what keeps an event
  under about $2.
- **Tracking real spend:** the API logs the input and output token counts of every call (no document content), so actual cost can be
  added up from the logs. Set a monthly budget alert on the OpenAI account as well.

## 9. Checklist

- [ ] `extractDocument` client function and the types above added.
- [ ] Admin review: panel calls extract once when a submitted, non-photo document is opened.
- [ ] Badges per `match` value; `CLOSE` and name `MISMATCH` shown as "check by eye", never auto-rejecting.
- [ ] `FAILED` results show the reason; retry only for `TIMEOUT` / `PROVIDER_ERROR`.
- [ ] 503 `EXTRACTION_NOT_CONFIGURED` hides the panel for the session.
- [ ] No calls on render loops, list pages or polling; one call per document view.
- [ ] (Optional) registrant hint after upload, non-blocking.
- [ ] (Optional) DOCX upload support (section 7).
- [ ] Budget alert set on the OpenAI account; per-call cost re-checked on the dashboard after the first event (section 8).
