/**
 * Removes credentials and bearer links from text that is about to be logged. Errors from external systems
 * (payment provider, object storage) are logged server-side for debugging, but their text must never carry a
 * secret key, a webhook secret, a signed URL signature or a hosted-checkout link, whatever the SDK put in it.
 */
const PATTERNS: [RegExp, string][] = [
  [/\b[sr]k_(?:test|live)_[A-Za-z0-9]+/g, '[REDACTED_KEY]'],
  [/\bwhsec_[A-Za-z0-9]+/g, '[REDACTED_SECRET]'],
  [/\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]'],
  [/\bAKIA[0-9A-Z]{8,}/g, '[REDACTED_KEY]'],
  [/X-Amz-(?:Signature|Credential|Security-Token)=[^&\s"']+/gi, 'X-Amz-[REDACTED]'],
  [/https:\/\/checkout\.stripe\.com\/\S+/g, '[REDACTED_CHECKOUT_URL]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]'],
];

export function scrubSecrets(text: string): string {
  return PATTERNS.reduce((out, [re, replacement]) => out.replace(re, replacement), text);
}

/**
 * A copy of `cause` that is safe to attach to an error for logging: same name and (scrubbed) message and
 * stack, plus the provider's non-sensitive diagnostic fields when present.
 */
export function safeCause(cause: unknown): Error {
  const source = cause instanceof Error ? cause : new Error(String(cause));
  const copy = new Error(scrubSecrets(source.message));
  copy.name = source.name;
  if (source.stack) copy.stack = scrubSecrets(source.stack);
  const extra = source as { code?: unknown; statusCode?: unknown; requestId?: unknown };
  Object.assign(copy, {
    ...(typeof extra.code === 'string' ? { code: extra.code } : {}),
    ...(typeof extra.statusCode === 'number' ? { statusCode: extra.statusCode } : {}),
    ...(typeof extra.requestId === 'string' ? { requestId: extra.requestId } : {}),
  });
  return copy;
}
