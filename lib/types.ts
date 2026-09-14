// The wizard's own vocabulary: the state it holds, and the props it hands each step.
//
// Nothing in this repo declared a `type` or `interface` before this file. The shapes
// below were recovered from `initialState()` in lib/wizardSteps, the `stepProps` bag in
// OnboardingApp, and every step's destructuring pattern in OnboardingSteps.
//
// THREE FIELDS ARE PHANTOMS, AND THEY ARE TYPED HONESTLY
//
// `entity.id`, `pettyCash.openingBalance` and `bills.billCodes` are read all over the
// wizard and are ABSENT from `initialState()` -- they are filled in later, by the
// create call, the Sales step and the bill-codes fetch respectively. They are `?` here
// rather than defaulted, because the completion gate for step 5 keys on
// `openingBalance` being unset (lib/__tests__/wizardSteps.test.ts pins that), and
// giving it a default would change which step a fresh wizard can pass. Every `!`
// added at a read site to silence the compiler is a place the code assumes something
// the state does not guarantee -- prefer a guard.

import type {
  AccountOption,
  CodeOption,
  ContactResult,
  EntityResult,
  FinalizeResult,
  InvitePayload,
  InviteResult,
  ModuleId,
  PlanCatalog,
  Result,
  SalesMethods,
} from './api';

//  ── Wizard state ────────────────────────────────────────────────────

export type EntityForm = {
  /** Set by the create call. Absent until then -- see the module header. */
  id?: string;
  name: string;
  type: string;
  industry: string;
  /** Display name until the country/currency registries resolve, then an id. */
  country: string;
  currency: string;
  fyStart: string;
  phone: string;
  email: string;
};

/**
 * Which codes are on, as a tri-state pretending to be a map.
 *
 *     { all: true,  selected: {} }            everything
 *     { all: true,  selected: { x: false } }  everything EXCEPT x
 *     { all: false, selected: { x: true } }   only x
 *
 * `selected` means the opposite thing depending on `all`; a code absent from it is ON
 * under all:true and OFF under all:false. components/steps/pettyCashFields owns the
 * reading and writing of this; nothing else should interpret it.
 */
export type CodeSelection = {
  all: boolean;
  selected: Record<string, boolean>;
};

export type PettyCashForm = {
  float: number;
  claimLimit: number;
  defaultAccount: string;
  requireReceipt: boolean;
  autoReplenish: boolean;
  notifyCustodian: boolean;
  electronicMethods: string[];
  deliveryMethods: string[];
  expenseCodes: CodeSelection;
  /** The five account mappings and three contacts hold LABELS, resolved to ids on save. */
  pcAccount: string;
  depositAccount: string;
  directorCode: string;
  cashSalesCode: string;
  discrepancyCode: string;
  directorContact: string;
  cashSaleContact: string;
  discrepancyContact: string;
  /** `YYYY-MM-DD` in the user's own timezone. */
  openingDate: string;
  /**
   * The starting cash in the drawer, as the user typed it. Absent until the Sales step
   * -- step 5 is incomplete while it is. Kept as a string so the input round-trips;
   * normalised to 2dp only in the request body.
   */
  openingBalance?: string | number;
};

export type BillsForm = {
  terms: string;
  threshold: number;
  flow: string;
  glAccount: string;
  ocr: boolean;
  partial: boolean;
  dedupe: boolean;
  /** Filled by the bill-codes fetch on step 8. Absent before. */
  billCodes?: CodeSelection;
};

export type XeroForm = {
  connected: boolean;
  org: string;
  /** Display date ("12 JUN 2026"), set on connect. Absent until then. */
  lastConnected?: string;
};

/**
 * An invitation as the wizard's own list holds it -- `first` / `last`, not the API's
 * `first_name` / `last_name`.
 *
 * KNOWN GAP, deliberately not fixed in the typing pass: on a cold resume the raw API
 * rows are written into `invites` unconverted (OnboardingApp `resumeFromServer`), so
 * `first` and `last` are absent and the invite cards show an email with no name until
 * the list is re-fetched. Both name fields are optional here because that is the truth.
 */
export type InviteRow = {
  id?: string;
  email: string;
  role: string;
  first?: string;
  last?: string;
};

/** Everything the wizard remembers. `initialState()` in lib/wizardSteps builds it. */
export type WizardState = {
  entity: EntityForm;
  modules: ModuleId[];
  xero: XeroForm;
  pettyCash: PettyCashForm;
  bills: BillsForm;
  invites: InviteRow[];
};

/** Frontend step ids. 9 is "All Set", which has no gate of its own. */
export type StepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** One tile in the stepper. A group (Petty Cash = 5,6,7) is one tile with several ids. */
export type DisplayStep = {
  label: string;
  tiny: string;
  ids: number[];
};

/** Where a resume lands, and whether it landed past the Xero gate without Xero. */
export type ResumeDecision = {
  step: number;
  needsXero: boolean;
};

/** The six parallel option lists from /account-codes and /bill-codes. */
export type AccountOptions = {
  bank: AccountOption[];
  cashSale: AccountOption[];
  director: AccountOption[];
  discrepancy: AccountOption[];
  expense: CodeOption[];
  contacts: AccountOption[];
  bill: CodeOption[];
};

/** The signed-in user, as the top bar shows it. */
export type WizardUser = {
  first: string;
  last: string;
  name: string;
};

//  ── Step props ──────────────────────────────────────────────────────

/**
 * Merge a patch into the wizard state. The functional form receives the LATEST state,
 * for writers that fire from an effect and must not replay the render they closed over
 * -- the cold resume can land between that render and the effect.
 */
export type SetState = (
  patch: Partial<WizardState> | ((prev: WizardState) => Partial<WizardState>),
) => void;

/** A step's own save, handed to Save & Exit so it can persist before leaving. */
export type SubmitFn = () => Promise<Result | EntityResult | null | undefined>;

/**
 * The bag OnboardingApp builds once and spreads into every step.
 *
 * No step takes more than ten of these. Each step declares `Pick<StepProps, ...>` for
 * the ones it reads, and the spread still type-checks because excess-property checks
 * do not apply to spreads -- which is exactly why the bag can stay one object.
 */
export type StepProps = {
  state: WizardState;
  set: SetState;
  next: () => void;
  back: () => void;
  token: string;
  isLastContentStep: boolean;
  modulePlans: PlanCatalog | null;
  accountOptions: AccountOptions;

  submitEntity: () => Promise<EntityResult>;
  submitModule: () => Promise<Result>;
  submitSalesMethods: () => Promise<Result>;
  submitOpeningBalance: () => Promise<Result>;
  fetchExistingSalesMethods: () => Promise<SalesMethods | null>;
  submitAccountCodes: () => Promise<Result>;
  submitContacts: () => Promise<Result>;
  createContact: (name: string) => Promise<ContactResult>;
  submitBills: () => Promise<Result>;
  submitInvite: (invite: InvitePayload) => Promise<InviteResult>;
  cancelInvite: (invitationId: string) => Promise<Result>;
  completeOnboarding: () => Promise<FinalizeResult | Result>;

  connectXero: () => void;
  disconnectXero: () => Promise<Result>;
  /** Non-empty when Xero came back connected to a different org than expected. */
  xeroMismatch: string;
  clearXeroMismatch: () => void;
  /** Non-empty when the Xero org is already connected to another entity. */
  xeroConflict: string;
  clearXeroConflict: () => void;

  exitToEntityList: () => void;
  saveAndExit: (submitFn?: SubmitFn) => Promise<void>;
};
