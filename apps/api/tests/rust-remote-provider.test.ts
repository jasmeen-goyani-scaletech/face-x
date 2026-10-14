import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env';
import { FaceProviderError, type FaceImage } from '../src/infrastructure/face/face-provider';
import { createFaceProvider } from '../src/infrastructure/face/provider-registry';
import {
  RUST_ACCEPT_FLOOR,
  cosineToSimilarity,
  createRustRemoteProvider,
} from '../src/infrastructure/face/providers/rust-remote.provider';

const BASE = 'https://faces.example.test/v1';
const jpeg: FaceImage = {
  bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  mimeType: 'image/jpeg',
};

interface Seen {
  url: string;
  method: string;
  authorization: string | null;
  body: Record<string, unknown> | null;
}

/** A fake service: records each request and answers with the next canned response. */
function fakeService(...responses: Array<{ status?: number; json?: unknown } | Error>) {
  const seen: Seen[] = [];
  const queue = [...responses];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    seen.push({
      url,
      method: init.method ?? 'GET',
      authorization: (init.headers as Record<string, string> | undefined)?.authorization ?? null,
      body:
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    });
    const next = queue.shift() ?? { status: 200, json: {} };
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status ?? 200 });
  };
  return {
    seen,
    provider: createRustRemoteProvider({ baseUrl: `${BASE}/`, adminToken: 'admin-token', fetch }),
  };
}

/** The FaceProviderError a call rejects with. */
const rejection = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected the call to reject');
    },
    (e: unknown) => e as FaceProviderError,
  );

const code = async (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e instanceof FaceProviderError ? e.code : `other:${String(e)}`),
  );

const enrollReq = { subjectId: 'player-9', image: jpeg, idempotencyKey: 'k' };

describe('rust-remote: similarity scale', () => {
  it('puts the service floor at the bottom of the review band and a perfect score at 1', () => {
    expect(cosineToSimilarity(RUST_ACCEPT_FLOOR)).toBeCloseTo(0.75);
    expect(cosineToSimilarity(1)).toBeCloseTo(1);
    expect(cosineToSimilarity(0.78)).toBeGreaterThanOrEqual(0.899);
    expect(cosineToSimilarity(0.5)).toBeLessThan(0.9);
  });

  it('is monotonic and clamped into the 0.75..1 band', () => {
    expect(cosineToSimilarity(0.9)).toBeGreaterThan(cosineToSimilarity(0.6));
    expect(cosineToSimilarity(-3)).toBeCloseTo(0.75);
    expect(cosineToSimilarity(7)).toBeCloseTo(1);
  });
});

