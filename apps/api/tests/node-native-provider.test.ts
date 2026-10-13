import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database/database';
import { FaceProviderError, type FaceImage } from '../src/infrastructure/face/face-provider';
import {
  NODE_NATIVE_MODEL,
  SAME_PERSON_DISTANCE,
  createNodeNativeProvider,
  distanceToSimilarity,
  euclideanDistance,
} from '../src/infrastructure/face/providers/node-native.provider';
import type {
  DetectedFace,
  FaceEngine,
} from '../src/infrastructure/face/providers/node-native/face-engine';
import {
  DESCRIPTOR_LENGTH,
  SEALED_BYTES,
  createTemplateCipher,
} from '../src/infrastructure/face/providers/node-native/template-cipher';
import { createChild } from './helpers/fixtures';
import { buildApi, createUser, openTestDb } from './helpers/test-app';

/**
 * The node-native adapter against real PostgreSQL (face_templates, face_profiles). The face ENGINE is a fake that turns markers
 * in the image bytes into descriptors: the real engine (face-api + WASM) is exercised separately, on real photos, by hand.
 * "FACE:<name>" is a person; "FACE:<name>~<n>" is the same person in another photo (a small, repeatable difference).
 */
const key = () => randomBytes(32).toString('base64');
const cipher = createTemplateCipher(key());

function unit(seed: string, noise = 0): Float32Array {
  // A repeatable pseudo-random descriptor per person, scaled so two different people are about 1.6 apart (face-api's scale).
  const out = new Float32Array(DESCRIPTOR_LENGTH);
  const base = createHash('sha256').update(seed.split('~')[0]!).digest();
  for (let i = 0; i < DESCRIPTOR_LENGTH; i += 1) {
    const h = createHash('sha256').update(base).update(String(i)).digest();
    out[i] = (h.readUInt16BE(0) / 65535 - 0.5) * 0.3464;
  }
  if (noise) {
    const n = createHash('sha256').update(seed).digest();
    for (let i = 0; i < DESCRIPTOR_LENGTH; i += 1) {
      const h = createHash('sha256').update(n).update(`n${i}`).digest();
      out[i] = out[i]! + (h.readUInt16BE(0) / 65535 - 0.5) * noise;
    }
  }
  return out;
}

const face = (name: string, size = 160, score = 0.95): DetectedFace => ({
  descriptor: unit(name, name.includes('~') ? 0.9 * 0.2 : 0),
  score,
  width: size,
  height: size,
});

function fakeEngine(): FaceEngine & { calls: number } {
  const engine = {
    calls: 0,
    async detect(image: FaceImage, signal?: AbortSignal): Promise<DetectedFace[]> {
      engine.calls += 1;
      if (signal?.aborted) throw new FaceProviderError('TIMEOUT');
      const text = Buffer.from(image.bytes).toString('latin1');
      if (text.includes('BROKEN')) throw new FaceProviderError('IMAGE_REJECTED');
      if (text.includes('NOFACE')) return [];
      if (text.includes('MANY')) return [face('x1'), face('x2')];
      if (text.includes('CROWD')) return [face('front', 300), face('behind', 100)];
      if (text.includes('SMALL')) return [face('small', 50)];
      if (text.includes('DIM')) return [face('dim', 160, 0.55)];
      const m = /FACE:([^:]+):/.exec(text);
      return m ? [face(m[1]!)] : [];
    },
    async close() {},
  };
  return engine;
}
const img = (label: string): FaceImage => ({
  bytes: new Uint8Array(Buffer.from(`xx${label}xx`)),
  mimeType: 'image/jpeg',
});
const person = (name: string) => img(`FACE:${name}:`);

