import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import express, { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { SNIFF_BYTES, sniffContentType } from './content-sniffing';
import { STORAGE_AREAS } from './file-storage';
import type { ObjectInspector } from './object-inspector';
import type { ObjectReader } from './object-reader';
import type { StorageProvider } from './storage-provider';

/**
 * A storage driver that keeps files in a folder on THIS machine, for local development and tests only.
 *
 * It exists so the whole upload flow (signed URL -> browser PUT -> server verification -> review download) can be tried
 * without any cloud account. It behaves like a real bucket from the rest of the app's point of view: the same three
 * interfaces (StorageProvider, ObjectInspector, ObjectReader), the same short-lived signed URLs, and the same key layout.
 * It is refused in production (see config/env.ts): a deployment uses an S3-compatible bucket instead.
 *
 * Signed URLs point at `/api/v1/dev-storage/<key>` on the API itself. The signature (HMAC-SHA256 of the method, key,
 * expiry and, for uploads, the exact content type and size) is the only credential, exactly like a bucket's presigned URL.
 */

export const LOCAL_STORAGE_ROUTE = '/api/v1/dev-storage';

const KEY_RE =
  /^(registration-documents|player-images)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface LocalStorageConfig {
  /** Folder that holds the files. Relative paths are resolved against the working directory. */
  dir: string;
  /** Prefix for the URLs handed to the browser: '' (same origin, the default) or e.g. 'http://localhost:4000'. */
  publicUrl: string;
  /** Signing secret. The server derives it from a secret it already has, so it needs no extra setting. */
  secret: string;
}

export interface LocalStorage {
  provider: StorageProvider;
  inspector: ObjectInspector;
  reader: ObjectReader;
  /** Serves the signed upload and download URLs. Mount it once; it reads its own raw bodies. */
  router: Router;
}

const sign = (secret: string, parts: (string | number)[]) =>
  createHmac('sha256', secret).update(parts.join('\n')).digest('base64url');

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function createLocalStorage(config: LocalStorageConfig): LocalStorage {
  const root = resolve(config.dir);
  const publicUrl = config.publicUrl.replace(/\/+$/, '');

  /** Absolute path of a key, only for a well-formed key and only inside the storage folder. */
  const pathOf = (key: string): string => {
    if (!KEY_RE.test(key)) throw AppError.notFound('STORAGE_OBJECT_NOT_FOUND', 'Not found');
    const full = resolve(root, key);
    if (!full.startsWith(root + sep))
      throw AppError.notFound('STORAGE_OBJECT_NOT_FOUND', 'Not found');
    return full;
  };

  const provider: StorageProvider = {
    async createUploadUrl(key, { contentType, contentLength, expiresInSeconds }) {
      const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
      const sig = sign(config.secret, ['PUT', key, exp, contentType, contentLength]);
      const qs = new URLSearchParams({
        exp: String(exp),
        ct: contentType,
        len: String(contentLength),
        sig,
      });
      return {
        url: `${publicUrl}${LOCAL_STORAGE_ROUTE}/${key}?${qs}`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expiresAt: new Date(exp * 1000),
      };
    },

    async createDownloadUrl(key, { expiresInSeconds, downloadFileName, inline }) {
      const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
      const dl = downloadFileName ?? '';
      const sig = sign(config.secret, ['GET', key, exp, dl, inline ? 'inline' : 'attachment']);
      const qs = new URLSearchParams({ exp: String(exp), sig });
      if (dl) qs.set('dl', dl);
      if (inline) qs.set('inline', '1');
      return {
        url: `${publicUrl}${LOCAL_STORAGE_ROUTE}/${key}?${qs}`,
        expiresAt: new Date(exp * 1000),
      };
    },

    async deleteObject(key) {
      await rm(pathOf(key), { force: true });
    },
  };

  const inspector: ObjectInspector = {
    async inspect(key) {
      const file = pathOf(key);
      let size: number;
      try {
        size = (await stat(file)).size;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false };
        throw e;
      }
      const handle = await open(file, 'r');
      try {
        const header = Buffer.alloc(Math.min(SNIFF_BYTES, size));
        await handle.read(header, 0, header.length, 0);
        return { exists: true, sizeBytes: size, header: new Uint8Array(header) };
      } finally {
        await handle.close();
      }
    },
  };

  const reader: ObjectReader = {
    async read(key, { maxBytes }) {
      const file = pathOf(key);
      try {
        const { size } = await stat(file);
        if (size > maxBytes) return { exists: true, tooLarge: true };
        return { exists: true, tooLarge: false, bytes: new Uint8Array(await readFile(file)) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false };
        throw e;
      }
    },
  };

  // ---- the signed-URL endpoints ----
  const router = Router();
  const biggest = Math.max(...Object.values(STORAGE_AREAS).map((a) => a.maxBytes));
  const query = z.object({
    exp: z.coerce.number().int(),
    sig: z.string().min(10).max(200),
    ct: z.string().max(100).optional(),
    len: z.coerce.number().int().positive().optional(),
    dl: z.string().max(300).optional(),
    inline: z.literal('1').optional(),
  });
  const denied = () => AppError.forbidden('This storage link is not valid', 'STORAGE_LINK_INVALID');

  const target = (req: express.Request) => {
    const key = `${req.params.area}/${req.params.registrationId}/${req.params.objectId}`;
    const q = query.safeParse(req.query);
    if (!q.success || !KEY_RE.test(key)) throw denied();
    if (q.data.exp < Math.floor(Date.now() / 1000))
      throw AppError.forbidden('This storage link has expired', 'STORAGE_LINK_EXPIRED');
    return { key, ...q.data };
  };

  router.put(
    `${LOCAL_STORAGE_ROUTE}/:area/:registrationId/:objectId`,
    express.raw({ type: () => true, limit: biggest + 1 }),
    async (req, res) => {
      const t = target(req);
      if (t.ct === undefined || t.len === undefined) throw denied();
      if (!safeEqual(t.sig, sign(config.secret, ['PUT', t.key, t.exp, t.ct, t.len])))
        throw denied();
      // The link was signed for one exact type and size: anything else is a different file.
      if (req.headers['content-type'] !== t.ct) throw denied();
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length !== t.len) throw denied();
      const file = pathOf(t.key);
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await rm(tmp, { force: true });
      await writeFile(tmp, body);
      await rename(tmp, file);
      res.status(200).end();
    },
  );

  router.get(`${LOCAL_STORAGE_ROUTE}/:area/:registrationId/:objectId`, async (req, res) => {
    const t = target(req);
    const disposition = t.inline ? 'inline' : 'attachment';
    if (!safeEqual(t.sig, sign(config.secret, ['GET', t.key, t.exp, t.dl ?? '', disposition])))
      throw denied();
    const file = pathOf(t.key);
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw AppError.notFound('STORAGE_OBJECT_NOT_FOUND', 'Not found');
      throw e;
    }
    res.setHeader(
      'Content-Type',
      sniffContentType(bytes.subarray(0, SNIFF_BYTES)) ?? 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `${disposition}${t.dl ? `; filename*=UTF-8''${encodeURIComponent(t.dl)}` : ''}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(bytes);
  });

  return { provider, inspector, reader, router };
}
