// Shared plumbing for the end-to-end specs: minting a launch token, and deciding
// whether a spec can run at all.
//
// WHY THIS MINTS ITS OWN TOKEN
//
// In production the wizard is entered from Minty with `?token=<jwt>` in the URL --
// Flask mints it after the user signs in through the email OTP flow. A test cannot
// go through that flow, because it ends at a real inbox. But the token is an ordinary
// HS256 JWT over the SECRET_KEY that Minty and the Django service already share, so a
// test that holds the same secret can mint an equivalent one. Nothing is bypassed:
// the Django service verifies this token exactly as it verifies Flask's, signature,
// expiry, scope and all.
//
// The secret is read from the environment and never committed. Without it the
// authenticated specs skip rather than fail -- see e2e/README.md.

import { createHmac } from 'node:crypto';
import { test } from '@playwright/test';

/** Claims the Django service requires: see onboarding-backend/core/auth.py. */
const SCOPE = 'onboarding';

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * A signed onboarding launch token.
 *
 * Written out by hand rather than pulling in `jsonwebtoken`: it is HS256 over two
 * base64url segments, and a test-only dependency that can sign credentials is worth
 * avoiding.
 */
export function mintToken(
  userId: string,
  secret: string,
  { ttlSeconds = 900, scope = SCOPE }: { ttlSeconds?: number; scope?: string } = {},
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      user_id: userId,
      scope,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    }),
  );
  const signature = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

export type Credentials = { secret: string; userId: string; entityId: string; token: string };

/**
 * Credentials from the environment, or `null` when the suite is not configured for
 * authenticated runs.
 */
export function credentials(): Credentials | null {
  const secret = process.env.E2E_JWT_SECRET;
  const userId = process.env.E2E_USER_ID;
  const entityId = process.env.E2E_ENTITY_ID;
  if (!secret || !userId || !entityId) return null;
  return { secret, userId, entityId, token: mintToken(userId, secret) };
}

/**
 * Skip the whole file unless the authenticated environment is configured.
 *
 * `test.skip()` at describe level rather than a silent pass: an unconfigured run must
 * READ as "not run here", never as "these passed".
 */
export function requireCredentials(): Credentials {
  const creds = credentials();
  test.skip(
    !creds,
    'Set E2E_JWT_SECRET, E2E_USER_ID and E2E_ENTITY_ID to run the authenticated specs (see e2e/README.md)',
  );
  // Non-null after the skip above; Playwright aborts the test before reaching here.
  return creds as Credentials;
}

/** True when something answers `url` -- used to skip with a reason instead of timing out. */
export async function reachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}
