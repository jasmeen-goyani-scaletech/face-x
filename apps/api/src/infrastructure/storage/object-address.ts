import type { StorageConfig } from './storage-provider';

/**
 * The permanent address of an object in the bucket, and the way back from an address to its key.
 *
 * An address is not a link anyone can open: the bucket is private, so a request without a signature is refused. It is the
 * stable thing worth keeping in the database (a signed link expires; this does not), and it is signed on the way out when a
 * person needs to see the file.
 */
export interface ObjectAddress {
  urlFor(key: string): string;
  /** The key a URL of THIS bucket names, or null for any other host, bucket or shape. */
  keyOf(url: string): string | null;
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export function createObjectAddress(
  config: Pick<StorageConfig, 'endpoint' | 'region' | 'bucket' | 'forcePathStyle'>,
): ObjectAddress {
  // The part of every address that precedes the key. Same layout as the face service uses, so both sides agree on a URL.
  let prefix: string;
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint);
    prefix = config.forcePathStyle
      ? `${endpoint.protocol}//${endpoint.host}/${config.bucket}/`
      : `${endpoint.protocol}//${config.bucket}.${endpoint.host}/`;
  } else {
    prefix = `https://${config.bucket}.s3.${config.region}.amazonaws.com/`;
  }
  return {
    urlFor: (key) => `${prefix}${encodeKey(key)}`,
    keyOf(url) {
      if (!url.startsWith(prefix)) return null;
      const rest = url.slice(prefix.length).split(/[?#]/, 1)[0] ?? '';
      if (!rest) return null;
      try {
        const key = rest.split('/').map(decodeURIComponent).join('/');
        // A dot segment would let an address point outside the key space it appears to name.
        return key.split('/').some((s) => s === '' || s === '.' || s === '..') ? null : key;
      } catch {
        return null;
      }
    },
  };
}
