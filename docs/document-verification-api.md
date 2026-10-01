# Document verification API and notifications

The admin screens (`/admin/players`, `/admin/coaches`, `/admin/staff`) record every approve/reject through
`submitDocumentDecision` in `src/lib/documentVerification.ts`. **Today nothing is delivered**: the app has
no backend, so the notification is only written to a local outbox (`facex-notification-outbox`). This
document is the contract for the server that replaces it.

## 1. Decision request

`POST /api/documents/{documentId}/decision` (admin-authenticated)

```jsonc
{
  "documentId": "birthCertificate",          // also in the URL
  "subjectType": "player",                   // "player" | "coach" | "staff"
  "subjectId": "FX-2026-4730",               // whose registration
  "status": "REJECTED",                      // "APPROVED" | "REJECTED"
  "rejectionReasonCode": "UNREADABLE",       // UNREADABLE | WRONG_TYPE | NAME_MISMATCH | EXPIRED | CUSTOM
  "rejectionReason": "The file is too blurry or dark to read.", // required when REJECTED
  "adminId": "usr_123"                       // taken from the session on the server, never trusted from the body
}
```

Responses: `200 { "documentId", "status", "decidedAt" }`, `400` (REJECTED without a reason), `401/403`
(not an admin), `404` (unknown document). The server must store the decision, then send the
notifications below. Use the session's admin id, not the one in the body.

## 2. Notification copy

| Decision | Title | Body |
| --- | --- | --- |
| APPROVED | Document Approved | Your uploaded document for {Role} registration has been verified and approved. |
| REJECTED | Document Verification Action Required | Your document was not approved. Reason: {rejectionReason}. Please upload a valid document to complete your verification. |

Sent on two channels: web push and email. The app builds this text in `buildDecisionNotification`; keep
the server's copy identical.

## 3. Delivery (server side)

Web push needs each user's push subscription (or FCM token), captured **in the browser after the user
grants notification permission** and stored against their registration. Nothing collects this yet.

```ts
// Example: Next.js route handler + Firebase Admin (FCM) + an email provider.
import { getMessaging } from 'firebase-admin/messaging';

export async function POST(req: Request, { params }: { params: { documentId: string } }) {
  const admin = await requireAdmin(req);                       // 401/403 otherwise
  const body = await req.json();
  if (body.status === 'REJECTED' && !body.rejectionReason?.trim()) return Response.json({ error: 'reason_required' }, { status: 400 });

  await db.documents.update(params.documentId, { review: body.status, reason: body.rejectionReason ?? '', reviewedBy: admin.id });

  const { title, body: text } = buildDecisionNotification({ ...body, adminId: admin.id });
  const user = await db.users.forRegistration(body.subjectType, body.subjectId);

  await Promise.allSettled([
    user.fcmToken && getMessaging().send({ token: user.fcmToken, notification: { title, body: text }, data: { url: `/register/${body.subjectType}` } }),
    sendEmail({ to: user.email, subject: title, text })         // your email provider
  ]);
  return Response.json({ documentId: params.documentId, status: body.status, decidedAt: Date.now() });
}
```

Delivery failures must not fail the decision: store it, then retry the notification (a queue works well).

## 4. Wiring it in

Implement `NotificationService` (or replace `submitDocumentDecision`'s body) with a `fetch` to the endpoint
above and call `setNotificationService(...)` once at startup. The screens need no changes.
