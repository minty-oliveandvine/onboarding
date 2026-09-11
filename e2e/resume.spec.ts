// The cold resume -- the single flow that exercises the most of this system at once.
//
// "Cold" means a browser with nothing in localStorage: the wizard has to rebuild the
// user's position from the `entities` row alone. That path crosses state derivation,
// membership auth, and the two different step numbers the backend and the frontend each
// call "the step", so a unit test can reach parts of it but nothing else reaches all of
// it together.
//
// WHAT THIS SPEC WRITES
//
// It POSTs /api/onboarding/saved-step for E2E_ENTITY_ID and restores the original value
// afterwards. That is a real write to a real row -- point E2E_ENTITY_ID at a disposable
// entity. See e2e/README.md.
//
// NEVER LET THE BROWSER LAND ON STEP 9
//
// Step 9 is "All Set", and arriving there runs `completeOnboarding` ON ARRIVAL --
// OnboardingApp.jsx:1204 records that the screen itself "commits nothing" precisely
// because arrival already did. That call submits the opening balance and POSTs
// /finalize, which flips the entity to `active` and starts a trial subscription per
// module. An earlier version of this spec landed on whatever step the database held,
// finalized a dev entity, and created two trial rows.
//
// So `land()` PINS saved_step to a safe step before every navigation and never trusts
// the stored value. Do not add a navigation that skips it.
//
// WHAT IT CANNOT COVER
//
// The full nine-step walk to finalize. Step 4 is a live Xero OAuth round-trip against
// Xero's own servers; there is no test account path through it, and faking the callback
// would be testing the fake. The wizard cannot be driven past step 4 by a test, so the
// later steps are covered by the unit and component suites only.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mintToken, reachable, requireCredentials, type Credentials } from './helpers';
import { ONBOARDING_API_URL } from './urls';

let creds: Credentials;

test.beforeEach(async () => {
  creds = requireCredentials();
  test.skip(
    !(await reachable(`${ONBOARDING_API_URL}/api/onboarding/server-time`)),
    `The onboarding service is not answering on ${ONBOARDING_API_URL}`,
  );
});

const auth = () => ({ Authorization: `Bearer ${creds.token}` });

async function readState(request: APIRequestContext) {
  const res = await request.get(
    `${ONBOARDING_API_URL}/api/onboarding/state?entity_id=${creds.entityId}`,
    { headers: auth() },
  );
  expect(res.status(), 'GET /state').toBe(200);
  return res.json();
}

async function writeSavedStep(request: APIRequestContext, step: number) {
  const res = await request.post(`${ONBOARDING_API_URL}/api/onboarding/saved-step`, {
    headers: auth(),
    data: { entity_id: creds.entityId, saved_step: step },
  });
  expect(res.status(), `POST /saved-step ${step}`).toBe(200);
  return res.json();
}

/** A step the browser may safely be shown. Never 9 -- see the module header. */
const SAFE_STEP = 2;

/**
 * Land on the wizard the way Minty does: token in the query string.
 *
 * `step` is PINNED through the API first, so the browser can never arrive at whatever
 * the row currently holds. That is not tidiness -- landing on 9 finalizes the entity.
 */
