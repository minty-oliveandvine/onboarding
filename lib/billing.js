import { FLASK_BASE } from './flaskBase';
import { errorCopy, HOUSE_FALLBACK } from './errorCopy';

/**
 * The payer's saved cards, and consent to bill an entity — the wire half of the billing sheet.
 *
 * These hit `/api/onboarding/billing/*` on Minty, which are thin mirrors of the payer
 * portal's `/api/me/billing/payment-methods*`. Same service code underneath; they exist
 * separately because the portal's routes send `Access-Control-Allow-Origin:
 * FRONTEND_APP_URL`, so calling them from this origin is blocked by the browser before
 * the bearer token is ever looked at. Do not "simplify" this to the /api/me routes.
 *
 * Every call carries the onboarding JWT the wizard already holds. There is no cookie
 * involved, so no `credentials: 'include'`.
 */

const base = () => FLASK_BASE.replace(/\/$/, '');

/** An error whose `message` is safe to show the payer as written. */
export class BillingError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
  }
}

async function call(token, path, { method = 'GET', body } = {}) {
  if (!token) throw new BillingError('Your session expired. Sign in again to keep going.', 401);

  let res;
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new BillingError("I couldn't reach the server. Mind trying again?", 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The status used to be shown so a CORS/proxy failure could be told apart
    // from a real server reason. That distinction is for the log, not the payer.
    console.warn('billing call failed', path, res.status);
    throw new BillingError(errorCopy(data.error, HOUSE_FALLBACK), res.status);
  }
  return data;
}

/**
 * `{has_payment_method, has_billing_consent, card}` for one entity.
 *
 * The first two are independent and only the second decides anything here: a card belongs
 * to the payer and is shared across every entity they pay for, while consent is per
 * (entity, payer) and is what makes this entity's trial convert instead of lapse.
 *
 * `card` is THIS ENTITY'S nominated card or null — not the payer's default. Anything
 * printing "we will bill you on this" must use it, and must still check
 * `has_billing_consent` before printing anything at all: a nomination without consent is
 * a card the payer has not agreed to be billed on.
 */
export function fetchBillingStatus(token, entityId) {
  return call(
    token,
    `/api/onboarding/payment-method?entity_id=${encodeURIComponent(entityId)}`,
  );
}

/** `{has_account, default_id, methods[], total}` — every card on the payer's account. */
export function fetchPaymentMethods(token) {
  return call(token, '/api/onboarding/billing/payment-methods');
}

/** `{client_secret, publishable_key, setup_intent}` for mounting Stripe Elements. */
export function startCardSetup(token) {
  return call(token, '/api/onboarding/billing/payment-methods/setup-intent', {
    method: 'POST',
  });
}

/**
 * Tell Minty about the card the browser just confirmed. Returns the fresh list.
 *
 * Not optional and not cosmetic: for a payer's first card this is the call that creates
 * the Stripe customer and attaches the method. Skipped, the card is saved to nothing.
 */
export function confirmCardSetup(token, setupIntent, makeDefault, account) {
  return call(token, '/api/onboarding/billing/payment-methods/confirm', {
    method: 'POST',
    body: {
      setup_intent: setupIntent,
      make_default: !!makeDefault,
      // The billing account, and every field of it is optional. `billingGroupId` puts the
      // card on an account the payer already has; an email or a company without one OPENS
      // an account named that way, which is the "New billing account" form's whole job.
      // Passing nothing keeps the pre-accounts behaviour: the card is saved, and that is
      // all that happens.
      //
      // PASS THE ID BACK ON A RETRY. Two accounts on one card are legal, so Minty cannot
      // tell a retried request from a deliberate second account — naming the one you got
      // is what makes this call safe to repeat.
      ...(account?.billingGroupId ? { billing_group_id: account.billingGroupId } : {}),
      ...(account?.email != null ? { billing_email: account.email } : {}),
      ...(account?.company != null ? { billing_company: account.company } : {}),
    },
  });
}

/**
 * `{accounts: [{id, billing_email, billing_company, default_id, cards[]}], methods[]}`.
 *
 * A billing account is a name, the cards on it, and the one card it charges. The picker
 * chooses between ACCOUNTS rather than between loose cards, which is why this exists
 * beside `fetchPaymentMethods` rather than replacing it — "the payer's cards" and "the
 * cards on this account" are different questions and the dialog asks both.
 */
export function fetchBillingAccounts(token) {
  return call(token, '/api/onboarding/billing/accounts');
}

/**
 * Open a billing account on a card the payer ALREADY has saved.
 *
 * Not the onboarding path: `confirmCardSetup` opens the account in the same request that
 * saves the card, so a first-time payer never reaches this. This is for a second account
 * on a familiar card — one company each, separate invoices.
 *
 * It takes no card details and cannot: the number only ever exists inside Stripe
 * Elements. Opening an account AUTHORISES NOTHING; billing an entity still needs that
 * entity's own consent via `authorizeBilling`.
 */
export function createBillingAccount(token, paymentMethod, { email, company } = {}) {
  return call(token, '/api/onboarding/billing/accounts', {
    method: 'POST',
    body: {
      payment_method: paymentMethod,
      ...(email != null ? { billing_email: email } : {}),
      ...(company != null ? { billing_company: company } : {}),
    },
  });
}

/**
 * Make one saved card the one future invoices are charged against.
 *
 * NOT CALLED FROM THIS APP ANY MORE, and should not be called again. The account default
 * is account-wide — one payer, one Stripe customer, one default — so setting it from a
 * sheet that is confirming ONE entity re-points every other entity that payer owns.
 * Onboarding now names the card it wants on `authorizeBilling` instead, which nominates
 * that one company and moves nothing else. Promoting a card is the payer portal's job:
 * Billing → the card's menu → "Make default".
 */
export function setDefaultPaymentMethod(token, paymentMethod) {
  return call(token, '/api/onboarding/billing/payment-methods/default', {
    method: 'POST',
    body: { payment_method: paymentMethod },
  });
}

/**
 * Record consent to bill this entity. Charges nothing, now or at any point in the trial.
 *
 * What it changes is the END of the trial: the trial-end job converts to paid only when
 * the payer has both a card and this consent, and lets the trial lapse otherwise.
 *
 * `paymentMethod` NAMES THE CARD THIS ENTITY GOES ON, and is what lets the sheet stop
 * setting the account default to get the same result. Minty nominates it before recording
 * the consent, so consent is never written against a card the payer was not shown.
 * Omitted, Minty falls back to the payer's default — the old behaviour, kept as a backstop.
 */
export function authorizeBilling(token, entityId, paymentMethod) {
  return call(token, '/api/onboarding/billing/authorize', {
    method: 'POST',
    body: paymentMethod
      ? { entity_id: entityId, payment_method: paymentMethod }
      : { entity_id: entityId },
  });
}
