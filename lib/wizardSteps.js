// The wizard's step model: the step table, which steps the chosen modules make active, how
// far the saved data justifies resuming, and the empty state a new wizard starts from.
// Extracted verbatim from OnboardingApp -- no behaviour changed.
//
// THIS ORDERING IS THE FRONTEND'S, AND IT IS NOT THE BACKEND'S. `deriveResumeStep` exists
// precisely because the two differ: the backend derives `current_step` from
// modules -> Xero -> petty-cash -> bills/invite, while the flow here is
// 1 Basic, 2 Module, 3 Invite, 4 Accounting. Trusting the backend's index directly once sent
// users straight to "Connect to Accounting" past an incomplete step, so `current_step` and
// `max_reached` are used only to raise the ceiling on steps already unlocked.

import { isEmail } from './validation';
import { toIsoDate } from './date';

// Derive the frontend step id to land on from a backend /state payload. The
// backend's own `current_step` is derived from a different ordering (modules →
// Xero → petty-cash → bills/invite) than the FE flow (1 Basic, 2 Module,
// 3 Invite, 4 Accounting/Xero, …), so we recompute against the FE order here
// instead of trusting it as a raw index. We resume the user on the LAST step
// they saved — the page they were on when they clicked "Save and Next" / "Save
// and Exit" — rather than the step after it.
//
// Backend contract: resume on the persisted `savedStep` (the FE step id the
// user was on when they hit Save and Next / Save and Exit).
//
// If savedStep > 4 but the DB says Xero isn't connected, we still LAND the user
// on their saved step but flag `needsXero` — the caller shows a pop-up nudging
// them back to step 4 "Connect to Accounting", since that connection gates every
// later step. (We used to silently force step 4; now the user keeps their place
// and is told why they must reconnect first.)
//
// `savedStep` may be null (never persisted — e.g. a session that predates this
// field, or that never reached a Save). In that case we have no recorded
// position, so we fall back to deriving one from the payload's own data
// (entity / modules / invites / xero.connected), which only judges steps 1–4.
//
// Returns { step, needsXero }.
export function deriveResumeStep(s, savedStep) {
  const xeroConnected = !!(s.xero && s.xero.connected);
  const saved = Number(savedStep);

  // Honour the backend's recorded step when present and in range.
  if (Number.isFinite(saved) && saved >= 1 && saved <= 9) {
    // Deeper than the accounting step requires a live Xero connection. Without
    // it, keep the user on their saved step but flag that Xero is needed so the
    // caller can prompt them back to step 4.
    if (saved > 4 && !xeroConnected) return { step: saved, needsXero: true };
    return { step: saved, needsXero: false };
  }

  // No persisted step → derive from the data we do have (steps 1–4 only).
  // "Saved" per step. Invite (3) is optional, so isStepComplete always passes
  // it — but for resume we only count it as saved when invites were actually
  // added, otherwise saving at Module Selection would skip the user onto Invite.
  const isSaved = (id) => {
    if (id === 3) return Array.isArray(s.invites) && s.invites.length > 0;
    return isStepComplete(id, s);
  };
  let lastSaved = 1; // Basic Info is always the entry point.
  for (const id of [1, 2, 3, 4]) {
    if (isSaved(id)) {
      lastSaved = id;
    } else if (id === 3) {
      // Invite is optional and skippable: an empty Invite doesn't end the flow,
      // so keep scanning — a later saved step (e.g. connected Xero) still wins.
      continue;
    } else {
      break; // a required step isn't saved → land on the last saved one.
    }
  }
  // The derived fallback only judges steps 1–4, so it can never land past the
  // Xero gate — no need to flag needsXero here.
  return { step: lastSaved, needsXero: false };
}

