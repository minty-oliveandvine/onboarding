import { FLASK_BASE } from './flaskBase';

/**
 * The payer's saved cards, and consent to bill an entity — the wire half of "Buy now".
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
  if (!token) throw new BillingError('Your session expired. Please sign in again.', 401);

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
    throw new BillingError('Could not reach the server. Please try again.', 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Include the status when the body carried no error of its own: a non-JSON failure
    // (a CORS rejection, a proxy error page) is otherwise indistinguishable from the
    // server having answered with a reason.
    throw new BillingError(
      data.error || `Something went wrong (HTTP ${res.status}). Please try again.`,
      res.status,
    );
  }
  return data;
}

/**
 * `{has_payment_method, has_billing_consent}` for one entity.
 *
 * The two are independent and only the second decides anything here: the card belongs to
 * the payer and is shared across every entity they pay for, while consent is per
 * (entity, payer) and is what makes this entity's trial convert instead of lapse.
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
export function confirmCardSetup(token, setupIntent, makeDefault) {
  return call(token, '/api/onboarding/billing/payment-methods/confirm', {
    method: 'POST',
    body: { setup_intent: setupIntent, make_default: !!makeDefault },
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
