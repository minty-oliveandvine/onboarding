// The walk: Connect (4) -> Sales (5) -> Account Code (6) -> Contacts (7) -> Payment
// Settings (8) -> All Set (9), clicking, with Xero faked at the browser and everything
// else real -- including `POST /finalize` on arrival at 9.
//
// THIS SPEC FINALIZES E2E_ENTITY_ID
//
// That is the point of it: no other test proves a company can be walked all the way
// through. It is also why the entity must be disposable. Arriving at All Set flips the
// row to `connected` / `disconnected`, and `resetEntity()` (e2e/onboardingApi.ts) puts it back -- BEFORE the
// walk too, so a run that crashed mid-way cannot poison the next one.
//
// What a run leaves behind, by design: the entity's sales methods and a draft opening
// balance (both reconciled on the next run), and, only if the DB has modules enabled for
// the entity, the trial rows the first finalize inserted. See e2e/README.md.
//
// The browser is never NAVIGATED to step 9. It gets there by clicking "Complete", which
// is the only way a user does either.

import { expect, test, type Page } from '@playwright/test';
import { IDS, LABELS } from './fixtures/xero';
import { reachable, requireCredentials, type Credentials, subscriptionsDark } from './helpers';
import { land, readState, resetEntity, stashSavedStep } from './onboardingApi';
import { ONBOARDING_API_URL } from './urls';
import { installXeroFake } from './xeroFake';

let creds: Credentials;

test.beforeEach(async () => {
  creds = requireCredentials();
  test.skip(
    !(await reachable(`${ONBOARDING_API_URL}/api/onboarding/server-time`)),
    `The onboarding service is not answering on ${ONBOARDING_API_URL}`,
  );
});

const saveNext = (page: Page) => page.getByRole('button', { name: /Save & Next/ });
const activeTile = (page: Page) => page.locator('.step.active');

/** The card on a petty cash step whose title is `title`, e.g. "Deposit Bank Account". */
const card = (page: Page, title: string) =>
  page.locator('.pc-card', { has: page.locator('.pc-title', { hasText: title }) });
const select = (page: Page, title: string) => card(page, title).locator('input.mselect-input');

