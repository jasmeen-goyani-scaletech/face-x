import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** 128 float32 numbers: what face-api's recognition net produces for one face. */
export const DESCRIPTOR_LENGTH = 128;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** nonce || ciphertext || tag: the exact size of the stored `face_templates.descriptor` column. */
export const SEALED_BYTES = NONCE_BYTES + DESCRIPTOR_LENGTH * 4 + TAG_BYTES;
/** Written with each template so a key can be replaced later without losing the faces encrypted under the old one. */
export const KEY_VERSION = 1;

export interface TemplateCipher {
  seal(descriptor: Float32Array, reference: string): Buffer;
  /** Throws when the row was altered, moved to another reference, or encrypted under another key. */
  open(sealed: Uint8Array, reference: string): Float32Array;
}

/**
 * AES-256-GCM over a descriptor. The template's reference is bound in as additional authenticated data, so a stored row
 * cannot be copied onto a different person's reference without failing to open. A fresh random nonce is used per seal.
 */
export function createTemplateCipher(keyBase64: string): TemplateCipher {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('The face encryption key must be 32 bytes');
  const aad = (reference: string) => Buffer.from(`face-template:${reference}`);

  return {
    seal(descriptor, reference) {
      if (descriptor.length !== DESCRIPTOR_LENGTH) throw new Error('Unexpected descriptor size');
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(aad(reference));
      const plain = Buffer.from(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength);
      return Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    },

    open(sealed, reference) {
      if (sealed.length !== SEALED_BYTES) throw new Error('Unexpected template size');
      const buf = Buffer.from(sealed);
      const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, NONCE_BYTES));
      decipher.setAAD(aad(reference));
      decipher.setAuthTag(buf.subarray(SEALED_BYTES - TAG_BYTES));
      const plain = Buffer.concat([
        decipher.update(buf.subarray(NONCE_BYTES, SEALED_BYTES - TAG_BYTES)),
        decipher.final(),
      ]);
      // A copy, so the Float32Array owns an aligned buffer of its own.
      return new Float32Array(
        plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength),
      );
    },
  };
}
