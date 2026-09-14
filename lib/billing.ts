import type { ApiErrorBody } from './api';
import { urlFor } from './apiRoutes';
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
 *
 * THREE WRAPPERS WERE REMOVED RATHER THAN LEFT UNUSED, and the routes behind all three are
 * still live if any is wanted back:
 *
 *   - `fetchPaymentMethods` — `/billing/payment-methods`. Superseded by
 *     `fetchBillingAccounts`, which returns the same flat wallet plus the accounts, so the
 *     picker can name the company a card invoices without a second round trip.
 *   - `createBillingAccount` — `POST /billing/accounts`. Opens a second account on a card
 *     the payer already holds. Nothing in onboarding does that: `confirmCardSetup` opens
 *     the account in the same request that saves the card.
 *   - `setDefaultPaymentMethod` — `/billing/payment-methods/default`. Deliberately
 *     unreachable: promoting a card is the payer portal's job, and this sheet names the
 *     card it wants on `authorizeBilling` instead, which moves one company rather than all
 *     of them.
 */

// Routed through `urlFor`, not pinned to Flask: these paths are in the onboarding
// service's table now. It answers them as proxies -- it holds no Stripe credentials
// and forwards the caller's own token -- so the card flow is unchanged, and the
// wizard talks to one base URL instead of two.

//  ── Shapes ──────────────────────────────────────────────────────────

/** A saved card as Minty describes it for display. Fields past `id` are presentational. */
export type PaymentMethod = {
  id: string;
  brand?: string;
  brand_label?: string;
  last4?: string;
  expiry?: string;
  expired?: boolean;
  expires_soon?: boolean;
  wallet_label?: string;
  label?: string;
  /** Card art, when Minty has one for the brand. */
  art?: string;
  png?: string;
};

export type BillingStatus = {
  has_payment_method: boolean;
  has_billing_consent: boolean;
  /** THIS ENTITY'S nominated card, or null -- not the payer's default. */
  card: PaymentMethod | null;
};

export type CardSetup = {
  client_secret: string;
  publishable_key: string;
  setup_intent: string;
};

export type BillingAccount = {
  id: string;
  billing_email: string | null;
  billing_company: string | null;
  /** The card this account charges. */
  default_id: string | null;
  cards: PaymentMethod[];
};

export type BillingAccountsResponse = {
  accounts: BillingAccount[];
  methods: PaymentMethod[];
  /** The payer's default card across the whole wallet -- a suggestion, not this entity's nomination. */
  default_id?: string | null;
};

/** Which billing account a confirmed card goes on. Every field optional -- see confirmCardSetup. */
export type BillingAccountChoice = {
  billingGroupId?: string | null;
  email?: string | null;
  company?: string | null;
};

//  ── Calls ───────────────────────────────────────────────────────────

/** An error whose `message` is safe to show the payer as written. */
export class BillingError extends Error {
  /** HTTP status, or 0 when the server was never reached. */
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
  }
}

type CallOptions = { method?: string; body?: Record<string, unknown> };

async function call<T>(
  token: string | null | undefined,
  path: string,
  { method = 'GET', body }: CallOptions = {},
): Promise<T> {
  if (!token) throw new BillingError('Your session expired. Sign in again to keep going.', 401);

  let res: Response;
  try {
    res = await fetch(urlFor(path), {
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

  const data = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
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
export function fetchBillingStatus(
  token: string | null | undefined,
  entityId: string,
): Promise<BillingStatus> {
  return call<BillingStatus>(
    token,
    `/api/onboarding/payment-method?entity_id=${encodeURIComponent(entityId)}`,
  );
}

/** `{client_secret, publishable_key, setup_intent}` for mounting Stripe Elements. */
export function startCardSetup(token: string | null | undefined): Promise<CardSetup> {
  return call<CardSetup>(token, '/api/onboarding/billing/payment-methods/setup-intent', {
    method: 'POST',
  });
}

/**
 * Tell Minty about the card the browser just confirmed. Returns the fresh list.
 *
 * Not optional and not cosmetic: for a payer's first card this is the call that creates
 * the Stripe customer and attaches the method. Skipped, the card is saved to nothing.
 */
export function confirmCardSetup(
  token: string | null | undefined,
  setupIntent: string,
  makeDefault: boolean,
  account?: BillingAccountChoice | null,
): Promise<BillingAccountsResponse> {
  return call<BillingAccountsResponse>(token, '/api/onboarding/billing/payment-methods/confirm', {
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
 * chooses between ACCOUNTS rather than between loose cards: "the payer's cards" and "the
 * cards on this account" are different questions, and the dialog asks both. This replaced
 * the flat `fetchPaymentMethods` wrapper, which is why that one is gone (see the header).
 */
export function fetchBillingAccounts(
  token: string | null | undefined,
): Promise<BillingAccountsResponse> {
  return call<BillingAccountsResponse>(token, '/api/onboarding/billing/accounts');
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
export function authorizeBilling(
  token: string | null | undefined,
  entityId: string,
  paymentMethod?: string | null,
): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>(token, '/api/onboarding/billing/authorize', {
    method: 'POST',
    body: paymentMethod
      ? { entity_id: entityId, payment_method: paymentMethod }
      : { entity_id: entityId },
  });
}