async function land(page: Page, request: APIRequestContext, step: number = SAFE_STEP) {
  if (step === 9) throw new Error('refusing to land on step 9: arrival there finalizes the entity');
  await writeSavedStep(request, step);
  await page.goto(`/?token=${creds.token}&entity_id=${creds.entityId}`);
  await expect(page.locator('.stepper')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** The stored saved_step, so a test can put it back. */
async function stashSavedStep(request: APIRequestContext): Promise<number | null> {
  const state = await readState(request);
  return state.saved_step ?? null;
}

/** Put the stored saved_step back, if there was one. */
async function restoreSavedStep(request: APIRequestContext, original: number | null) {
  if (original !== null) await writeSavedStep(request, original);
}

/** The step id of the tile the stepper is showing as active. */
async function activeStep(page: Page): Promise<number> {
  const key = await page.locator('.step.active').first().getAttribute('data-step-key');
  return Number(key);
}

test('a valid launch token opens the wizard rather than the sign-in screen', async ({
  page,
  request,
}) => {
  const original = await stashSavedStep(request);
  try {
    await land(page, request);
    await expect(page.locator('.stepper')).toBeVisible();
    expect(await activeStep(page)).toBe(SAFE_STEP);
  } finally {
    await restoreSavedStep(request, original);
  }
});

test('the launch token is stripped from the address bar', async ({ page, request }) => {
  // It is a bearer credential. Leaving it in the URL puts it in history, in the
  // Referer header of every outbound link, and in any screenshot the user sends.
  const original = await stashSavedStep(request);
  try {
    await land(page, request);
    expect(page.url()).not.toContain('token=');
    expect(new URL(page.url()).search).toBe('');
  } finally {
    await restoreSavedStep(request, original);
  }
});

test('the wizard resumes where the DATABASE says, not where the browser does', async ({
  page,
  request,
}) => {
  const before = await readState(request);
  const original: number | null = before.saved_step ?? null;
  // A step in the common 1-4 range, so the landing tile is unambiguous -- 5, 6 and 7
  // collapse into one Petty Cash tile whose data-step-key is always 5.
  const target = original === 3 ? 4 : 3;

  try {
    // Warm first: prove the wizard lands there at all.
    await land(page, request, target);
    expect(await activeStep(page)).toBe(target);

    // Now COLD. Everything the browser remembered is gone, which is the whole point:
    // a new machine, incognito, or a cleared profile must reconstruct the position
    // from the entities row.
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.context().clearCookies();
    await land(page, request, target);

    expect(
      await activeStep(page),
      'a cold browser did not land on the step the database recorded',
    ).toBe(target);

    // And the API agrees with what the screen is showing.
    const after = await readState(request);
    expect(after.saved_step).toBe(target);
  } finally {
    if (original !== null) await writeSavedStep(request, original);
  }
});

test('saved_step and current_step are allowed to disagree', async ({ request }) => {
  // Two different numbers that both look like "the step": saved_step is the FRONTEND
  // id the user was on when they hit Save, current_step is the backend's own derived
  // landing step from a different ordering. /saved-step stores the frontend one
  // verbatim, with no remap in either direction -- collapsing them is the bug that
  // once sent users past an incomplete step into "Connect to Accounting".
  const before = await readState(request);
  const original: number | null = before.saved_step ?? null;
  try {
    const body = await writeSavedStep(request, 3);
    expect(body).toMatchObject({ ok: true, saved_step: 3 });
    const after = await readState(request);
    expect(after.saved_step, 'saved_step is stored verbatim').toBe(3);
    expect(typeof after.current_step).toBe('number');
  } finally {
    if (original !== null) await writeSavedStep(request, original);
  }
});

test('an out-of-range saved_step is refused with the wizard own wording', async ({ request }) => {
  const res = await request.post(`${ONBOARDING_API_URL}/api/onboarding/saved-step`, {
    headers: auth(),
    data: { entity_id: creds.entityId, saved_step: 42 },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  // The wizard renders this sentence as-is, so it is part of the contract. Note the
  // body key is `error`, not ninja's default `detail`.
  expect(body.error).toBe('saved_step must be an integer 1-9');
});

test('a token minted for a DIFFERENT scope is refused', async ({ request }) => {
  // The Django service verifies `scope`; Flask's own decoder never did, so any HS256
  // token over the shared secret used to open this surface -- including the short-lived
  // assertion the Xero token service accepts. This asserts that tightening is in force,
  // and it is signed with the REAL secret, so only the scope check can reject it.
  const xeroAssertion = mintToken(creds.userId, creds.secret, { scope: 'xero-access-token' });
  const res = await request.get(
    `${ONBOARDING_API_URL}/api/onboarding/state?entity_id=${creds.entityId}`,
    { headers: { Authorization: `Bearer ${xeroAssertion}` } },
  );
  expect(res.status()).toBe(401);
});

test('a token signed with the WRONG secret is refused', async ({ request }) => {
  const forged = mintToken(creds.userId, 'not-the-shared-secret');
  const res = await request.get(
    `${ONBOARDING_API_URL}/api/onboarding/state?entity_id=${creds.entityId}`,
    { headers: { Authorization: `Bearer ${forged}` } },
  );
  expect(res.status()).toBe(401);
});

test('an expired token is refused', async ({ request }) => {
  const stale = mintToken(creds.userId, creds.secret, { ttlSeconds: -60 });
  const res = await request.get(
    `${ONBOARDING_API_URL}/api/onboarding/state?entity_id=${creds.entityId}`,
    { headers: { Authorization: `Bearer ${stale}` } },
  );
  expect(res.status()).toBe(401);
});

test('a malformed bearer value is refused', async ({ request }) => {
  const res = await request.get(
    `${ONBOARDING_API_URL}/api/onboarding/state?entity_id=${creds.entityId}`,
    { headers: { Authorization: 'Bearer not-a-jwt' } },
  );
  expect(res.status()).toBe(401);
});

test('no token at all is refused', async ({ request }) => {
  const res = await request.get(
    `${ONBOARDING_API_URL}/api/onboarding/state?entity_id=${creds.entityId}`,
  );
  expect(res.status()).toBe(401);
});