test('walks from Connect to All Set and finalizes the disposable entity', async ({
  page,
  request,
}) => {
  // Six screens, a reload in the middle, and two real round-trips at the end.
  test.setTimeout(120_000);

  const originalStep = await stashSavedStep(request, creds);
  await resetEntity(request, creds, originalStep);
  const fake = await installXeroFake(page);

  try {
    // --- 4. Connect ---
    await land(page, request, creds, 4);
    // The click must actually leave for /xero_connect; a wizard with no entity id fakes
    // the connection locally, and that would walk the rest of this in prototype mode.
    await Promise.all([
      page.waitForRequest((r) => new URL(r.url()).pathname === '/xero_connect'),
      page.getByRole('button', { name: 'Connect to Xero' }).click(),
    ]);
    await expect(page.locator('.status-card .pill-status')).toHaveText('Connected');
    await saveNext(page).click();

    // --- 5. Sales ---
    await expect(activeTile(page)).toHaveAttribute('data-step-key', '5');
    await expect(
      page.getByRole('heading', { name: 'Type of sales method of your company' }),
    ).toBeVisible();
    // A previous run's balance is rehydrated from the draft, and focusing the field
    // re-renders it from "100.00" to its edit string -- which collapses fill()'s
    // select-all if the two happen together. Focus first, then replace.
    const balance = page.locator('input[inputmode="decimal"][placeholder="0.00"]');
    await balance.click();
    await balance.fill('100');
    await expect(balance).toHaveValue('100');
    await saveNext(page).click();

    // --- 6. Account Code ---
    await expect(page.getByRole('heading', { name: 'Account Code Setting' })).toBeVisible();
    // Four of five pre-filled from the fixture's mapping_defaults...
    await expect(select(page, 'Petty Cash Account')).toHaveValue(LABELS.pettyCashBank);
    await expect(select(page, 'Deposit Bank Account')).toHaveValue(LABELS.depositBank);
    await expect(select(page, 'Director Personal Account')).toHaveValue(LABELS.director);
    await expect(select(page, 'Cash Sales')).toHaveValue(LABELS.cashSale);
    // ...and the one it left out blocks Save & Next until it is chosen.
    await expect(select(page, 'Discrepancy')).toHaveValue('');
    await saveNext(page).click();
    await expect(card(page, 'Discrepancy')).toHaveClass(/is-error/);
    await expect(card(page, 'Discrepancy')).toContainText("I'll need this one to keep going.");
    await select(page, 'Discrepancy').click();
    await page.locator('.mselect-menu [role="option"]', { hasText: LABELS.discrepancy }).click();
    await expect(select(page, 'Discrepancy')).toHaveValue(LABELS.discrepancy);
    await saveNext(page).click();

    // --- 7. Contacts ---
    await expect(page.getByRole('heading', { name: 'Contact Setup' })).toBeVisible();
    // The step sent ids, resolved from the labels it showed.
    expect(fake.posted['account-codes']).toEqual([
      {
        entity_id: creds.entityId,
        expense_codes: ['400', '404', '420'],
        mapping: {
          pettycash: IDS.pettyCashBank,
          deposit: IDS.depositBank,
          director: IDS.director,
          cash_sale: IDS.cashSale,
          discrepancy: IDS.discrepancy,
        },
      },
    ]);
    await expect(select(page, "Director's Contact")).toHaveValue(LABELS.directorContact);
    await expect(select(page, 'Cash Sales Contact')).toHaveValue(LABELS.cashSaleContact);
    await expect(select(page, 'Discrepancy Contact')).toHaveValue(LABELS.discrepancyContact);
    await saveNext(page).click();

    // --- 8. Payment Settings ---
    await expect(activeTile(page)).toHaveAttribute('data-step-key', '8');
    await expect(page.getByRole('heading', { name: 'Payment Settings' })).toBeVisible();
    expect(fake.posted['contacts']).toEqual([
      {
        entity_id: creds.entityId,
        contacts: {
          director: IDS.directorContact,
          cash_sale: IDS.cashSaleContact,
          discrepancy: IDS.discrepancyContact,
        },
      },
    ]);
    await expect(page.locator('.acc-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Complete' }).click();

    // --- 9. All Set ---
    await expect(activeTile(page)).toHaveAttribute('data-step-key', '9');
    await expect(page.locator('h2.allset-title')).toHaveText("You're all set!");
    expect(fake.posted['bill-codes']).toEqual([
      { entity_id: creds.entityId, selected_codes: ['300', '310', '469'] },
    ]);
    // The facts block waits on finalize AND the (faked) billing status; both in means
    // the commit has returned.
    await expect(page.locator('.allset-facts')).toBeVisible();
    if (subscriptionsDark()) {
      // the cutover state: the modules are on, no trial was started and no card is asked for
      await expect(page.locator('.allset-facts')).toContainText('is ready to use');
      await expect(page.locator('.allset-facts')).not.toContainText('trial');
      await expect(page.getByRole('button', { name: 'Add Payment Now' })).toHaveCount(0);
    } else {
      await expect(page.locator('.allset-facts')).toContainText('trial has started');
      await expect(page.getByRole('button', { name: 'Add Payment Now' })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Go to entity list' })).toBeEnabled();

    // And the row agrees: the real finalize ran.
    const after = await readState(request, creds);
    // entity_status is onboarding / connected / disconnected since C2: finalize leaves the
    // company `connected` when a Xero org is linked, `disconnected` otherwise (the walk fakes
    // the Xero round-trip, so either is a finished company; `onboarding` would be the failure)
    expect(['connected', 'disconnected'], 'finalize left the company onboarding').toContain(after.status);
    expect(after.saved_step).toBe(9);
    expect(Number(after.opening_balance?.opening_balance)).toBe(100);
  } finally {
    await resetEntity(request, creds, originalStep);
  }
});