export const STEPS = [
  { id: 1, label: 'Basic Information' },
  { id: 2, label: 'Select Module' },
  { id: 3, label: 'User Invite' },
  { id: 4, label: 'Connect to Accounting System' },
  { id: 5, label: 'Sales Setting' },
  { id: 6, label: 'Account Code Setting' },
  { id: 7, label: 'Others' },
  { id: 8, label: 'Payment Settings' },
  { id: 9, label: 'All Set' },
];

// Display-only structure: collapses Sales (5) + Account Code (6) + Others (7)
// into a single "Petty Cash Settings" segment with sub-items. Petty Cash and
// Bill segments only appear when their respective modules are selected on step 2.
export function getDisplaySteps(modules) {
  const hasPetty = modules.includes('pettyCash');
  const hasBills = modules.includes('bills');
  const out = [
    { label: 'Basic Information', tiny: 'Basic', ids: [1] },
    { label: 'Select Module', tiny: 'Module', ids: [2] },
    { label: 'User Invite', tiny: 'Invite', ids: [3] },
    { label: 'Connect to Accounting System', tiny: 'Accounting', ids: [4] },
  ];
  if (hasPetty) {
    out.push({
      label: 'Petty Cash Settings',
      tiny: 'Petty Cash',
      ids: [5, 6, 7],
    });
  }
  if (hasBills) {
    out.push({ label: 'Payment Settings', tiny: 'Payment', ids: [8] });
  }
  out.push({ label: 'All Set', tiny: 'All Set', ids: [9] });
  return out;
}

// Flat list of step ids that are part of the active flow given the selected modules.
export function getActiveStepIds(modules) {
  const hasPetty = modules.includes('pettyCash');
  const hasBills = modules.includes('bills');
  const ids = [1, 2, 3, 4];
  if (hasPetty) ids.push(5, 6, 7);
  if (hasBills) ids.push(8);
  ids.push(9);
  return ids;
}

export const initialState = () => ({
  entity: {
    name: '',
    type: 'Private Limited',
    industry: 'Retail & E-commerce',
    country: 'Hong Kong',
    currency: 'Hong Kong Dollar',
    fyStart: 'Jan',
    phone: '',
    email: '',
  },
  modules: [],
  xero: { connected: false, org: '' },
  pettyCash: {
    float: 2000,
    claimLimit: 200,
    defaultAccount: '6420 · Office Supplies',
    requireReceipt: true,
    autoReplenish: false,
    notifyCustodian: true,
    electronicMethods: [],
    deliveryMethods: [],
    expenseCodes: { all: true, selected: {} },
    pcAccount: '',
    depositAccount: '',
    directorCode: '',
    cashSalesCode: '',
    discrepancyCode: '',
    directorContact: '',
    cashSaleContact: '',
    discrepancyContact: '',
    openingDate: toIsoDate(new Date()),
  },
  bills: {
    terms: 'Net 30',
    threshold: 5000,
    flow: 'Two-step',
    glAccount: '2100 · Accounts Payable',
    ocr: true,
    partial: true,
    dedupe: true,
  },
  invites: [],
});

// Validation rules for completion gate
export function isStepComplete(id, state) {
  switch (id) {
    case 1: {
      const e = state.entity;
      // Phone and email are optional — valid only if non-empty.
      const emailOk = e.email.trim() === '' || isEmail(e.email);
      const phoneDigits = e.phone.replace(/\D/g, '');
      const phoneOk = phoneDigits.length === 0 || (phoneDigits.length >= 8 && phoneDigits.length <= 11);
      return e.name.trim().length > 1 && phoneOk && emailOk;
    }
    case 2:
      return state.modules.length > 0;
    case 3:
      return true; // Invite is optional
    case 4:
      return !!(state.xero && state.xero.connected); // Accounting connection is required
    case 5: {
      const b = state.pettyCash && state.pettyCash.openingBalance;
      return b !== undefined && b !== null && String(b).trim() !== '';
    }
    case 6:
      return true;
    case 7:
      return true;
    case 8:
      return true;
    default:
      return false;
  }
}