describe('template encryption (AES-256-GCM)', () => {
  const ref = '3f2b9c1e-6f0a-4c8e-9a53-2f1d0b6d7a11';
  it('round-trips a descriptor and stores it as nonce + ciphertext + tag, never in the clear', () => {
    const c = createTemplateCipher(key());
    const d = unit('someone');
    const sealed = c.seal(d, ref);
    expect(sealed).toHaveLength(SEALED_BYTES);
    expect(Array.from(c.open(sealed, ref))).toEqual(Array.from(d));
    const plain = Buffer.from(d.buffer, d.byteOffset, d.byteLength);
    expect(sealed.includes(plain.subarray(0, 32))).toBe(false);
  });

  it('uses a fresh nonce each time', () => {
    const c = createTemplateCipher(key());
    const d = unit('someone');
    expect(c.seal(d, ref).equals(c.seal(d, ref))).toBe(false);
  });

  it('refuses a template that was altered, moved to another reference, or opened with another key', () => {
    const c = createTemplateCipher(key());
    const sealed = c.seal(unit('someone'), ref);
    const tampered = Buffer.from(sealed);
    tampered[40] = tampered[40]! ^ 0xff;
    expect(() => c.open(tampered, ref)).toThrow();
    expect(() => c.open(sealed, '00000000-0000-4000-8000-000000000000')).toThrow();
    expect(() => createTemplateCipher(key()).open(sealed, ref)).toThrow();
    expect(() => c.open(sealed.subarray(1), ref)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => createTemplateCipher(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('distance and similarity', () => {
  it('maps face-api distances onto the 0..1 scale the shared policy uses', () => {
    expect(distanceToSimilarity(0)).toBe(1);
    expect(distanceToSimilarity(0.4)).toBeCloseTo(0.9, 6); // the default automatic-match line
    expect(distanceToSimilarity(SAME_PERSON_DISTANCE)).toBeCloseTo(0.75, 6); // the default review line
    expect(distanceToSimilarity(5)).toBe(0);
    expect(distanceToSimilarity(0.3)).toBeGreaterThan(distanceToSimilarity(0.5)); // closer is more similar
  });

  it('computes Euclidean distance', () => {
    expect(euclideanDistance(Float32Array.of(0, 0), Float32Array.of(3, 4))).toBe(5);
    expect(euclideanDistance(unit('a'), unit('a'))).toBe(0);
    expect(euclideanDistance(unit('a'), unit('b'))).toBeGreaterThan(1);
    expect(euclideanDistance(unit('a'), unit('a~1'))).toBeLessThan(0.6);
  });
});

describe('node-native provider (real face_templates / face_profiles)', () => {
  let db: Database;
  let app: ReturnType<typeof buildApi>;
  const engine = fakeEngine();
  const makeProvider = () => createNodeNativeProvider({ db, engine, cipher });
  /** A face_profiles row for a reference, as the face service would make it, so identify() treats it as enrolled. */
  async function activate(reference: string, status: 'ACTIVE' | 'REVOKED' = 'ACTIVE') {
    const parent = await createUser(db, { roles: ['PARENT'] });
    const playerId = await createChild(app, parent.id);
    await db.query(
      `insert into public.face_profiles (player_id, provider, provider_profile_id, status, revoked_at)
       values ($1, 'node-native', $2, $3, case when $3 = 'REVOKED' then now() end)`,
      [playerId, reference, status],
    );
    return playerId;
  }
  const count = async () =>
    Number(
      (await db.query<{ n: string }>('select count(*) as n from public.face_templates')).rows[0]!.n,
    );

  beforeAll(() => {
    db = openTestDb();
    app = buildApi(db);
  });
  afterAll(() => db.close());

  it('has the stable name the registry and face_profiles use', () => {
    expect(makeProvider().name).toBe('node-native');
  });

  it('enroll stores one encrypted template behind an opaque reference (no image, no readable descriptor)', async () => {
    const p = makeProvider();
    const { reference } = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c1',
      image: person('ada'),
      idempotencyKey: 'e1',
    });
    expect(reference).toMatch(/^[0-9a-f-]{36}$/);
    const { rows } = await db.query<{
      descriptor: Buffer;
      model: string;
      key_version: number;
      subject_id: string;
    }>(
      'select descriptor, model, key_version, subject_id from public.face_templates where reference = $1',
      [reference],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      model: NODE_NATIVE_MODEL,
      key_version: 1,
      subject_id: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c1',
    });
    expect(rows[0]!.descriptor).toHaveLength(SEALED_BYTES);
    const d = unit('ada');
    expect(rows[0]!.descriptor.includes(Buffer.from(d.buffer, d.byteOffset, 32))).toBe(false);
    expect(Array.from(cipher.open(rows[0]!.descriptor, reference))).toEqual(Array.from(d));
  });

  it('enroll with the same idempotency key returns the same identity and analyses nothing twice', async () => {
    const p = makeProvider();
    const before = engine.calls;
    const a = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c2',
      image: person('bob'),
      idempotencyKey: 'same',
    });
    const rows1 = await count();
    const b = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c2',
      image: person('bob'),
      idempotencyKey: 'same',
    });
    expect(b.reference).toBe(a.reference);
    expect(await count()).toBe(rows1);
    expect(engine.calls).toBe(before + 1);
  });

  it('enroll accepts exactly one clear face, and says why when it is not', async () => {
    const p = makeProvider();
    const code = async (image: FaceImage) =>
      (
        (await p
          .enroll({
            subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c3',
            image,
            idempotencyKey: `k-${Math.random()}`,
          })
          .catch((e: unknown) => e)) as FaceProviderError
      ).code;
    expect(await code(img('NOFACE'))).toBe('NO_FACE_DETECTED');
    expect(await code(img('MANY'))).toBe('MULTIPLE_FACES');
    expect(await code(img('CROWD'))).toBe('MULTIPLE_FACES'); // strict: a second face could be enrolled as the wrong person
    expect(await code(img('SMALL'))).toBe('LOW_QUALITY');
    expect(await code(img('DIM'))).toBe('LOW_QUALITY');
    expect(await code(img('BROKEN'))).toBe('IMAGE_REJECTED');
  });

  it('identify finds the enrolled person, scores a different photo of them above the review line, and ignores strangers', async () => {
    const p = makeProvider();
    const ada = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c4',
      image: person('ida'),
      idempotencyKey: `i-${Math.random()}`,
    });
    const eve = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c5',
      image: person('eve'),
      idempotencyKey: `i-${Math.random()}`,
    });
    await activate(ada.reference);
    await activate(eve.reference);

    const same = await p.identify({ image: person('ida'), maxCandidates: 5 });
    expect(same.candidates[0]).toEqual({ reference: ada.reference, similarity: 1 });
    expect(same.candidates.find((c) => c.reference === eve.reference)).toBeUndefined(); // far apart: not even offered

    const another = await p.identify({ image: person('ida~2'), maxCandidates: 5 });
    expect(another.candidates[0]!.reference).toBe(ada.reference);
    expect(another.candidates[0]!.similarity).toBeGreaterThan(0.75);
    expect(another.candidates[0]!.similarity).toBeLessThan(1);

    const stranger = await p.identify({ image: person('nobody-enrolled'), maxCandidates: 5 });
    expect(stranger.candidates).toEqual([]);
  });

  it('identify never offers a template whose profile was removed, or has none', async () => {
    const p = makeProvider();
    const gone = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c6',
      image: person('gone'),
      idempotencyKey: `g-${Math.random()}`,
    });
    await activate(gone.reference, 'REVOKED');
    const orphan = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c7',
      image: person('orphan'),
      idempotencyKey: `g-${Math.random()}`,
    });
    expect((await p.identify({ image: person('gone'), maxCandidates: 5 })).candidates).toEqual([]);
    expect((await p.identify({ image: person('orphan'), maxCandidates: 5 })).candidates).toEqual(
      [],
    );
    expect(orphan.reference).toBeTruthy();
  });

  it('identify picks the person standing at the camera when others are behind them, and refuses a frame with equals', async () => {
    const p = makeProvider();
    const noise = await p.identify({ image: img('CROWD'), maxCandidates: 3 });
    expect(noise.candidates).toEqual([]); // the front face is a stranger: no one matches, and it is not an error
    const code = async (image: FaceImage) =>
      (
        (await p
          .identify({ image, maxCandidates: 3 })
          .catch((e: unknown) => e)) as FaceProviderError
      ).code;
    expect(await code(img('MANY'))).toBe('MULTIPLE_FACES');
    expect(await code(img('NOFACE'))).toBe('NO_FACE_DETECTED');
    expect(await code(img('SMALL'))).toBe('LOW_QUALITY');
  });

  it('identify says "unavailable", not "no match", when the stored templates cannot be read (wrong key)', async () => {
    const withKey = createNodeNativeProvider({ db, engine, cipher: createTemplateCipher(key()) });
    const mine = makeProvider();
    const t = await mine.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c8',
      image: person('keytest'),
      idempotencyKey: `w-${Math.random()}`,
    });
    await activate(t.reference);
    const err = (await withKey
      .identify({ image: person('keytest'), maxCandidates: 3 })
      .catch((e: unknown) => e)) as FaceProviderError;
    expect(err).toBeInstanceOf(FaceProviderError);
    expect(err.code).toBe('UNAVAILABLE');
  });

  it('verify compares one enrolled face with one image; an unknown reference scores 0', async () => {
    const p = makeProvider();
    const t = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6c9',
      image: person('vera'),
      idempotencyKey: `v-${Math.random()}`,
    });
    expect((await p.verify({ reference: t.reference, image: person('vera') })).similarity).toBe(1);
    expect(
      (await p.verify({ reference: t.reference, image: person('someone-else') })).similarity,
    ).toBeLessThan(0.3);
    expect(
      (await p.verify({ reference: '00000000-0000-4000-8000-000000000001', image: person('vera') }))
        .similarity,
    ).toBe(0);
    expect((await p.verify({ reference: 'not-a-uuid', image: person('vera') })).similarity).toBe(0);
  });

  it('remove erases the template for good, and succeeds when it is already gone', async () => {
    const p = makeProvider();
    const t = await p.enroll({
      subjectId: 'ab0c3ac0-6d6e-4ad6-98d3-5a3ee0e3a6d0',
      image: person('rem'),
      idempotencyKey: `r-${Math.random()}`,
    });
    await p.remove(t.reference);
    const left = await db.query('select 1 from public.face_templates where reference = $1', [
      t.reference,
    ]);
    expect(left.rowCount).toBe(0);
    await expect(p.remove(t.reference)).resolves.toBeUndefined();
    await expect(p.remove('not-a-uuid')).resolves.toBeUndefined();
  });

  it('stops when its abort signal fires', async () => {
    const p = makeProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(
      p.identify({ image: person('x'), maxCandidates: 1, signal: controller.signal }),
    ).rejects.toThrow();
  });
});
