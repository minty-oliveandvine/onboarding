// The onboarding API contract, as the wizard reads it.
//
// These are the shapes that come back from `/api/onboarding/*` -- the Django service in
// ../onboarding-backend for the ported endpoints, Flask behind it for the proxied ones.
// Before this file every one of the 21 fetch sites read a bare `res.json()` and the
// component code was the only record of what it expected. Now the record is here, and
// the source of truth for the ported endpoints is the service's own return dicts
// (onboarding-backend/onboarding/services/state.py, plans.py, invites.py).
//
// TWO THINGS ARE DELIBERATELY NOT HERE
//
//   * `OpeningBalance.cash_addition`. The service still sends it, and it is always 0 --
//     the amount the user typed lives in `opening_balance`. OnboardingApp documents that
//     the field "must NOT be used"; leaving it out of the type is what makes the
//     compiler enforce that sentence.
//   * A thrown `ApiError` in the billing-frontend style. The wizard's submit functions
//     return `{ ok, error }` bags and its steps switch on them; changing that would be a
//     behaviour change, and this is a typing pass. See `Result`.

//  ── Modules ─────────────────────────────────────────────────────────

/** Backend spelling: `entity_function.function_code`. See lib/modules. */
export type ModuleCode = 'PETTY_CASH' | 'PAYMENT_REQUEST';

/** Frontend spelling: what the module picker and the step grouping key on. */
export type ModuleId = 'pettyCash' | 'bills';

//  ── GET /state ──────────────────────────────────────────────────────

export type EntityState = {
  name: string;
  /** ISO alpha-2 (`country_info` PK). */
  country: string;
  /** A `currency_info` uuid, sent back verbatim on save. */
  currency: string;
  /** Optional step-1 contact details -- ALWAYS present, `""` when unset. */
  phone: string;
  email: string;
};

export type XeroState = {
  connected: boolean;
  /** The tenant name, `""` when not connected. */
  org: string;
};

/** Mirrors the POST body of /sales-methods so resume round-trips with no translation. */
export type SalesMethods = {
  electronic: string[];
  delivery: string[];
};

/**
 * The earliest draft report's opening figures, or `null` when no draft exists yet.
 *
 * `cash_addition` is intentionally absent -- see the module header.
 */
export type OpeningBalance = {
  /** `YYYY-MM-DD`, or null. */
  opening_date: string | null;
  opening_balance: number;
  adjusted_opening_balance: number;
};

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

/** One pending invitation, the shape the invite cards render. */
export type Invitation = {
  id: string;
  email: string;
  role: string;
  status: InviteStatus | string;
  first_name: string;
  last_name: string;
  /** ISO timestamp, or null. */
  created_at: string | null;
};

/**
 * The full resume picture. Everything a cold browser needs to rebuild the wizard.
 *
 * THE TWO STEP NUMBERS ARE NOT THE SAME NUMBER. `saved_step` is the FRONTEND step id
 * stored verbatim from "Save and Exit"; `current_step` is the BACKEND's derived landing
 * step from a different ordering. The wizard resumes on `saved_step` and uses
 * `current_step` / `max_reached` only to raise the ceiling -- see deriveResumeStep.
 */
export type OnboardingState = {
  entity_id: string;
  status: 'onboarding' | 'active' | string;
  current_step: number;
  max_reached: number;
  /** null if the user never saved. */
  saved_step: number | null;
  entity: EntityState;
  modules: ModuleCode[];
  xero: XeroState;
  sales_methods: SalesMethods;
  opening_balance: OpeningBalance | null;
  /** Empty when the caller may not list invites -- a permission gap must not fail resume. */
  invites: Invitation[];
};

//  ── GET /plans ──────────────────────────────────────────────────────

export type Plan = {
  code: ModuleCode;
  name: string;
  /** Major units, e.g. 560 or 560.5. */
  amount: number;
  formatted_amount: string;
  currency_code: string;
  /** In practice the bare code ("HKD") -- `currency_info` carries no symbols. */
  currency_symbol: string;
  billing_interval: string;
};

export type PlanCatalog = {
  plans: Plan[];
  bundle_amount: number | null;
  bundle_codes: ModuleCode[];
  bundle_currency: string | null;
  trial_period_days: number;
};

//  ── GET /account-codes, GET /bill-codes ─────────────────────────────

/** A selectable account or contact. `label` is what the dropdowns show. */
export type AccountOption = {
  id: string;
  label: string;
};

/** A Xero account code. The list cards key on `code`, not `id`. */
export type CodeOption = {
  code: string;
  name?: string;
};

export type AccountCodesResponse = {
  connected: boolean;
  bank_accounts?: AccountOption[];
  cash_sale_accounts?: AccountOption[];
  director_accounts?: AccountOption[];
  discrepancy_accounts?: AccountOption[];
  expense_codes?: CodeOption[];
  contacts?: AccountOption[];
  /** Saved mapping, by role -> account id. */
  mapping_defaults?: Partial<
    Record<'pettycash' | 'deposit' | 'director' | 'cash_sale' | 'discrepancy', string>
  >;
  /** Saved contacts, by role -> contact id. */
  contact_defaults?: Partial<Record<'director' | 'cash_sale' | 'discrepancy', string>>;
  default_all?: boolean;
  selected_codes?: string[];
};

export type BillCodesResponse = {
  connected: boolean;
  bill_codes?: CodeOption[];
  default_all?: boolean;
  selected_codes?: string[];
};

//  ── Writes ──────────────────────────────────────────────────────────

/** POST /create, PUT /entity/:id. */
export type EntityPayload = {
  entity_name: string;
  country: string;
  currency: string;
  business_email: string;
  contact_phone: string;
};

export type CreateEntityResponse = {
  entity_id: string;
  name?: string;
};

export type InvitePayload = {
  email: string;
  role: string;
  first_name: string;
  last_name: string;
};

/**
 * POST /invite. `email_sent` lives in one of two places depending on which backend
 * answered, and the wizard reads both. Only an explicit `false` means the mail failed.
 */
export type InviteResponse =
  | { email_sent?: boolean; invitation: Invitation & { email_sent?: never } }
  | { email_sent?: never; invitation: Invitation & { email_sent?: boolean } };

export type FinalizeResponse = {
  /** ISO date, or absent when the trial could not be started. */
  trial_end?: string | null;
};

export type ServerTimeResponse = {
  /** `YYYY-MM-DD` on the service's clock, not the browser's. */
  today: string;
};

/** Every error body from the ported endpoints. The key is `error`, never ninja's `detail`. */
export type ApiErrorBody = {
  error?: string;
  message?: string;
  connected?: boolean;
};

//  ── The submit convention ───────────────────────────────────────────

/**
 * What every `submitX` in OnboardingApp returns and every step switches on.
 *
 * Kept as a returned bag rather than a thrown error because that is what the steps
 * already do with it -- `if (!result.ok) showToast(result.error)`. A discriminated
 * union means the compiler knows `error` exists exactly when `ok` is false.
 */
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** A create/update that can collide on a globally-unique name. */
export type EntityResult = Result | { ok: false; error: string; duplicate: true };

/** Creating a contact inline can fail because Xero is not connected. */
export type ContactResult =
  { ok: true; option: AccountOption } | { ok: false; error: string; notConnected?: boolean };

/** `invitation` is absent when the server answered without one; the step tolerates that. */
export type InviteResult = Result<{ invitation?: Invitation | InvitePayload; emailSent?: boolean }>;

export type FinalizeResult = Result<{ trialEnd: string | null }>;
