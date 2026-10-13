import argon2 from 'argon2';

/** Argon2id at the OWASP-recommended minimum (19 MiB, 2 passes, 1 lane). Raise these as hardware allows. */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password or an unparseable hash; never throws on bad input. */
  verify(hash: string, password: string): Promise<boolean>;
  /** True when the stored hash uses weaker parameters than the current ones and should be recomputed. */
  needsRehash(hash: string): boolean;
  /**
   * Spends the same time as a real verification. Used when the email is unknown so that response time
   * does not reveal which emails have accounts.
   */
  burn(password: string): Promise<void>;
}

export function createPasswordHasher(): PasswordHasher {
  let dummy: Promise<string> | undefined;
  return {
    hash: (password) => argon2.hash(password, OPTIONS),
    async verify(hash, password) {
      try {
        return await argon2.verify(hash, password);
      } catch {
        return false;
      }
    },
    needsRehash: (hash) => argon2.needsRehash(hash, OPTIONS),
    async burn(password) {
      dummy ??= argon2.hash('not-a-real-password', OPTIONS);
      await argon2.verify(await dummy, password).catch(() => false);
    },
  };
}
