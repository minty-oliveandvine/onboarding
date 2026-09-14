// The authenticated specs' shared view of the onboarding service: read the entity's
// state, pin its saved step, land the browser on a step, and put the entity back.
//
// Every call here goes through Playwright's `request` fixture with a minted bearer, so
// page.route() fakes installed on the page never touch it -- what these functions read
// and write is the real row.
//
// NEVER LET THE BROWSER LAND ON STEP 9
//
// Step 9 is "All Set", and arriving there runs `completeOnboarding` ON ARRIVAL: it
// submits the opening balance and POSTs /finalize, which flips the entity to `active`
// and starts a trial per enabled module. An early spec landed on whatever step the row
// happened to hold, finalized a dev entity, and created two trial rows.
//
// So `land()` PINS saved_step before every navigation and refuses 9 outright. The one
// spec that does reach All Set (walk.spec.ts) gets there by clicking through, on the
// disposable entity, and calls `resetEntity()` before and after.

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Credentials } from './helpers';
import { ONBOARDING_API_URL } from './urls';

const auth = (creds: Credentials) => ({ Authorization: `Bearer ${creds.token}` });

export async function readState(request: APIRequestContext, creds: Credentials) {
  const res = await request.get(
    `${ONBOARDING_API_URL}/api/onboarding/state?entity_id=${creds.entityId}`,
    { headers: auth(creds) },
  );
  expect(res.status(), 'GET /state').toBe(200);
  return res.json();
}

export async function writeSavedStep(request: APIRequestContext, creds: Credentials, step: number) {
  const res = await request.post(`${ONBOARDING_API_URL}/api/onboarding/saved-step`, {
    headers: auth(creds),
    data: { entity_id: creds.entityId, saved_step: step },
  });
  expect(res.status(), `POST /saved-step ${step}`).toBe(200);
  return res.json();
}

/** A step the browser may safely be shown. Never 9 -- see the module header. */
export const SAFE_STEP = 2;

/**
 * Land on the wizard the way Minty does: token in the query string.
 *
 * `step` is PINNED through the API first, so the browser can never arrive at whatever
 * the row currently holds. That is not tidiness -- landing on 9 finalizes the entity.
 */
export async function land(
  page: Page,
  request: APIRequestContext,
  creds: Credentials,
  step: number = SAFE_STEP,
) {
  if (step === 9) throw new Error('refusing to land on step 9: arrival there finalizes the entity');
  await writeSavedStep(request, creds, step);
  await page.goto(`/?token=${creds.token}&entity_id=${creds.entityId}`);
  await expect(page.locator('.stepper')).toBeVisible();
  await page.waitForLoadState('networkidle');
  // The wizard has ADOPTED the entity, not just rendered: it writes its session under a
  // per-entity key only once /state gave it the id. Without this a load whose /state
  // body was unusable falls back to the standalone prototype -- every later step then
  // short-circuits on the missing id, and "Connect to Xero" fakes a connection locally
  // without leaving the page, which reads as a pass until something downstream is empty.
  await expect
    .poll(
      () => page.evaluate((k) => window.localStorage.getItem(k), `minty_onboarding_session:${creds.entityId}`),
      { message: 'the wizard did not pick up the entity from GET /state' },
    )
    .not.toBeNull();
}

/** The stored saved_step, so a test can put it back. */
export async function stashSavedStep(
  request: APIRequestContext,
  creds: Credentials,
): Promise<number | null> {
  const state = await readState(request, creds);
  return state.saved_step ?? null;
}

/** Put the stored saved_step back, if there was one. */
export async function restoreSavedStep(
  request: APIRequestContext,
  creds: Credentials,
  original: number | null,
) {
  if (original !== null) await writeSavedStep(request, creds, original);
}

/** The step id of the tile the stepper is showing as active. */
export async function activeStep(page: Page): Promise<number> {
  const key = await page.locator('.step.active').first().getAttribute('data-step-key');
  return Number(key);
}

/**
 * Put the disposable entity back into onboarding after a walk reached All Set.
 *
 * `POST /xero/disconnect` is the only token-authenticated endpoint that writes
 * `entities.status`, and for an entity with no Xero connector it does nothing else:
 * Flask skips the remote revoke when `connected_by_user_id` is null and just sets
 * status = 'onboarding' (Minty blueprints/entity/services/onboarding_xero.py). The
 * caller must hold XERO_SETTINGS_UPDATE on the entity, which the admin the README seeds
 * does.
 *
 * It does NOT remove trial rows finalize may have inserted -- see e2e/README.md.
 */
export async function resetEntity(
  request: APIRequestContext,
  creds: Credentials,
  savedStep: number | null,
) {
  const res = await request.post(`${ONBOARDING_API_URL}/api/onboarding/xero/disconnect`, {
    headers: auth(creds),
    data: { entity_id: creds.entityId },
  });
  expect(res.status(), 'POST /xero/disconnect (entity reset)').toBe(200);
  await restoreSavedStep(request, creds, savedStep);
  const after = await readState(request, creds);
  expect(after.status, 'the entity is back in onboarding').toBe('onboarding');
  expect(after.xero?.connected, 'the entity has no Xero org').toBe(false);
}
