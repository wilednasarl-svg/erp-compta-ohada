import * as argon2 from 'argon2';

/**
 * Argon2id parameters — OWASP 2024 recommendation, centralized so that a
 * future migration of work factors only touches this file. See
 * `docs/plans/backend-auth-organizations.md` → BE-CRYPTO-01.
 *
 *  - `type`        : `argon2id` (mandatory: combines argon2i's side-channel
 *                    resistance with argon2d's GPU-cracking resistance).
 *  - `memoryCost`  : 19 456 KiB (~19 MiB), OWASP 2024 minimum.
 *  - `timeCost`    : 2 iterations, paired with the memory cost above.
 *  - `parallelism` : 1 lane — the Node backend serves auth from a single
 *                    pool, so additional lanes only burn CPU without raising
 *                    the bar for an attacker.
 *  - `hashLength`  : 32 bytes (256 bits) — argon2 default, kept explicit.
 *  - `saltLength`  : 16 bytes — argon2 default, kept explicit.
 *
 * Bumping any of these values is a backwards-compatible operation:
 * `argon2.verify` reads the parameters from the stored hash itself, so old
 * digests keep validating until the user next logs in (cf. BE-AUTH-* rehash
 * on successful login).
 */
export const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
} as const;
