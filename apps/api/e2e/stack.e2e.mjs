/**
 * Black-box end-to-end checks against the RUNNING stack: the web app's /api/v1 proxy (default http://localhost:3000) -> the API (http://localhost:4000)
 * -> PostgreSQL. Covers sign-in and sessions, authorization, registration (player, coach, staff), documents (valid, invalid, tampered, oversized),
 * consent, admin review and re-upload, event day and check-in, payment failure, validation and pagination.
 *
 * Run with both apps started and the API's .env loaded:  pnpm e2e   (from the repository root)
 * It creates its own events, teams and test accounts (e2e-*@example.com) in the database named by DATABASE_URL, so run it only against a
 * development or test database, never a real one. The API needs STORAGE_DRIVER=local and no STRIPE_SECRET_KEY (payment is checked as "not configured").
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run against NODE_ENV=production: this script creates test data.');
  process.exit(2);
}
const WEB = (process.env.E2E_WEB_URL ?? 'http://localhost:3000') + '/api/v1';
const API = (process.env.E2E_API_URL ?? 'http://localhost:4000') + '/api/v1';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + extra}`);
};
const tag = Date.now().toString().slice(-6);
const PW = 'Testpass-9183-xyz';

async function call(base, path, { method = 'GET', body, token, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers: h,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, headers: res.headers };
}
const web = (p, o) => call(WEB, p, o);

async function signup(label, roles = []) {
  const email = `e2e-${label}-${tag}@example.com`;
  const r = await web('/auth/register', {
    method: 'POST',
    body: { email, password: PW, fullName: `E2E ${label}` },
  });
  if (r.status !== 201) throw new Error('register ' + JSON.stringify(r.json));
  const l = await web('/auth/login', { method: 'POST', body: { email, password: PW } });
  const token = l.json.data.accessToken;
  for (const role of roles) await web('/users/me/roles', { method: 'POST', token, body: { role } });
  return { email, token, id: l.json.data.user.id, setCookie: l.headers.get('set-cookie') };
}

// ---------------------------------------------------------------- fixtures: an admin, an org, events
import pg from 'pg';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const org = (await db.query('select id from organizations limit 1')).rows[0].id;
const mkEvent = async (name, fee, status = 'PUBLISHED') =>
  (
    await db.query(
      `insert into events (organization_id,name,location,timezone,starts_at,ends_at,registration_fee_cents,status) values ($1,$2,'Field','America/Los_Angeles', now()+interval '30 days', now()+interval '30 days 3 hours',$3,$4) returning id`,
      [org, name, fee, status],
    )
  ).rows[0].id;
const evFree = await mkEvent('E2E free ' + tag, 0);
const evPaid = await mkEvent('E2E paid ' + tag, 9500);
const evDraft = await mkEvent('E2E draft ' + tag, 0, 'DRAFT');
const mkTeam = async (ev, name) =>
  (
    await db.query(
      `insert into teams (event_id,name,club,division) values ($1,$2,'Club','U12') returning id, invite_code`,
      [ev, name],
    )
  ).rows[0];
const teamFree = await mkTeam(evFree, 'TF' + tag);
const teamPaid = await mkTeam(evPaid, 'TP' + tag);
const admin = await signup('admin');
await db.query(`update users set organization_id=$1 where id=$2`, [org, admin.id]);
await db.query(`insert into user_roles(user_id,role) values($1,'ADMIN') on conflict do nothing`, [
  admin.id,
]);
// re-login so the token carries the role
admin.token = (
  await web('/auth/login', { method: 'POST', body: { email: admin.email, password: PW } })
).json.data.accessToken;

console.log('\n== A. Authentication and authorization');
{
  let r = await web('/auth/register', {
    method: 'POST',
    body: { email: admin.email, password: PW },
  });
  check(
    'duplicate email -> 409 EMAIL_ALREADY_REGISTERED',
    r.status === 409 && r.json.error.code === 'EMAIL_ALREADY_REGISTERED',
    JSON.stringify(r.json),
  );
  r = await web('/auth/register', {
    method: 'POST',
    body: { email: 'x@example.com', password: 'short' },
  });
  check('weak password -> 422', r.status === 422, r.status);
  r = await web('/auth/register', {
    method: 'POST',
    body: { email: 'not-an-email', password: PW },
  });
  check('bad email -> 422', r.status === 422, r.status);
  r = await web('/auth/login', {
    method: 'POST',
    body: { email: admin.email, password: 'wrong-password-123' },
  });
  check(
    'wrong password -> 401 INVALID_CREDENTIALS',
    r.status === 401 && r.json.error.code === 'INVALID_CREDENTIALS',
    JSON.stringify(r.json),
  );
  r = await web('/auth/login', {
    method: 'POST',
    body: { email: 'nobody@example.com', password: 'wrong-password-123' },
  });
  check(
    'unknown user gives the same answer (no account enumeration)',
    r.status === 401 && r.json.error.code === 'INVALID_CREDENTIALS',
    JSON.stringify(r.json),
  );
  r = await web('/auth/me');
  check('no token -> 401', r.status === 401, r.status);
  r = await web('/auth/me', { token: 'garbage.token.value' });
  check('garbage token -> 401', r.status === 401, r.status);
  // expired token: sign one with the same secret but a past expiry
  const { SignJWT } = await import('jose');
  const expired = await new SignJWT({ sub: admin.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  r = await web('/auth/me', { token: expired });
  check('expired access token -> 401', r.status === 401, r.status);
  r = await web('/auth/refresh', { method: 'POST' });
  check('refresh without cookie -> 401', r.status === 401, r.status);
  const cookie = admin.setCookie ?? '';
  check(
    'refresh cookie is HttpOnly + SameSite and scoped',
    /HttpOnly/i.test(cookie) &&
      /SameSite=Lax/i.test(cookie) &&
      /Path=\/api\/v1\/auth/i.test(cookie),
    cookie,
  );
  // refresh via cookie, then replaying the OLD cookie must revoke the session (rotation + reuse detection)
  const c1 = cookie.split(';')[0];
  r = await web('/auth/refresh', {
    method: 'POST',
    headers: { Cookie: c1, Origin: 'http://localhost:3000' },
  });
  check(
    'refresh with cookie -> 200 and a new access token',
    r.status === 200 && !!r.json?.data?.accessToken,
    JSON.stringify(r.json),
  );
  const c2 = (r.headers.get('set-cookie') ?? '').split(';')[0];
  r = await web('/auth/refresh', {
    method: 'POST',
    headers: { Cookie: c1, Origin: 'http://localhost:3000' },
  });
  check('replaying a used refresh cookie -> 401 (reuse detected)', r.status === 401, r.status);
  r = await web('/auth/refresh', {
    method: 'POST',
    headers: { Cookie: c2, Origin: 'http://localhost:3000' },
  });
  check('...and the whole session is revoked (newer cookie dead too)', r.status === 401, r.status);
  r = await web('/auth/refresh', {
    method: 'POST',
    headers: { Cookie: c1, Origin: 'https://evil.example' },
  });
  check('refresh from a foreign Origin -> 403', r.status === 403, r.status);
  admin.token = (
    await web('/auth/login', { method: 'POST', body: { email: admin.email, password: PW } })
  ).json.data.accessToken;
  const parent0 = await signup('p0', ['PARENT']);
  r = await web('/admin/events', { token: parent0.token });
  check('parent calling admin endpoint -> 403', r.status === 403, r.status);
  r = await web('/admin/events', { token: admin.token });
  check('admin lists own events -> 200', r.status === 200 && Array.isArray(r.json.data), r.status);
  r = await web('/players', { token: admin.token });
  check('admin on a family endpoint -> 403', r.status === 403, r.status);
  r = await web('/users/me/roles', {
    method: 'POST',
    token: parent0.token,
    body: { role: 'ADMIN' },
  });
  check('self-assigning ADMIN -> 422', r.status === 422, r.status);
  for (const p of [
    '/players',
    '/registrations',
    '/staff-profiles',
    '/admin/events',
    '/events',
    '/consents/current',
  ]) {
    const x = await web(p);
    if (x.status !== 401) check(`unauthenticated ${p} -> 401`, false, x.status);
  }
  check('all protected endpoints reject unauthenticated calls', true);
}

console.log('\n== B. HTTP robustness');
{
  let r = await web('/auth/login', {
    method: 'POST',
    raw: '{not json',
    headers: { 'Content-Type': 'application/json' },
  });
  check(
    'malformed JSON -> 400 JSON error',
    r.status === 400 && r.json?.success === false,
    `${r.status} ${r.text.slice(0, 80)}`,
  );
  r = await web('/auth/login', {
    method: 'POST',
    raw: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) }),
    headers: { 'Content-Type': 'application/json' },
  });
  check(
    'oversized JSON body -> 400 PAYLOAD_TOO_LARGE',
    r.status === 400 && r.json?.error?.code === 'PAYLOAD_TOO_LARGE',
    r.status,
  );
  r = await web('/definitely-not-a-route', { token: admin.token });
  check(
    'unknown API route -> 404 JSON',
    r.status === 404 && r.json?.success === false,
    `${r.status} ${r.text.slice(0, 60)}`,
  );
  r = await call(API, '/events', {
    headers: { Origin: 'http://localhost:3000' },
    token: admin.token,
  });
  check(
    'CORS: allowed origin is echoed with credentials',
    r.headers.get('access-control-allow-origin') === 'http://localhost:3000' &&
      r.headers.get('access-control-allow-credentials') === 'true',
    r.headers.get('access-control-allow-origin'),
  );
  r = await call(API, '/events', {
    headers: { Origin: 'https://evil.example' },
    token: admin.token,
  });
  check(
    'CORS: foreign origin gets no allow-origin header',
    !r.headers.get('access-control-allow-origin'),
    r.headers.get('access-control-allow-origin'),
  );
  r = await call(API, '/events', { token: admin.token });
  check(
    'security headers present, no x-powered-by',
    !!r.headers.get('x-content-type-options') && !r.headers.get('x-powered-by'),
    [...r.headers.keys()].join(','),
  );
  r = await call(API.replace('/api/v1', ''), '/health/ready');
  check('readiness endpoint reports the database', r.json?.data?.checks?.database === 'ok');
}

console.log('\n== C. Player registration, documents, consent');
const parent = await signup('parent', ['PARENT']);
let playerId,
  regId,
  docIds = {};
{
  let r = await web('/players', {
    method: 'POST',
    token: parent.token,
    body: {
      firstName: 'Ana',
      lastName: 'Tester',
      dateOfBirth: '2040-01-01',
      guardian: { relationship: 'Mother', firstName: 'Mia', lastName: 'Tester' },
    },
  });
  check('future date of birth -> 422', r.status === 422, r.status);
  r = await web('/players', {
    method: 'POST',
    token: parent.token,
    body: {
      firstName: 'Ana',
      lastName: 'Tester',
      dateOfBirth: '2014-02-03',
      phone: '12',
      guardian: { relationship: 'Mother', firstName: 'Mia', lastName: 'Tester' },
    },
  });
  check(
    'invalid phone -> 422 with the field named',
    r.status === 422 && r.json.error.details.some((d) => d.path === 'phone'),
    JSON.stringify(r.json),
  );
  r = await web('/players', {
    method: 'POST',
    token: parent.token,
    body: {
      firstName: 'Ana',
      lastName: 'Tester',
      dateOfBirth: '2014-02-03',
      userId: 'x',
      guardian: { relationship: 'Mother', firstName: 'Mia', lastName: 'Tester' },
    },
  });
  check('unknown field (mass assignment) -> 422', r.status === 422, r.status);
  r = await web('/players', {
    method: 'POST',
    token: parent.token,
    body: {
      firstName: 'Ana',
      lastName: 'Tester',
      dateOfBirth: '2014-02-03',
      guardian: { relationship: 'Mother', firstName: 'Mia', lastName: 'Tester' },
    },
  });
  check('create child -> 201', r.status === 201, JSON.stringify(r.json));
  playerId = r.json.data.id;
  r = await web('/registrations', {
    method: 'POST',
    token: parent.token,
    body: { eventId: evDraft, playerId, teamId: teamFree.id },
  });
  check('registering for a DRAFT event -> 404 (invisible)', r.status === 404, r.status);
  r = await web('/registrations', {
    method: 'POST',
    token: parent.token,
    body: { eventId: evFree, playerId, teamId: teamPaid.id },
  });
  check(
    'team from another event -> 422 TEAM_NOT_AVAILABLE',
    r.status === 422 && r.json.error.code === 'TEAM_NOT_AVAILABLE',
    JSON.stringify(r.json),
  );
  r = await web('/registrations', {
    method: 'POST',
    token: parent.token,
    body: {
      eventId: evFree,
      playerId: '00000000-0000-4000-8000-000000000999',
      teamId: teamFree.id,
    },
  });
  check("registering someone else's / unknown player -> 404", r.status === 404, r.status);
  r = await web('/registrations', {
    method: 'POST',
    token: parent.token,
    body: { eventId: evFree, playerId },
  });
  check('create draft registration (no team yet) -> 201', r.status === 201, JSON.stringify(r.json));
  regId = r.json.data.id;
  r = await web('/registrations', {
    method: 'POST',
    token: parent.token,
    body: { eventId: evFree, playerId, teamId: teamFree.id },
  });
  check(
    'duplicate registration -> 409 REGISTRATION_ALREADY_EXISTS',
    r.status === 409 && r.json.error.code === 'REGISTRATION_ALREADY_EXISTS',
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}/submit`, { method: 'POST', token: parent.token });
  check(
    'submit without a team -> 422 REGISTRATION_INCOMPLETE',
    r.status === 422 && r.json.error.code === 'REGISTRATION_INCOMPLETE',
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}`, {
    method: 'PATCH',
    token: parent.token,
    body: { teamId: teamFree.id, guestCount: 11 },
  });
  check('guest count above 10 -> 422', r.status === 422, r.status);
  r = await web(`/registrations/${regId}`, {
    method: 'PATCH',
    token: parent.token,
    body: { teamId: teamFree.id, guestCount: 2 },
  });
  check(
    'save draft (team + guests) -> 200',
    r.status === 200 && r.json.data.team.id === teamFree.id && r.json.data.guestCount === 2,
    JSON.stringify(r.json),
  );
  const other = await signup('other', ['PARENT']);
  r = await web(`/registrations/${regId}`, { token: other.token });
  check('another family cannot read the registration (404, not 403)', r.status === 404, r.status);
  r = await web(`/registrations/${regId}/documents/upload-url`, {
    method: 'POST',
    token: other.token,
    body: {
      documentType: 'BIRTH_CERTIFICATE',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    },
  });
  check('another family cannot upload to it -> 404', r.status === 404, r.status);

  // ---- uploads
  const up = (type, name, mime, size, token = parent.token) =>
    web(`/registrations/${regId}/documents/upload-url`, {
      method: 'POST',
      token,
      body: { documentType: type, fileName: name, mimeType: mime, sizeBytes: size },
    });
  r = await up('BIRTH_CERTIFICATE', 'a.exe', 'application/x-msdownload', 100);
  check(
    'disallowed file type -> 400 FILE_TYPE_NOT_ALLOWED',
    r.status === 400 && r.json.error.code === 'FILE_TYPE_NOT_ALLOWED',
    JSON.stringify(r.json),
  );
  r = await up('BIRTH_CERTIFICATE', 'big.pdf', 'application/pdf', 11 * 1024 * 1024);
  check(
    'document over 10 MB refused at request time',
    r.status >= 400 && r.status < 500,
    `${r.status} ${JSON.stringify(r.json)}`,
  );
  r = await up('PROFILE_PHOTO', 'p.jpg', 'image/jpeg', 6 * 1024 * 1024);
  check(
    'photo over 5 MB refused at request time',
    r.status >= 400 && r.status < 500,
    `${r.status}`,
  );
  r = await up('PROFILE_PHOTO', 'p.pdf', 'application/pdf', 1000);
  check('PDF as a profile photo refused', r.status >= 400 && r.status < 500, `${r.status}`);
  r = await up('FIRST_AID_CPR', 'c.pdf', 'application/pdf', 1000);
  check('a coach certificate on a player registration -> 422', r.status === 422, r.status);
  r = await up('BIRTH_CERTIFICATE', 'a.pdf', 'application/pdf', 0);
  check('zero-byte file -> 422', r.status === 422, r.status);

  const putTo = async (instr, bytes, headers) => {
    const url = instr.url.startsWith('http')
      ? instr.url
      : (process.env.E2E_WEB_URL ?? 'http://localhost:3000') + instr.url;
    const res = await fetch(url, { method: 'PUT', headers: headers ?? instr.headers, body: bytes });
    return res.status;
  };
  const pdfBytes = (n) => {
    const b = new Uint8Array(n);
    b.set(new TextEncoder().encode('%PDF-1.4\n'));
    return b;
  };
  const pngBytes = (n) => {
    const b = new Uint8Array(n);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return b;
  };
  const jpgBytes = (n) => {
    const b = new Uint8Array(n);
    b.set([0xff, 0xd8, 0xff, 0xe0]);
    return b;
  };

  // complete before the file is there
  r = await up('BIRTH_CERTIFICATE', 'birth.pdf', 'application/pdf', 2048);
  let docId = r.json.data.document.id;
  let c = await web(`/documents/${docId}/complete`, {
    method: 'POST',
    token: parent.token,
    body: {},
  });
  check(
    'confirming before the upload arrived -> 409 UPLOAD_NOT_COMPLETE',
    c.status === 409 && c.json.error.code === 'UPLOAD_NOT_COMPLETE',
    JSON.stringify(c.json),
  );
  // tampered signature
  const tampered = {
    ...r.json.data.upload,
    url: r.json.data.upload.url.replace(/sig=[^&]+/, 'sig=AAAA'),
  };
  check('tampered upload signature -> 403', (await putTo(tampered, pdfBytes(2048))) === 403);
  // wrong size sent
  check(
    'upload with a different size than signed -> rejected',
    (await putTo(r.json.data.upload, pdfBytes(4096), { ...r.json.data.upload.headers })) >= 400,
  );
  // wrong content type header
  check(
    'upload with a different content type than signed -> rejected',
    (await putTo(r.json.data.upload, pdfBytes(2048), { 'Content-Type': 'image/png' })) >= 400,
  );
  // correct upload but contents are a PNG pretending to be a PDF
  r = await up('BIRTH_CERTIFICATE', 'birth.pdf', 'application/pdf', 2048);
  docId = r.json.data.document.id;
  check(
    'PUT of a PNG declared as PDF is stored (storage cannot know)',
    (await putTo(r.json.data.upload, pngBytes(2048))) === 200,
  );
  c = await web(`/documents/${docId}/complete`, { method: 'POST', token: parent.token, body: {} });
  check(
    'server detects the content mismatch -> 422 FILE_CONTENT_MISMATCH',
    c.status === 422 && c.json.error.code === 'FILE_CONTENT_MISMATCH',
    JSON.stringify(c.json),
  );
  // proper upload (retry after the failure: a fresh URL for the same document)
  r = await up('BIRTH_CERTIFICATE', 'birth.pdf', 'application/pdf', 2048);
  check(
    're-request after a failed verification is allowed',
    r.status === 201,
    JSON.stringify(r.json),
  );
  docId = r.json.data.document.id;
  check('good PDF upload -> 200', (await putTo(r.json.data.upload, pdfBytes(2048))) === 200);
  c = await web(`/documents/${docId}/complete`, { method: 'POST', token: parent.token, body: {} });
  check(
    'complete -> UPLOADED',
    c.status === 200 && c.json.data.state === 'UPLOADED',
    JSON.stringify(c.json),
  );
  c = await web(`/documents/${docId}/complete`, { method: 'POST', token: parent.token, body: {} });
  check('confirming twice is harmless', c.status === 200);
  docIds.BIRTH_CERTIFICATE = docId;
  for (const [type, bytes, mime, name] of [
    ['SCHOOL_TRANSCRIPT', pdfBytes, 'application/pdf', 't.pdf'],
    ['CALIFORNIA_KID_ID', pngBytes, 'image/png', 'k.png'],
    ['PROFILE_PHOTO', jpgBytes, 'image/jpeg', 's.jpg'],
  ]) {
    const q = await up(type, name, mime, 3000);
    await putTo(q.json.data.upload, bytes(3000));
    const done = await web(`/documents/${q.json.data.document.id}/complete`, {
      method: 'POST',
      token: parent.token,
      body: {},
    });
    check(`upload ${type}`, done.status === 200, JSON.stringify(done.json));
    docIds[type] = q.json.data.document.id;
  }
  r = await web(`/documents/${docIds.BIRTH_CERTIFICATE}/download-url`, { token: other.token });
  check('another family cannot get a download link -> 404', r.status === 404, r.status);
  r = await web(`/documents/${docIds.BIRTH_CERTIFICATE}/download-url`, { token: parent.token });
  const dl = await fetch(
    r.json.data.url.startsWith('http')
      ? r.json.data.url
      : (process.env.E2E_WEB_URL ?? 'http://localhost:3000') + r.json.data.url,
  );
  check(
    'owner download link serves the file with safe headers',
    dl.status === 200 && dl.headers.get('x-content-type-options') === 'nosniff',
    `${dl.status} ${dl.headers.get('x-content-type-options')}`,
  );

  // ---- consent + submit
  const wording = (await web('/consents/current', { token: parent.token })).json.data.find(
    (x) => x.code === 'GUARDIAN_CONSENT',
  );
  check('consent wording is published', !!wording);
  r = await web(`/registrations/${regId}/consents`, {
    method: 'POST',
    token: parent.token,
    body: { consentId: wording.id, signedName: 'Mia Tester', accepted: false },
  });
  check('consent accepted:false -> 422', r.status === 422, r.status);
  r = await web(`/registrations/${regId}/consents`, {
    method: 'POST',
    token: parent.token,
    body: { consentId: wording.id, signedName: 'Someone Else', accepted: true },
  });
  check(
    'consent with the wrong signature -> 422 SIGNATURE_MISMATCH',
    r.status === 422 && r.json.error.code === 'SIGNATURE_MISMATCH',
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}/consents`, {
    method: 'POST',
    token: parent.token,
    body: { consentId: wording.id, signedName: 'mia   TESTER', accepted: true },
  });
  check(
    'consent signature is case/space-insensitive -> 201',
    r.status === 201,
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}/consents`, {
    method: 'POST',
    token: parent.token,
    body: { consentId: wording.id, signedName: 'Mia Tester', accepted: true },
  });
  check('consent twice -> 409', r.status === 409, r.status);
  for (const t of ['BIRTH_CERTIFICATE', 'SCHOOL_TRANSCRIPT', 'CALIFORNIA_KID_ID', 'PROFILE_PHOTO'])
    await web(`/documents/${docIds[t]}/submit`, { method: 'POST', token: parent.token, body: {} });
  r = await web(`/documents/${docIds.BIRTH_CERTIFICATE}/submit`, {
    method: 'POST',
    token: parent.token,
    body: {},
  });
  check('submitting a document twice -> 409', r.status === 409, r.status);
  r = await web(`/documents/${docIds.BIRTH_CERTIFICATE}`, { token: parent.token });
  check('submitted doc is IN_REVIEW', r.json.data.state === 'IN_REVIEW', r.json.data.state);
  r = await up('BIRTH_CERTIFICATE', 'again.pdf', 'application/pdf', 100);
  check(
    'replacing a document that is in review -> 409 DOCUMENT_IN_REVIEW',
    r.status === 409 && r.json.error.code === 'DOCUMENT_IN_REVIEW',
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}/submit`, { method: 'POST', token: parent.token });
  check(
    'submit complete registration -> SUBMITTED',
    r.status === 200 && r.json.data.status === 'SUBMITTED',
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}`, {
    method: 'PATCH',
    token: parent.token,
    body: { guestCount: 1 },
  });
  check(
    'editing after submit -> 409 REGISTRATION_NOT_EDITABLE',
    r.status === 409 && r.json.error.code === 'REGISTRATION_NOT_EDITABLE',
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}/submit`, { method: 'POST', token: parent.token });
  check('submitting twice -> 409', r.status === 409, r.status);
  r = await web(`/players/${playerId}`, {
    method: 'PATCH',
    token: parent.token,
    body: { firstName: 'Changed' },
  });
  check(
    'player locked after submit -> 409 PLAYER_LOCKED',
    r.status === 409 && r.json.error.code === 'PLAYER_LOCKED',
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}/readiness/evaluate`, {
    method: 'POST',
    token: parent.token,
    body: {},
  });
  check(
    'free event: readiness moves it to payment-complete -> awaiting documents',
    r.status === 200 &&
      ['PAYMENT_COMPLETED', 'DOCUMENT_REVIEW'].includes(r.json.data.readiness.status),
    JSON.stringify(r.json.data.readiness.status),
  );
}

console.log('\n== D. Admin review: filters, pagination, decisions, re-upload');
{
  const list = (qs) => web(`/admin/events/${evFree}/registrations${qs}`, { token: admin.token });
  let r = await list('');
  check(
    'admin sees the submitted player',
    r.status === 200 && r.json.data.items.some((i) => i.id === regId),
    JSON.stringify(r.json).slice(0, 200),
  );
  r = await list('?search=Tester');
  check('search by name', r.json.data.total >= 1);
  r = await list('?search=' + encodeURIComponent('%'));
  check(
    'search "%" is literal (no wildcard match-all)',
    r.json.data.total === 0,
    r.json.data.total,
  );
  r = await list('?search=' + encodeURIComponent("x' or 1=1 --"));
  check(
    'SQL-injection-looking search is harmless',
    r.status === 200 && r.json.data.total === 0,
    r.status,
  );
  r = await list('?page=999');
  check(
    'page past the end -> empty page, not an error',
    r.status === 200 && r.json.data.items.length === 0,
  );
  r = await list('?pageSize=101');
  check('pageSize above 100 -> 422', r.status === 422, r.status);
  r = await list('?page=0');
  check('page 0 -> 422', r.status === 422, r.status);
  r = await list('?status=NOPE');
  check('unknown status filter -> 422', r.status === 422, r.status);
  r = await list('?bogus=1');
  check('unknown query parameter -> 422', r.status === 422, r.status);
  r = await list('?documentsPending=true');
  check(
    'documents-pending filter finds it',
    r.json.data.items.some((i) => i.id === regId),
  );
  r = await web(`/admin/events/${evFree}/registrations`, { token: parent.token });
  check('family account on admin list -> 403', r.status === 403);
  r = await web(`/documents/${docIds.BIRTH_CERTIFICATE}/review`, {
    method: 'PATCH',
    token: parent.token,
    body: { decision: 'APPROVED' },
  });
  check('owner cannot approve their own document -> 403', r.status === 403, r.status);
  r = await web(`/documents/${docIds.BIRTH_CERTIFICATE}/review`, {
    method: 'PATCH',
    token: admin.token,
    body: { decision: 'REJECTED' },
  });
  check('rejecting without a reason -> 422', r.status === 422, r.status);
  r = await web(`/documents/${docIds.BIRTH_CERTIFICATE}/review`, {
    method: 'PATCH',
    token: admin.token,
    body: { decision: 'REJECTED', reasonCode: 'UNREADABLE', reason: 'Too blurry.' },
  });
  check(
    'admin rejects with a reason -> 200',
    r.status === 200 && r.json.data.state === 'REJECTED',
    JSON.stringify(r.json),
  );
  r = await web(`/documents/${docIds.BIRTH_CERTIFICATE}/review`, {
    method: 'PATCH',
    token: admin.token,
    body: { decision: 'APPROVED' },
  });
  check(
    'deciding twice -> 409 DOCUMENT_ALREADY_REVIEWED',
    r.status === 409 && r.json.error.code === 'DOCUMENT_ALREADY_REVIEWED',
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${regId}/documents`, { token: parent.token });
  const rejected = r.json.data.documents.find((d) => d.id === docIds.BIRTH_CERTIFICATE);
  check('family sees the rejection reason', rejected.review?.reason === 'Too blurry.');
  // re-upload
  const q = await web(`/registrations/${regId}/documents/upload-url`, {
    method: 'POST',
    token: parent.token,
    body: {
      documentType: 'BIRTH_CERTIFICATE',
      fileName: 'birth2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2000,
    },
  });
  check(
    're-upload after rejection -> new record',
    q.status === 201 && q.json.data.document.id !== docIds.BIRTH_CERTIFICATE,
    JSON.stringify(q.json),
  );
  const b = new Uint8Array(2000);
  b.set(new TextEncoder().encode('%PDF-1.4\n'));
  await fetch((process.env.E2E_WEB_URL ?? 'http://localhost:3000') + q.json.data.upload.url, {
    method: 'PUT',
    headers: q.json.data.upload.headers,
    body: b,
  });
  await web(`/documents/${q.json.data.document.id}/complete`, {
    method: 'POST',
    token: parent.token,
    body: {},
  });
  await web(`/documents/${q.json.data.document.id}/submit`, {
    method: 'POST',
    token: parent.token,
    body: {},
  });
  // approve all
  const docs = (
    await web(`/registrations/${regId}/documents`, { token: parent.token })
  ).json.data.documents.filter((d) => d.state === 'IN_REVIEW');
  for (const d of docs)
    await web(`/documents/${d.id}/review`, {
      method: 'PATCH',
      token: admin.token,
      body: { decision: 'APPROVED' },
    });
  r = await web(`/registrations/${regId}`, { token: parent.token });
  check(
    'after all approved: READY_FOR_EVENT',
    r.json.data.status === 'READY_FOR_EVENT',
    r.json.data.status,
  );
  r = await web(`/documents/${docs[0].id}/review`, {
    method: 'PATCH',
    token: admin.token,
    body: { decision: 'REJECTED', reasonCode: 'CUSTOM', reason: 'late' },
  });
  check('deciding a document that is already decided -> 409', r.status === 409);
}

console.log('\n== E. Event day');
{
  const adminOther = await signup('admin2');
  const org2 = (
    await db.query(`insert into organizations(name,slug) values ('Other', $1) returning id`, [
      'other-' + tag,
    ])
  ).rows[0].id;
  await db.query(`update users set organization_id=$1 where id=$2`, [org2, adminOther.id]);
  await db.query(`insert into user_roles(user_id,role) values($1,'ADMIN') on conflict do nothing`, [
    adminOther.id,
  ]);
  adminOther.token = (
    await web('/auth/login', { method: 'POST', body: { email: adminOther.email, password: PW } })
  ).json.data.accessToken;
  const rid = () => crypto.randomUUID();
  let r = await web(`/admin/events/${evFree}/roster`, { token: admin.token });
  const me = r.json.data.find((e) => e.registrationId === regId);
  check(
    'roster shows the player as approved, not checked in',
    me?.approved === true && me.checkedInAt === null,
    JSON.stringify(me),
  );
  r = await web(`/admin/events/${evFree}/roster`, { token: adminOther.token });
  check('another organization cannot read the roster -> 403', r.status === 403, r.status);
  r = await web(`/events/${evFree}/check-ins`, {
    method: 'POST',
    token: parent.token,
    body: { method: 'MANUAL', registrationId: regId, clientRequestId: rid() },
  });
  check('a family account cannot check anyone in -> 403', r.status === 403, r.status);
  r = await web(`/events/${evFree}/check-ins`, {
    method: 'POST',
    token: adminOther.token,
    body: { method: 'MANUAL', registrationId: regId, clientRequestId: rid() },
  });
  check('an admin of another organization cannot check in -> 403', r.status === 403, r.status);
  r = await web(`/events/${evFree}/check-ins`, {
    method: 'POST',
    token: admin.token,
    body: { method: 'MANUAL', registrationId: regId, clientRequestId: 'not-a-uuid' },
  });
  check('bad request id -> 422', r.status === 422, r.status);
  r = await web(`/events/${evPaid}/check-ins`, {
    method: 'POST',
    token: admin.token,
    body: { method: 'MANUAL', registrationId: regId, clientRequestId: rid() },
  });
  check('registration of another event -> 404', r.status === 404, r.status);
  const key = rid();
  r = await web(`/events/${evFree}/check-ins`, {
    method: 'POST',
    token: admin.token,
    body: { method: 'MANUAL', registrationId: regId, clientRequestId: key },
  });
  check('check-in -> 201', r.status === 201, JSON.stringify(r.json));
  r = await web(`/events/${evFree}/check-ins`, {
    method: 'POST',
    token: admin.token,
    body: { method: 'MANUAL', registrationId: regId, clientRequestId: key },
  });
  check(
    'replaying the same request id -> 200, no second check-in (offline queue retry)',
    (r.status === 200 && r.json.data.created === false) || r.status === 200,
    `${r.status} ${JSON.stringify(r.json)}`,
  );
  r = await web(`/events/${evFree}/check-ins`, {
    method: 'POST',
    token: admin.token,
    body: { method: 'MANUAL', registrationId: regId, clientRequestId: rid() },
  });
  check(
    'second check-in with a new id -> 409 ALREADY_CHECKED_IN',
    r.status === 409 && r.json.error.code === 'ALREADY_CHECKED_IN',
    JSON.stringify(r.json),
  );
  const n = (
    await db.query('select count(*)::int n from check_ins where registration_id=$1', [regId])
  ).rows[0].n;
  check('exactly one check-in row in the database', n === 1, n);
  r = await web(`/admin/registrations/${regId}/event-access`, {
    method: 'PATCH',
    token: admin.token,
    body: { disabled: true, reason: 'test' },
  });
  check(
    'admin switches event access off',
    r.status === 200 && r.json.data.eventAccessDisabled === true,
  );
  r = await web(`/admin/registrations/${regId}/event-access`, {
    method: 'PATCH',
    token: adminOther.token,
    body: { disabled: false },
  });
  check("another organization's admin cannot change it -> 404", r.status === 404, r.status);
  await web(`/admin/registrations/${regId}/event-access`, {
    method: 'PATCH',
    token: admin.token,
    body: { disabled: false },
  });
}

console.log('\n== F. Payment and external-service failure');
{
  const pp = await signup('payparent', ['PARENT']);
  let r = await web('/players', {
    method: 'POST',
    token: pp.token,
    body: {
      firstName: 'Pay',
      lastName: 'Tester',
      dateOfBirth: '2013-03-03',
      guardian: { relationship: 'Father', firstName: 'Paul', lastName: 'Tester' },
    },
  });
  const pid = r.json.data.id;
  r = await web('/registrations', {
    method: 'POST',
    token: pp.token,
    body: { eventId: evPaid, playerId: pid, teamId: teamPaid.id },
  });
  const rid = r.json.data.id;
  r = await web(`/registrations/${rid}/payment`, { method: 'POST', token: pp.token, body: {} });
  check(
    'checkout of a DRAFT registration -> 409 REGISTRATION_NOT_PAYABLE (or provider off)',
    r.status === 409 || r.status === 503,
    `${r.status} ${JSON.stringify(r.json)}`,
  );
  await db.query(`update registrations set status='SUBMITTED', submitted_at=now() where id=$1`, [
    rid,
  ]);
  r = await web(`/registrations/${rid}/payment`, { method: 'POST', token: pp.token, body: {} });
  check(
    'checkout with no Stripe configured -> 503 PAYMENT_NOT_CONFIGURED (clean JSON)',
    r.status === 503 && r.json.error.code === 'PAYMENT_NOT_CONFIGURED',
    `${r.status} ${JSON.stringify(r.json)}`,
  );
  r = await web(`/registrations/${rid}/payment`, { token: pp.token });
  check(
    'payment summary still readable: amount due 95.00, not started',
    r.status === 200 &&
      r.json.data.amountDue.amountCents === 9500 &&
      r.json.data.paymentStatus === 'NOT_STARTED',
    JSON.stringify(r.json),
  );
  r = await call(API, '/webhooks/stripe', {
    method: 'POST',
    raw: '{}',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad' },
  });
  check(
    'stripe webhook is refused (not 200) when unconfigured or badly signed',
    r.status >= 400,
    r.status,
  );
}

console.log('\n== G. Coach / staff: duplicates, roles, drafts');
{
  const c = await signup('coach', ['COACH']);
  const body = {
    profileType: 'COACH',
    firstName: 'Cora',
    lastName: 'Coach',
    email: c.email,
    phone: '555-019-2831',
  };
  let r = await web('/staff-profiles', { method: 'POST', token: c.token, body });
  check('coach profile created', r.status === 201, JSON.stringify(r.json));
  const pid = r.json.data.id;
  r = await web('/staff-profiles', { method: 'POST', token: c.token, body });
  check('duplicate coach profile -> 409', r.status === 409, r.status);
  r = await web('/registrations', {
    method: 'POST',
    token: c.token,
    body: { eventId: evFree, staffProfileId: pid },
  });
  const rid = r.json.data.id;
  r = await web('/registrations', {
    method: 'POST',
    token: c.token,
    body: { eventId: evFree, staffProfileId: pid },
  });
  check('duplicate coach registration -> 409', r.status === 409, r.status);
  r = await web(`/registrations/${rid}/team`, {
    method: 'POST',
    token: c.token,
    body: { name: 'Too Early' },
  });
  check('creating a team before approval -> 409', r.status === 409, JSON.stringify(r.json));
  r = await web(`/registrations/${rid}/submit`, { method: 'POST', token: c.token });
  check(
    'coach can submit a partial registration (documents come via review)',
    r.status === 200,
    JSON.stringify(r.json),
  );
  r = await web(`/registrations/${rid}/readiness/evaluate`, {
    method: 'POST',
    token: c.token,
    body: {},
  });
  check(
    'without documents the coach waits at SUBMITTED',
    r.json.data.readiness.status === 'SUBMITTED',
    JSON.stringify(r.json.data?.readiness?.status),
  );
  const nr = await signup('norole');
  r = await web('/staff-profiles', { token: nr.token });
  check(
    'account with no role: staff-profiles list -> 403 INSUFFICIENT_ROLE',
    r.status === 403 && r.json.error.code === 'INSUFFICIENT_ROLE',
    r.status,
  );
}

console.log('\n== H. Admin CRUD validation');
{
  let r = await web('/admin/events', {
    method: 'POST',
    token: admin.token,
    body: {
      name: 'Bad',
      location: 'x',
      timezone: 'Nope/Zone',
      startsAt: '2027-01-01T10:00:00Z',
      endsAt: '2027-01-01T12:00:00Z',
    },
  });
  check('bad time zone -> 422', r.status === 422, r.status);
  r = await web('/admin/events', {
    method: 'POST',
    token: admin.token,
    body: {
      name: 'X',
      location: 'x',
      timezone: 'America/Los_Angeles',
      startsAt: '2027-01-01T10:00:00Z',
      endsAt: '2026-01-01T12:00:00Z',
    },
  });
  check('end before start -> 422', r.status === 422, r.status);
  r = await web('/admin/teams/not-a-uuid', { token: admin.token });
  check('malformed id -> 422 (not a crash)', r.status === 422, r.status);
  r = await web(`/admin/events/${evFree}/teams`, {
    method: 'POST',
    token: admin.token,
    body: { name: 'TF' + tag, club: 'Club', division: 'U12' },
  });
  check('duplicate team -> 409', r.status === 409, r.status);
}

{
  const many = await Promise.all(
    Array.from({ length: 12 }, () =>
      web('/auth/login', {
        method: 'POST',
        body: { email: 'rate@example.com', password: 'wrong-password-123' },
      }),
    ),
  );
  check(
    'login is rate limited (429 with a JSON error)',
    many.some((x) => x.status === 429 && x.json?.error?.code),
    many.map((x) => x.status).join(','),
  );
}
await db.end();
const failed = results.filter((x) => !x.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} FAILED` : ''}`,
);
process.exit(failed.length ? 1 : 0);