describe('rust-remote: enroll', () => {
  it('signs a member up with our id as the name and returns the member id as the reference', async () => {
    const { seen, provider } = fakeService({ json: { isError: false, data: { id: 'm-1' } } });
    expect(await provider.enroll(enrollReq)).toEqual({ reference: 'm-1' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${BASE}/auth/signup`);
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.body).toMatchObject({
      name: 'player-9',
      isNormalMember: true,
      isVipMember: false,
      allowDuplicate: false,
      avatar: Buffer.from(jpeg.bytes).toString('base64'),
    });
    // The open enroll route never carries the admin token.
    expect(seen[0]!.authorization).toBeNull();
  });

  it('tags the template with the role when one is given', async () => {
    for (const role of ['PLAYER', 'STAFF', 'COACH'] as const) {
      const { seen, provider } = fakeService({ json: { data: { id: 'm-1' } } });
      await provider.enroll({ ...enrollReq, role });
      expect(seen[0]!.body).toMatchObject({ role });
    }
    const { seen, provider } = fakeService({ json: { data: { id: 'm-1' } } });
    await provider.enroll(enrollReq);
    expect(seen[0]!.body).not.toHaveProperty('role');
  });

  it('converts a non-JPEG photo to JPEG before sending it', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } })
      .png()
      .toBuffer();
    const { seen, provider } = fakeService({ json: { data: { id: 'm-2' } } });
    await provider.enroll({ ...enrollReq, image: { bytes: png, mimeType: 'image/png' } });
    const sent = Buffer.from(String(seen[0]!.body!.avatar), 'base64');
    expect(sent.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('maps the service refusals onto provider error codes', async () => {
    const run = (reasons?: string[]) =>
      code(
        fakeService({
          json: { data: {}, ...(reasons ? { enrollment: { rejected: true, reasons } } : {}) },
        }).provider.enroll(enrollReq),
      );
    expect(await run()).toBe('NO_FACE_DETECTED');
    expect(await run(['multiple_faces', 'too_blurry'])).toBe('MULTIPLE_FACES');
    expect(await run(['too_blurry'])).toBe('LOW_QUALITY');
    expect(await run(['face_too_small', 'extreme_pose'])).toBe('LOW_QUALITY');
    expect(await run(['already_enrolled'])).toBe('IMAGE_REJECTED');
  });

  it('drops eventId and rescans when an older service refuses the unknown field', async () => {
    const refuse = {
      status: 422,
      json: { message: 'Failed to deserialize: eventId: unknown field `eventId`, expected one of `avatar`' },
    };
    const ok = { json: { matched: false, decision: 'denied_no_match' } };
    const svc = fakeService(refuse, ok, ok);
    const req = { image: jpeg, maxCandidates: 1, eventId: '7bc10e4b-99be-4437-8cad-02e7364350c2' };
    expect((await svc.provider.identify(req)).candidates).toEqual([]);
    expect(svc.seen[0]!.body).toHaveProperty('eventId');
    expect(svc.seen[1]!.body).not.toHaveProperty('eventId');
    await svc.provider.identify(req); // remembered: not sent again
    expect(svc.seen).toHaveLength(3);
    expect(svc.seen[2]!.body).not.toHaveProperty('eventId');
  });

  it('drops role and re-enrolls when an older service refuses the unknown field', async () => {
    const refuse = { status: 422, json: { message: 'role: unknown field `role`, expected one of `avatar`' } };
    const svc = fakeService(refuse, { json: { data: { id: 'member-1' } } });
    const out = await svc.provider.enroll({ ...enrollReq, role: 'PLAYER' });
    expect(out.reference).toBe('member-1');
    expect(svc.seen[0]!.body).toHaveProperty('role');
    expect(svc.seen[1]!.body).not.toHaveProperty('role');
  });

  it('retries a scan once after a connection error or a 503, but not an enroll', async () => {
    const ok = { json: { matched: false, decision: 'denied_no_match' } };
    const scanReq = { image: jpeg, maxCandidates: 1 };
    const flaky = fakeService(new TypeError('fetch failed'), ok);
    expect((await flaky.provider.identify(scanReq)).candidates).toEqual([]);
    expect(flaky.seen).toHaveLength(2);
    const busy = fakeService({ status: 503 }, ok);
    await busy.provider.identify(scanReq);
    expect(busy.seen).toHaveLength(2);
    const down = fakeService(new TypeError('fetch failed'), new TypeError('fetch failed'));
    expect(await code(down.provider.identify(scanReq))).toBe('UNAVAILABLE');
    const enroll = fakeService(new TypeError('fetch failed'), ok);
    expect(await code(enroll.provider.enroll(enrollReq))).toBe('UNAVAILABLE');
    expect(enroll.seen).toHaveLength(1);
  });

  it('reports outages as UNAVAILABLE and never puts the response body or host in the error', async () => {
    for (const status of [500, 503]) {
      const { provider } = fakeService({ status, json: { message: 'secret-detail' } });
      const err = await rejection(provider.enroll(enrollReq));
      expect(err).toBeInstanceOf(FaceProviderError);
      expect(err.code).toBe('UNAVAILABLE');
      expect(err.message).not.toContain('secret-detail');
    }
    // A 400 is the service refusing the photo (e.g. it cannot decode it), not an outage.
    const bad = fakeService({ status: 400, json: { message: 'secret-detail' } });
    const rejected = await rejection(bad.provider.enroll(enrollReq));
    expect(rejected.code).toBe('IMAGE_REJECTED');
    expect(rejected.message).not.toContain('secret-detail');
    const down = fakeService(new TypeError('connect ECONNREFUSED 10.0.0.1'));
    const err = await rejection(down.provider.enroll(enrollReq));
    expect(err.code).toBe('UNAVAILABLE');
    expect(err.message).not.toContain('10.0.0.1');
  });

  it('treats a 200 { isError: true } as an outage and a 413 as a rejected image', async () => {
    const a = fakeService({ json: { isError: true, message: 'x', data: null } });
    expect(await code(a.provider.enroll(enrollReq))).toBe('UNAVAILABLE');
    const b = fakeService({ status: 413 });
    expect(await code(b.provider.enroll(enrollReq))).toBe('IMAGE_REJECTED');
  });

  it('reports an aborted call as TIMEOUT', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createRustRemoteProvider({
      baseUrl: BASE,
      fetch: async () => {
        throw new DOMException('aborted', 'AbortError');
      },
    });
    expect(await code(provider.enroll({ ...enrollReq, signal: controller.signal }))).toBe(
      'TIMEOUT',
    );
  });
});

describe('rust-remote: identify and verify', () => {
  const granted = (cosine: number, id = 'm-1') => ({
    json: {
      faceDetected: true,
      matched: true,
      decision: 'granted',
      member: { id },
      similarity: cosine,
    },
  });

  it('returns the service match as one candidate on the application scale', async () => {
    const { seen, provider } = fakeService(granted(0.9));
    const { candidates } = await provider.identify({ image: jpeg, maxCandidates: 5 });
    expect(seen[0]!.url).toBe(`${BASE}/kiosk/scan`);
    expect(seen[0]!.body).toMatchObject({ kioskId: 'facex-api' });
    expect(candidates).toEqual([{ reference: 'm-1', similarity: cosineToSimilarity(0.9) }]);
    expect(candidates[0]!.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it('names the event so the service files the frame, and returns where it was filed', async () => {
    const stored = 'https://objects.example.test/bucket/scans/ev-1/20261012T101500Z_abc.jpg';
    const hit = fakeService({
      json: { ...granted(0.9).json, scan_image_url: stored },
    });
    const found = await hit.provider.identify({ image: jpeg, maxCandidates: 5, eventId: 'ev-1' });
    expect(hit.seen[0]!.body).toMatchObject({ eventId: 'ev-1' });
    expect(found.scanImageUrl).toBe(stored);

    // Nobody recognised still has a frame; no frame kept is null, and no event means none is sent.
    const miss = fakeService({
      json: {
        faceDetected: true,
        matched: false,
        decision: 'denied_no_match',
        member: null,
        scan_image_url: stored,
      },
    });
    const none = await miss.provider.identify({ image: jpeg, maxCandidates: 5 });
    expect(none).toEqual({ candidates: [], scanImageUrl: stored });
    expect(miss.seen[0]!.body).not.toHaveProperty('eventId');
    const bare = fakeService(granted(0.9));
    expect(
      (await bare.provider.identify({ image: jpeg, maxCandidates: 5 })).scanImageUrl,
    ).toBeNull();
  });

  it('answers no candidates when the service found a face but nobody it knows', async () => {
    for (const decision of ['denied_no_match', 'denied_no_access']) {
      const { provider } = fakeService({
        json: { faceDetected: true, matched: false, decision, member: null },
      });
      expect((await provider.identify({ image: jpeg, maxCandidates: 5 })).candidates).toEqual([]);
    }
  });

  it('turns "no face" and "poor quality" into image problems, not into NO_MATCH', async () => {
    const none = fakeService({
      json: { faceDetected: false, matched: false, decision: 'denied_no_face' },
    });
    expect(await code(none.provider.identify({ image: jpeg, maxCandidates: 5 }))).toBe(
      'NO_FACE_DETECTED',
    );
    const poor = fakeService({
      json: { faceDetected: true, matched: false, decision: 'denied_quality' },
    });
    expect(await code(poor.provider.identify({ image: jpeg, maxCandidates: 5 }))).toBe(
      'LOW_QUALITY',
    );
  });

  it('verify is positive only when the best match is the asked-for identity', async () => {
    const same = fakeService(granted(0.9, 'm-1'));
    expect(
      (await same.provider.verify({ reference: 'm-1', image: jpeg })).similarity,
    ).toBeGreaterThan(0.9);
    const other = fakeService(granted(0.9, 'm-2'));
    expect((await other.provider.verify({ reference: 'm-1', image: jpeg })).similarity).toBe(0);
  });
});

describe('rust-remote: remove', () => {
  it('deletes the member and treats "already gone" as success', async () => {
    const ok = fakeService({ json: { data: { deleted: true } } });
    await ok.provider.remove('m-1');
    expect(ok.seen[0]).toMatchObject({
      url: `${BASE}/admin/templates/m-1`,
      method: 'DELETE',
      authorization: 'Bearer admin-token',
    });
    // Nothing to purge is a 200 with deleted:false; a 404 is tolerated too.
    await fakeService({ json: { data: { deleted: false } } }).provider.remove('m-1');
    await fakeService({ status: 404, json: { isError: true } }).provider.remove('m-1');
  });

  it('fails without calling the service when no admin token is configured', async () => {
    const seen: string[] = [];
    const provider = createRustRemoteProvider({
      baseUrl: BASE,
      fetch: async (url) => {
        seen.push(url);
        return new Response('{}');
      },
    });
    expect(await code(provider.remove('m-1'))).toBe('UNAVAILABLE');
    expect(seen).toEqual([]);
  });

  it('reports a refused token as UNAVAILABLE (a deployment fault), never as success', async () => {
    for (const status of [401, 403]) {
      const err = await rejection(fakeService({ status }).provider.remove('m-1'));
      expect(err.code).toBe('UNAVAILABLE');
      expect(err.message).toContain('admin token');
    }
  });

  it('fails (so the profile stays ACTIVE and can be retried) when the service is down', async () => {
    expect(await code(fakeService({ status: 503 }).provider.remove('m-1'))).toBe('UNAVAILABLE');
  });

  it('does not let a reference change the request path', async () => {
    const { seen, provider } = fakeService({ json: {} });
    await provider.remove('../admin/x?y=1');
    expect(seen[0]!.url).toBe(`${BASE}/admin/templates/..%2Fadmin%2Fx%3Fy%3D1`);
  });
});

describe('rust-remote: configuration', () => {
  const valid = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/facex',
    JWT_SECRET: 'a'.repeat(40),
    REFRESH_TOKEN_SECRET: 'b'.repeat(40),
    FRONTEND_URL: 'http://localhost:3000',
  };

  it('requires RUST_FACE_SERVICE_URL, and a URL, when the provider is rust-remote', () => {
    const rust = { FACE_PROVIDER: 'rust-remote', RUST_FACE_SERVICE_TOKEN: 'service-admin-token' };
    expect(() => parseEnv({ ...valid, ...rust })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...valid, ...rust, RUST_FACE_SERVICE_URL: 'not a url' })).toThrow(
      EnvValidationError,
    );
    expect(parseEnv({ ...valid, ...rust, RUST_FACE_SERVICE_URL: BASE }).RUST_FACE_SERVICE_URL).toBe(
      BASE,
    );
    // Removing a face needs the service's admin token: production refuses to start without it, development only warns.
    const noToken = { ...valid, FACE_PROVIDER: 'rust-remote', RUST_FACE_SERVICE_URL: BASE };
    expect(() => parseEnv({ ...noToken, NODE_ENV: 'production' })).toThrow(EnvValidationError);
    expect(parseEnv({ ...noToken, NODE_ENV: 'development' }).RUST_FACE_SERVICE_TOKEN).toBeUndefined();
    expect(parseEnv(valid).RUST_FACE_SERVICE_URL).toBeUndefined();
  });

  it('is registered under FACE_PROVIDER=rust-remote', () => {
    const provider = createFaceProvider(
      'rust-remote',
      { RUST_FACE_SERVICE_URL: BASE },
      { db: {} as never },
    );
    expect(provider?.name).toBe('rust-remote');
  });
});
