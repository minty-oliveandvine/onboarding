'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import Icon from './Icon';
import { friendlyError } from '../lib/errorCopy';
import NavMenu from './NavMenu';
import {
  StepCreateEntity,
  StepSelectModule,
  StepConnectXero,
  StepSalesSetting,
  StepAccountCode,
  StepOthers,
  StepBills,
  StepInvite,
  StepAllSet,
} from './OnboardingSteps';
import { toAmountString } from '@/lib/amount';
import { formatToday } from '@/lib/date';
import { urlFor } from '../lib/apiRoutes';

// Baked-in defaults that used to live in TWEAK_DEFAULTS (tweaks-panel removed from prod build)
const ACCENT_DEFAULTS = {
  accent: '#36c3b4',
  accentInk: '#0f7a6e',
  accentSoft: '#e6f7f4',
};

// Scoped only to the Xero OAuth round-trip: we stash progress here right
// before leaving for Xero and restore it on return. Cleared immediately after,
// so it does NOT persist across an ordinary refresh.
const XERO_RESUME_KEY = 'minty_onboarding_xero_resume';

const STORAGE_KEY = 'minty_onboarding_session';

// Session storage is keyed per entity so multiple in-progress entities don't
// clobber each other. Before an entity is created it has no id yet, so its
// draft lives under the bare global key; once `submitEntity` assigns an id,
// writes move to `minty_onboarding_session:<id>` and the bare draft is cleared.
const sessionKey = (entityId) => (entityId ? `${STORAGE_KEY}:${entityId}` : STORAGE_KEY);

// On a plain refresh the URL carries no entity_id, so we can't look up the
// per-entity session key directly. Scan localStorage for every
// `minty_onboarding_session:<id>` blob and return the most recently saved one
// (by `savedAt`). This is what makes an ordinary refresh restore progress
// instead of resetting to the empty initial state.
const findLatestSession = () => {
  if (typeof window === 'undefined') return null;
  let best = null;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(`${STORAGE_KEY}:`)) continue;
      let blob = null;
      try {
        blob = JSON.parse(window.localStorage.getItem(key) || 'null');
      } catch {
        continue;
      }
      if (!blob || !blob.state) continue;
      const ts = typeof blob.savedAt === 'number' ? blob.savedAt : 0;
      if (!best || ts > best.savedAt) best = { ...blob, savedAt: ts };
    }
  } catch {
    return null;
  }
  return best;
};

// No signature verification — client-side cache invalidation only.
function readJwtClaims(token) {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (padded.length % 4)) % 4);
    const payload = JSON.parse(atob(padded + padding));
    return { user_id: payload.user_id || null, exp: payload.exp || 0 };
  } catch {
    return null;
  }
}

// Backend module codes → frontend module ids (inverse of FE_TO_BACKEND_MODULE).
const BACKEND_TO_FE_MODULE = { PETTY_CASH: 'pettyCash', BILL: 'bills' };

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
function deriveResumeStep(s, savedStep) {
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

const STEPS = [
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
function getDisplaySteps(modules) {
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
function getActiveStepIds(modules) {
  const hasPetty = modules.includes('pettyCash');
  const hasBills = modules.includes('bills');
  const ids = [1, 2, 3, 4];
  if (hasPetty) ids.push(5, 6, 7);
  if (hasBills) ids.push(8);
  ids.push(9);
  return ids;
}

const initialState = () => ({
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
    openingDate: (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })(),
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
function isStepComplete(id, state) {
  switch (id) {
    case 1: {
      const e = state.entity;
      // Phone and email are optional — valid only if non-empty.
      const emailOk = e.email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email);
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

function Stepper({ current, onClick, maxReached, displaySteps }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const check = () => {
      ref.current.querySelectorAll('.step .label').forEach((label) => {
        if (getComputedStyle(label).display === 'none') return;
        const inner = label.querySelector('.label-inner');
        if (!inner) return;
        const overflow = inner.scrollWidth - label.clientWidth;
        if (overflow > 1) {
          label.classList.add('is-overflow');
          inner.style.setProperty('--scroll-end', -overflow - 8 + 'px');
        } else {
          label.classList.remove('is-overflow');
          inner.style.removeProperty('--scroll-end');
        }
      });
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(ref.current);
    window.addEventListener('resize', check);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [current, maxReached]);

  return (
    <div className="stepper" ref={ref} data-screen-label="Stepper" style={{ '--step-count': displaySteps.length }}>
      {displaySteps.map((d) => {
        const isActive = d.ids.includes(current);
        const isDone = d.ids.every((i) => current > i);
        const status = isDone ? 'done' : isActive ? 'active' : 'todo';
        const firstId = d.ids[0];
        const reachable = firstId <= maxReached;
        // Once on "All Set" (9), onboarding is finished — no step is clickable
        // anymore, but completed steps keep their "done" look (not the lock).
        const clickable = reachable && current !== 9;
        // For a grouped tile (e.g. Petty Cash = steps 5,6,7), land on the
        // sub-step the user was actually on rather than always the first: the
        // current sub-step if we're inside the group, otherwise the furthest
        // reached sub-step (clamped to the group), falling back to firstId.
        const targetId = d.ids.includes(current)
          ? current
          : (d.ids.filter((i) => i <= maxReached).pop() ?? firstId);
        return (
          <div
            key={d.ids[0]}
            data-step-key={d.ids[0]}
            className={'step ' + status + (reachable ? '' : ' locked') + (clickable ? '' : ' not-clickable')}
            onClick={() => clickable && onClick(targetId)}
            title={reachable ? undefined : 'Complete the previous steps first'}
          >
            {(isDone || !reachable) && <span className="num">{isDone ? <Icon.Check /> : <Icon.Lock />}</span>}
            <span className="label label-full">
              <span className="label-inner">{d.label}</span>
            </span>
            <span className="label label-tiny">
              <span className="label-inner">{d.tiny}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function OnboardingApp() {
  const [current, setCurrent] = useState(1);
  const [state, setState] = useState(initialState);
  const [maxReached, setMaxReached] = useState(1);
  // Logged-in user, passed in by Module 1 on the launch URL after entity creation
  // (e.g. /?first=Dan&last=Smith or /?name=Dan%20Smith). No backend call needed.
  const [user, setUser] = useState({ first: '', last: '', name: '' });
  // Short-lived JWT from Module 1 used to create the entity on Step 1.
  const [token, setToken] = useState('');
  // Module 2 profile handoff URL (no entity context) passed in by Module 1.
  const [profileUrl, setProfileUrl] = useState('');
  const [accountOptions, setAccountOptions] = useState({ bank: [], cashSale: [], director: [], discrepancy: [], expense: [], contacts: [], bill: [] });
  // Live module prices + bulk-discount unit from Stripe, for Step 2's subscription
  // summary. Stays null until loaded (and if the fetch fails), which hides the
  // summary rather than showing invented figures.
  const [modulePlans, setModulePlans] = useState(null);
  // Set on resume when the user landed past step 4 but Xero isn't connected in
  // the DB — drives the "connect to accounting first" pop-up.
  const [needsXeroPrompt, setNeedsXeroPrompt] = useState(false);
  // Why the needs-Xero pop-up is showing: 'not-connected' (the entity isn't
  // connected in the DB) or 'expired' (the /state re-check came back 401 — the
  // session lapsed, typically after ~30 min past step 4). Drives the modal copy.
  const [xeroPromptReason, setXeroPromptReason] = useState('not-connected');
  // Set when the Xero OAuth round-trip returns `xero=mismatch` — the user logged
  // in with a Xero account whose email differs from the onboarding initiator's,
  // so the backend refused to connect the entity. Holds the email they MUST use
  // (the initiator's, from the `expected` param) so the Accounting step can show
  // a specific "use the account for X" message. Empty string = no mismatch.
  const [xeroMismatch, setXeroMismatch] = useState('');
  // Set when the Xero OAuth round-trip returns `xero=conflict` — the chosen Xero
  // org is already linked to a different entity, so the backend refused to
  // connect this one. Holds that entity's name (from the `conflict_entity`
  // param) so the Accounting step can name what to disconnect first. Empty
  // string = no conflict.
  const [xeroConflict, setXeroConflict] = useState('');
  // Guard the portal for SSR — document.body isn't there during server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Module price catalog for Step 2's subscription summary. Fetched once the token
  // is in hand; it's entity-independent, so it doesn't wait on entity creation.
  // Failures are swallowed — `modulePlans` stays null and the summary is hidden, so
  // an unreachable Stripe never blocks the user from picking a module.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(urlFor(`/api/onboarding/plans`), { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.plans) && data.plans.length > 0) {
          setModulePlans(data);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  /* THIS USED TO HOLD `hasBillingConsent`, and it is gone on purpose.
   *
   * A `fetchBillingStatus` ran here on every wizard load, a `billingNonce` re-ran it after
   * a confirmation, and `onBillingConsent` flipped the flag optimistically — all so
   * step 2's Save & Next could decide whether to open the billing sheet. It stopped
   * deciding that when the card became optional, and the two screens that still care
   * (the subscription summary, and All Set's nudge) each read the status for themselves
   * against the entity they are describing.
   *
   * So this was a request per load answering a question nobody asked. Do not reinstate it
   * as shared state: consent is per (entity, payer), and a wizard-level flag is exactly
   * the shape that made the summary panel show a card for an entity that had never been
   * authorised.
   */

  const activeIds = useMemo(() => getActiveStepIds(state.modules), [state.modules]);
  const displaySteps = useMemo(() => getDisplaySteps(state.modules), [state.modules]);

  // Helper: find the next active step id after `c`, or stay if at end.
  const nextActiveId = (c) => {
    const i = activeIds.indexOf(c);
    if (i === -1 || i === activeIds.length - 1) return c;
    return activeIds[i + 1];
  };
  const prevActiveId = (c) => {
    const i = activeIds.indexOf(c);
    if (i <= 0) return c;
    return activeIds[i - 1];
  };

  const set = (patch) => setState((prev) => ({ ...prev, ...patch }));

  // Latest `state` mirrored into a ref for async flows (cold resume) that must
  // both write the state AND keep using the value they wrote. Reading it inside
  // a setState updater doesn't work: React only runs the updater synchronously
  // when the fiber has no other update pending (the eager-state bailout), so a
  // variable assigned in there is undefined whenever anything else queued first.
  // Writers that need this pair up `stateRef.current = next; setState(next);` so
  // the ref carries the update even before the render commits.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Persist the FE step the user is now on as the resume position. Written on
  // every advance (Save & Next) and on Save & Exit, so resume lands on the
  // furthest step reached — this is what lets the Xero gate fire its pop-up when
  // saved_step > 4 but Xero isn't connected. Best-effort: never block the UI.
  const persistSavedStep = (step) => {
    if (!token || !state.entity.id) return;
    try {
      fetch(urlFor(`/api/onboarding/saved-step`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id, saved_step: step }),
      }).catch(() => {});
    } catch {
      /* best-effort — ignore */
    }
  };

  const next = () => {
    if (!isStepComplete(current, state)) return;
    const n = nextActiveId(current);
    setCurrent(n);
    setMaxReached((m) => Math.max(m, n));
    persistSavedStep(n);
  };
  const back = () => setCurrent((c) => prevActiveId(c));
  const goto = (id) => {
    if (!activeIds.includes(id)) return;
    // Onboarding is finished on the "All Set" step (9) — lock the stepper so the
    // user can't jump back into earlier steps once they've reached it.
    if (current === 9) return;
    if (id > maxReached) return;
    // Block forward jumps from a step that isn't complete (e.g. sub-step "Account Code" from "Sales")
    if (id > current && !isStepComplete(current, state)) {
      window.dispatchEvent(new CustomEvent('onb-validation-blocked', { detail: { from: current, to: id } }));
      return;
    }
    setCurrent(id);
  };
  // If the user toggles a module off after reaching a step belonging to it,
  // snap back to a still-active step so we never sit on a hidden one.
  useEffect(() => {
    if (!activeIds.includes(current)) {
      // walk backwards to the closest still-active id
      let target = 1;
      for (let i = current - 1; i >= 1; i--) {
        if (activeIds.includes(i)) {
          target = i;
          break;
        }
      }
      setCurrent(target);
    }
    // Also clamp maxReached so we don't leave it pointing at a removed step
    if (!activeIds.includes(maxReached)) {
      let mt = 1;
      for (let i = maxReached; i >= 1; i--) {
        if (activeIds.includes(i)) {
          mt = i;
          break;
        }
      }
      setMaxReached(Math.max(mt, current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds.join(',')]);

  // Without this gate the persist effect fires on first mount with the empty
  // initialState and overwrites the saved session before the load effect can
  // read it (effects run in declaration order, but setState calls from inside
  // them don't take effect until the next render).
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hydratedRef.current) return;
    try {
      const key = sessionKey(state.entity.id);
      window.localStorage.setItem(
        key,
        JSON.stringify({ current, maxReached, state, token, profileUrl, user, savedAt: Date.now() }),
      );
      // Once an id exists, the pre-id draft under the bare key is obsolete —
      // drop it so it can't be replayed by a later fresh load.
      if (key !== STORAGE_KEY) window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota / serialization errors */
    }
  }, [current, maxReached, state, token, profileUrl, user]);

  // Cold resume: rehydrate the whole wizard from the backend `entities` row
  // (status='onboarding') instead of localStorage, so resume works in a fresh
  // browser / incognito / cleared storage / another device. The backend GET
  // /api/onboarding/state is authoritative; localStorage is a cache-only
  // fallback used if the fetch fails. `resumeToken` is the fresh JWT the resume
  // redirect minted; it authorizes calls for this entity_id (membership-checked).
  const resumeFromServer = async (entityId, resumeToken) => {
    let payload = null;
    try {
      const res = await fetch(
        urlFor(`/api/onboarding/state?entity_id=${encodeURIComponent(entityId)}`),
        { headers: { Authorization: `Bearer ${resumeToken}` } },
      );
      if (res.ok) payload = await res.json().catch(() => null);
      // 401/403/404 → fall through to localStorage fallback below.
    } catch {
      /* network error → fall back to localStorage */
    }

    if (payload && payload.entity_id) {
      const modules = (Array.isArray(payload.modules) ? payload.modules : [])
        .map((code) => BACKEND_TO_FE_MODULE[code])
        .filter(Boolean);
      // Build the FE-shaped state once so the wizard and the resume-step
      // derivation see exactly the same data (deriveResumeStep/isStepComplete
      // read the FE `state` shape, not the raw backend payload).
      // Rehydrate the petty-cash Sales Setting (step 5) from the backend so a
      // cold resume doesn't show it blank. `sales_methods.{electronic,delivery}`
      // mirror the POST /sales-methods payload. The beginning petty-cash amount
      // lives in the draft's `opening_balance.opening_balance` (the inner field);
      // `opening_balance.cash_addition` is now forced to 0 by the backend and
      // must NOT be used. `opening_balance` (the object) is null when no draft
      // exists yet.
      const sm = payload.sales_methods || {};
      const ob = payload.opening_balance || {};
      const obAmount = ob.opening_balance;
      // Built from `stateRef`, not from inside a setState updater: the updater
      // only runs synchronously when nothing else is queued on this component,
      // and the resume path queues setToken/setUser/entity-name first — so the
      // updater ran during the next render and everything below read an
      // undefined `nextState` ("Cannot read properties of undefined").
      // The ref is current by now: the awaited fetch lands in a later task than
      // the init effect, so its batched updates (incl. the URL entity_name) have
      // rendered and the mirror effect has run.
      const prev = stateRef.current;
      const nextState = {
        ...prev,
        entity: {
          ...prev.entity,
          id: payload.entity_id,
          // Keep FE display defaults when the server omits a field.
          ...(payload.entity?.name ? { name: payload.entity.name } : {}),
          ...(payload.entity?.country ? { country: payload.entity.country } : {}),
          ...(payload.entity?.currency ? { currency: payload.entity.currency } : {}),
          // Optional and legitimately empty, so key off presence rather than
          // truthiness — otherwise a cleared phone/email would never rehydrate.
          ...(payload.entity?.phone !== undefined ? { phone: payload.entity.phone } : {}),
          ...(payload.entity?.email !== undefined ? { email: payload.entity.email } : {}),
        },
        modules,
        xero: payload.xero?.connected
          ? { connected: true, org: payload.xero.org || prev.xero.org }
          : prev.xero,
        invites: Array.isArray(payload.invites) ? payload.invites : prev.invites,
        pettyCash: {
          ...prev.pettyCash,
          ...(Array.isArray(sm.electronic) ? { electronicMethods: sm.electronic } : {}),
          ...(Array.isArray(sm.delivery) ? { deliveryMethods: sm.delivery } : {}),
          ...(ob.opening_date ? { openingDate: ob.opening_date } : {}),
          ...(obAmount !== undefined && obAmount !== null ? { openingBalance: String(obAmount) } : {}),
        },
      };
      stateRef.current = nextState;
      setState(nextState);
      // Seed the "last persisted" snapshot from the resumed entity so a revisit
      // to Step 1 that changes nothing stays a no-op (no needless PUT). Uses the
      // same fields nextState landed on, falling back to FE display defaults.
      // Normalized the same way submitEntity builds its payload, so the
      // unchanged-check compares like with like — otherwise every resumed
      // visit to Step 1 fired a pointless PUT on fields nobody touched.
      savedEntityRef.current = {
        entity_name: nextState.entity.name,
        country: nextState.entity.country,
        currency: nextState.entity.currency,
        business_email: (nextState.entity.email || '').trim(),
        contact_phone: (nextState.entity.phone || '').replace(/\D/g, ''),
      };
      // Land on the FE step the backend persisted (`payload.saved_step`), with
      // the Xero gate applied — deriveResumeStep handles the contract, including
      // the null-saved_step fallback. We do NOT use the backend's `current_step`
      // as a forward floor: its index space differs and a stale/higher value
      // would shove the user past an incomplete step (the bug where resume
      // jumped straight to "Connect to Accounting"). current_step/max_reached
      // only raise the ceiling so already-reached steps stay unlocked.
      const derived = deriveResumeStep(nextState, payload.saved_step);
      const landing = Math.max(derived.step, 1);
      const ceiling = Math.max(
        landing,
        Number(payload.current_step) || 0,
        Number(payload.max_reached) || 0,
      );
      setCurrent(landing);
      setMaxReached(ceiling);
      // Resumed past the Xero gate without a live connection — prompt the user
      // back to step 4 (they keep their place; the pop-up routes them).
      if (derived.needsXero) {
        setXeroPromptReason('not-connected');
        setNeedsXeroPrompt(true);
      }
      return;
    }

    // Fallback: server resume unavailable — try this entity's own cached
    // session (per-entity key). (Different/expired sessions are ignored.)
    try {
      const saved = JSON.parse(window.localStorage.getItem(sessionKey(entityId)) || 'null');
      if (saved && saved.state) {
        const sameEntity = saved.state.entity && saved.state.entity.id === entityId;
        if (sameEntity) {
          setState(saved.state);
          if (typeof saved.current === 'number' && saved.current >= 1) setCurrent(saved.current);
          if (typeof saved.maxReached === 'number' && saved.maxReached >= 1) setMaxReached(saved.maxReached);
        }
      }
    } catch {
      /* ignore corrupt storage */
    }
  };

  // Pick up the logged-in user (and optionally the new entity name) from the
  // launch URL that Module 1 opens after the entity is created. Falls back to
  // nothing if absent, so running the app standalone still works.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { hydrateOnce(); } finally { hydratedRef.current = true; }
    function hydrateOnce() {
    const p = new URLSearchParams(window.location.search);

    // Module 1 sends ?fresh=1 when the user clicks "+" (create new entity).
    // fresh and entity_id are mutually exclusive. Start clean: drop any saved
    // pre-id draft so we never resume the last in-progress entity. Per-entity
    // sessions (minty_onboarding_session:<id>) are left intact so other
    // in-progress entities keep their saved progress.
    const isFresh = p.get('fresh') === '1';
    if (isFresh) {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }

    // Returning from the real Xero OAuth round-trip (Module 1 → Xero → here).
    // Restore the progress we stashed before leaving and land on the
    // Accounting step (3). Cleared immediately so a later refresh won't resume.
    const xeroParam = (p.get('xero') || '').trim();
    if (xeroParam) {
      let resumed = null;
      try {
        resumed = JSON.parse(window.sessionStorage.getItem(XERO_RESUME_KEY) || 'null');
      } catch {
        /* ignore corrupt storage */
      }
      try {
        window.sessionStorage.removeItem(XERO_RESUME_KEY);
      } catch {
        /* ignore */
      }
      const today = formatToday();
      // The Xero tenant/org name reported back by Xero (real connected entity).
      const xeroOrg = (p.get('org') || '').trim();
      // Wrong-account block: the backend refused to connect because the Xero
      // login email didn't match the onboarding initiator. `expected` carries
      // the email the user must log in with (URL-encoded). Record it so the
      // Accounting step can message it; connection state stays false below.
      if (xeroParam === 'mismatch') {
        setXeroMismatch((p.get('expected') || '').trim() || 'unknown');
      } else {
        setXeroMismatch('');
      }
      // One-org-one-entity block: the org the user picked is already linked to
      // another entity. `conflict_entity` names it (URL-encoded; searchParams
      // decodes) so the step can say which one to disconnect first. It can be
      // absent in edge cases, so fall back to 'unknown' and render generic copy.
      if (xeroParam === 'conflict') {
        setXeroConflict((p.get('conflict_entity') || '').trim() || 'unknown');
      } else {
        setXeroConflict('');
      }
      // A blocked attempt (mismatch/conflict) leaves the entity unconnected
      // backend-side. Force disconnected rather than restoring the stashed
      // state, which would wrongly show "connected" for a user who was already
      // linked to one org and tried to switch to a conflicting one.
      const blocked = xeroParam === 'mismatch' || xeroParam === 'conflict';
      if (resumed) {
        if (resumed.token) setToken(resumed.token);
        if (resumed.profileUrl) setProfileUrl(resumed.profileUrl);
        if (resumed.user) setUser(resumed.user);
        setState((prev) => ({
          ...prev,
          ...(resumed.state || {}),
          xero:
            xeroParam === 'connected'
              ? { connected: true, org: xeroOrg, lastConnected: today }
              : blocked
                ? { ...((resumed.state && resumed.state.xero) || prev.xero), connected: false, org: '' }
                : (resumed.state && resumed.state.xero) || prev.xero,
        }));
        setMaxReached((m) => Math.max(m, resumed.maxReached || 4, 4));
      } else if (blocked) {
        setState((prev) => ({ ...prev, xero: { ...prev.xero, connected: false, org: '' } }));
      } else if (xeroParam === 'connected') {
        setState((prev) => ({
          ...prev,
          xero: { connected: true, org: xeroOrg, lastConnected: today },
        }));
      }
      setCurrent(4);
      setMaxReached((m) => Math.max(m, 4));
      // Strip the params so an ordinary refresh doesn't re-trigger the resume.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('xero');
        url.searchParams.delete('step');
        url.searchParams.delete('org');
        url.searchParams.delete('expected');
        url.searchParams.delete('conflict');
        url.searchParams.delete('conflict_entity');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      } catch {
        /* ignore */
      }
      return;
    }

    // Cold resume from the backend. The resume redirect carries both
    // entity_id and a fresh token. When present, the DB row is authoritative —
    // set identity from the URL synchronously, kick off the async server fetch,
    // and skip the localStorage path (resumeFromServer falls back to it on
    // failure). This is what makes resume survive empty localStorage.
    const resumeEntityId = (p.get('entity_id') || '').trim();
    const resumeUrlToken = (p.get('token') || '').trim();
    if (resumeEntityId && resumeUrlToken) {
      setToken(resumeUrlToken);
      const rFirst = (p.get('first') || '').trim();
      const rLast = (p.get('last') || '').trim();
      const rName = (p.get('name') || '').trim();
      if (rFirst || rLast || rName) {
        setUser({ first: rFirst, last: rLast, name: rName || `${rFirst} ${rLast}`.trim() });
      }
      const rEntityName = (p.get('entity_name') || p.get('entity') || '').trim();
      if (rEntityName) {
        setState((prev) => ({ ...prev, entity: { ...prev.entity, name: rEntityName } }));
      }
      // Not awaited — the init effect stays synchronous; setters land on the
      // next render. Strip resume params so a later refresh doesn't replay.
      resumeFromServer(resumeEntityId, resumeUrlToken);
      try {
        const url = new URL(window.location.href);
        ['entity_id', 'token', 'entity_name', 'entity', 'first', 'last', 'name', 'profile_url'].forEach((k) =>
          url.searchParams.delete(k),
        );
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      } catch {
        /* ignore */
      }
      return;
    }

    const urlToken = (p.get('token') || '').trim();
    // No URL entity_id reached here (the resume branch above returns early), so
    // this is the pre-id draft under the bare global key. On a fresh launch it
    // was just cleared, so `saved` will be null and we start clean.
    let saved = null;
    if (!isFresh) {
      try {
        saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      } catch {
        /* ignore corrupt storage */
      }
      // No pre-id draft under the bare key? Once an entity exists the session
      // moves to `minty_onboarding_session:<id>` (and the bare key is cleared),
      // so an ordinary refresh — which has no entity_id in the URL — must fall
      // back to the most recent per-entity session or it resets to zero.
      if (!saved) saved = findLatestSession();
    }
    if (saved) {
      const savedClaims = readJwtClaims(saved.token);
      const urlClaims = readJwtClaims(urlToken);
      const now = Math.floor(Date.now() / 1000);
      const savedExpired = !!(savedClaims && savedClaims.exp && savedClaims.exp <= now);
      const differentUser = !!(urlClaims && savedClaims && urlClaims.user_id !== savedClaims.user_id);
      // A launch URL that names an entity is an explicit "onboard THIS entity"
      // intent from Module 1. If the saved blob is for a different entity, it's
      // stale (e.g. a prior abandoned session) — discard it so the new entity
      // wins instead of replaying the old id/name and 403-ing on its modules.
      const urlEntityName = (p.get('entity_name') || p.get('entity') || '').trim();
      const savedEntityName = ((saved.state && saved.state.entity && saved.state.entity.name) || '').trim();
      const differentEntity = !!(urlEntityName && savedEntityName &&
        urlEntityName.toLowerCase() !== savedEntityName.toLowerCase());
      if (savedExpired || differentUser || differentEntity) {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      } else {
        if (urlToken) setToken(urlToken);
        else if (saved.token) setToken(saved.token);
        if (saved.profileUrl) setProfileUrl(saved.profileUrl);
        if (saved.user) setUser(saved.user);
        if (saved.state) setState(saved.state);
        if (typeof saved.current === 'number' && saved.current >= 1) setCurrent(saved.current);
        if (typeof saved.maxReached === 'number' && saved.maxReached >= 1) {
          setMaxReached(saved.maxReached);
        }
        return;
      }
    }

    const first = (p.get('first') || '').trim();
    const last = (p.get('last') || '').trim();
    const name = (p.get('name') || '').trim();
    if (first || last || name) {
      setUser({ first, last, name: name || `${first} ${last}`.trim() });
    }
    const entityName = (p.get('entity_name') || p.get('entity') || '').trim();
    if (entityName) {
      setState((prev) => ({ ...prev, entity: { ...prev.entity, name: entityName } }));
    }
    const t = (p.get('token') || '').trim();
    if (t) setToken(t);
    const pu = (p.get('profile_url') || '').trim();
    if (pu) setProfileUrl(pu);
    }
  }, []);

  // Kick off the real Xero OAuth flow (Step 3), mirroring Module 1's
  // "Connect to Xero". Stashes progress so the round-trip returns here at the
  // Accounting step. When run standalone (no entity created), it simulates a
  // connection so the prototype still works.
  const connectXero = () => {
    // Starting a fresh attempt clears any prior wrong-account banner so a retry
    // doesn't show a stale "use the account for X" message.
    setXeroMismatch('');
    const today = formatToday();
    if (!state.entity.id) {
      set({ xero: { connected: true, org: state.entity.name || 'Olive & Vine Inc', lastConnected: today } });
      return;
    }
    try {
      window.sessionStorage.setItem(
        XERO_RESUME_KEY,
        JSON.stringify({ state, token, profileUrl, user, maxReached }),
      );
    } catch {
      /* ignore quota / serialization errors */
    }
    // Pass the entity context so the backend resolves the exact entity on the
    // OAuth callback (it embeds this into the OAuth state). entity_id is the
    // preferred exact match; entity_name is the fallback. Passing neither falls
    // back to the user's latest in-progress entity — safe, but not exact.
    window.location.href =
      urlFor(`/xero_connect?from=onboarding`) +
      `&entity_id=${encodeURIComponent(state.entity.id)}` +
      `&entity_name=${encodeURIComponent(state.entity.name || '')}`;
  };

  // Disconnect Xero from the Accounting step. The entity stays in onboarding
  // (still resumable); the backend revokes on Xero's side and clears the token.
  // When run standalone (no entity/token), just flip local state so the
  // prototype still works.
  const disconnectXero = async () => {
    if (!token || !state.entity.id) {
      set({ xero: { ...state.xero, connected: false, org: '' } });
      return { ok: true };
    }
    try {
      const res = await fetch(urlFor(`/api/onboarding/xero/disconnect`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "I couldn't disconnect that. Mind trying again?") };
      set({ xero: { ...state.xero, connected: false, org: '' } });
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  // Re-validate the Xero connection against the backend (same DB-backed
  // GET /api/onboarding/state that resumeFromServer reads), but lightweight:
  // it reads ONLY xero.connected and reconciles that, without touching the
  // current step or other in-session state. Used on an ordinary refresh, where
  // we rehydrate from localStorage — which can carry a stale
  // `xero.connected: true` from before a *different* user (e.g. the invitee)
  // disconnected the entity from Xero on their own session. localStorage is
  // per-browser, so the inviter's cache never sees that revocation; only the
  // backend knows. Best-effort: a network/auth failure leaves the cached state
  // untouched so a transient blip can't wipe a real connection. Returns the
  // backend's connected boolean, the string 'expired' when the session token
  // was rejected (401 — the caller nudges the user to reconnect), or null if
  // unknown.
  const verifyXeroConnection = async () => {
    if (!token || !state.entity.id) return null;
    try {
      const res = await fetch(
        urlFor(`/api/onboarding/state?entity_id=${encodeURIComponent(state.entity.id)}`),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      // 401 → the session token lapsed (typically ~30 min past step 4). Surface
      // it distinctly so the caller can show the "reconnect" prompt rather than
      // silently swallowing it as a transient blip.
      if (res.status === 401) return 'expired';
      if (!res.ok) return null;
      const payload = await res.json().catch(() => null);
      if (!payload) return null;
      const connected = !!(payload.xero && payload.xero.connected);
      setState((prev) => {
        if (!!prev.xero.connected === connected) {
          // Still matches: only refresh the org label if the backend has one.
          return connected && payload.xero.org && payload.xero.org !== prev.xero.org
            ? { ...prev, xero: { ...prev.xero, org: payload.xero.org } }
            : prev;
        }
        // Connection state changed under us — reconcile to the backend.
        return connected
          ? { ...prev, xero: { ...prev.xero, connected: true, org: payload.xero.org || prev.xero.org } }
          : { ...prev, xero: { ...prev.xero, connected: false, org: '' } };
      });
      return connected;
    } catch {
      return null; // transient failure → keep cached state
    }
  };

  // Step 4 and every step after it depend on a live Xero connection, so each
  // time we land on a step 4+ we re-check the backend (localStorage can be
  // stale — see verifyXeroConnection). This catches a disconnect that happened
  // on a *different* session (e.g. the invitee revoked Xero) whether it landed
  // before this page loaded or while the user is mid-onboarding. If the
  // connection was revoked, the fn flips local state to "Not connected"; when
  // the user is *past* step 4 we also nudge them back via the existing
  // needs-Xero prompt (the same modal cold resume uses, see needsXeroPrompt).
  //
  // Kept cheap so per-landing re-checks don't drag: (1) an in-flight latch so
  // overlapping landings never fire a second concurrent /state fetch; (2) the
  // fetch is background-only — never awaited by render, so it can't block
  // paint; (3) verifyXeroConnection returns the SAME state object when nothing
  // changed, so the common "still connected" case triggers no re-render.
  const verifyingXeroRef = useRef(false);
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (current < 4) return;
    if (!token || !state.entity.id) return;
    if (verifyingXeroRef.current) return; // a check is already running
    verifyingXeroRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const connected = await verifyXeroConnection();
        if (cancelled) return;
        if (current > 4) {
          if (connected === 'expired') {
            // Session lapsed under us — nudge the user to reconnect.
            setXeroPromptReason('expired');
            setNeedsXeroPrompt(true);
          } else if (connected === false) {
            setXeroPromptReason('not-connected');
            setNeedsXeroPrompt(true);
          }
        }
      } finally {
        verifyingXeroRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, token, state.entity.id]);

  // Snapshot of the entity fields as they were last persisted to the backend,
  // so a revisit can tell whether the user actually changed anything (and skip
  // the network round-trip if not).
  const savedEntityRef = useRef(null);

  // Create the entity in Module 1 (Step 1), or update it in place when the user
  // goes back and edits an already-created entity. Token-authenticated; no
  // cookies. When launched standalone (no token), it no-ops so the prototype
  // still runs.
  const submitEntity = async () => {
    if (!token) return { ok: true }; // standalone / no Module 1 handoff
    const payload = {
      entity_name: state.entity.name,
      country: state.entity.country,
      currency: state.entity.currency,
      // Optional. Always sent, even when empty: the backend reads an empty
      // string as "clear this field", so a user who deletes their phone number
      // on revisit actually gets it removed.
      business_email: (state.entity.email || '').trim(),
      contact_phone: (state.entity.phone || '').replace(/\D/g, ''),
    };

    // --- Revisit: entity already exists, so this is an EDIT, not a create. ---
    if (state.entity.id) {
      // If nothing changed since the last persist, there's nothing to save —
      // keep the old no-op behaviour and just advance.
      const prev = savedEntityRef.current;
      const unchanged =
        prev &&
        prev.entity_name === payload.entity_name &&
        prev.country === payload.country &&
        prev.currency === payload.currency &&
        prev.business_email === payload.business_email &&
        prev.contact_phone === payload.contact_phone;
      if (unchanged) return { ok: true };

      try {
        // Revisiting Step 1 overwrites the entity in place via
        // PUT /api/onboarding/entity/{entity_id} (same fields as create) — it
        // never creates a new entity. Returns { entity_id, name } on success,
        // 409 on a name collision with a *different* entity. Accepts the same
        // field aliases as /create (entity_name|name, country|country_code,
        // currency|currency_code); we send the canonical names.
        const res = await fetch(urlFor(`/api/onboarding/entity/${encodeURIComponent(state.entity.id)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const backendMsg = friendlyError(
            data,
            "I couldn't save that company. Mind trying again?",
          );
          if (res.status === 409) {
            return {
              ok: false,
              duplicate: true,
              error: `Oh, “${state.entity.name.trim()}” is taken already! Do you have another name in mind?`,
            };
          }
          return { ok: false, error: backendMsg };
        }
        savedEntityRef.current = { ...payload };
        return { ok: true };
      } catch {
        return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
      }
    }

    // --- First time through: create the entity. ---
    try {
      const res = await fetch(urlFor(`/api/onboarding/create`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The backend returns 409 only for a name collision (uniqueness is
        // GLOBAL across all users — see /api/onboarding/create). Key off the
        // status, not the message: the body is {"error": "Entity name already
        // exist"} with no machine code, and the wording could change. A 400 is
        // a different validation failure (e.g. empty name), so pass it through.
        const backendMsg = friendlyError(
          data,
          "I couldn't create that company. Mind trying again?",
        );
        if (res.status === 409) {
          return {
            ok: false,
            duplicate: true,
            error: `Oh, “${state.entity.name.trim()}” is taken already! Do you have another name in mind?`,
          };
        }
        return { ok: false, error: backendMsg };
      }
      if (data.entity_id) {
        setState((prev) => ({ ...prev, entity: { ...prev.entity, id: data.entity_id } }));
      }
      savedEntityRef.current = { ...payload };
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const FE_TO_BACKEND_MODULE = { pettyCash: 'PETTY_CASH', bills: 'BILL' };
  const submitModule = async () => {
    if (!token || !state.entity.id) return { ok: true };
    const moduleCodes = (state.modules || [])
      .map((id) => FE_TO_BACKEND_MODULE[id])
      .filter(Boolean);
    if (moduleCodes.length === 0) return { ok: false, error: "I'll need at least one module to get started — which one sounds right?" };
    try {
      const res = await fetch(urlFor(`/api/onboarding/modules`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id, modules: moduleCodes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "Something went wrong on my end. Mind trying again?") };
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const submitSalesMethods = async () => {
    if (!token || !state.entity.id) return { ok: true };
    try {
      const res = await fetch(urlFor(`/api/onboarding/sales-methods`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          entity_id: state.entity.id,
          electronic: state.pettyCash.electronicMethods || [],
          delivery: state.pettyCash.deliveryMethods || [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "I couldn't save those. Mind trying again?") };
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const submitOpeningBalance = async () => {
    if (!token || !state.entity.id) return { ok: true };
    const p = state.pettyCash;
    const empty = p.openingBalance === undefined || p.openingBalance === null || String(p.openingBalance).trim() === '';
    if (empty) return { ok: true };
    try {
      const res = await fetch(urlFor(`/api/onboarding/opening-balance`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          entity_id: state.entity.id,
          opening_date: p.openingDate,
          // Beginning petty-cash amount lives in opening_balance now (cash_addition
          // is forced to 0 by the backend); send it here so save and resume agree.
          // Normalized to an exact 2dp decimal string so the payload doesn't depend
          // on whether the user blurred the field before saving.
          opening_balance: toAmountString(p.openingBalance),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "I couldn't save that opening balance. Mind trying again?") };
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const accountLoadedRef = useRef(false);
  useEffect(() => {
    if ((current !== 5 && current !== 6 && current !== 7) || accountLoadedRef.current) return;
    if (!token || !state.entity.id) return;
    accountLoadedRef.current = true;
    fetch(urlFor(`/api/onboarding/account-codes?entity_id=${encodeURIComponent(state.entity.id)}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.connected) return;
        const bank = data.bank_accounts || [];
        const cashSale = data.cash_sale_accounts || [];
        const director = data.director_accounts || [];
        const discrepancy = data.discrepancy_accounts || [];
        const expense = data.expense_codes || [];
        const contacts = data.contacts || [];
        setAccountOptions({ bank, cashSale, director, discrepancy, expense, contacts });

        const md = data.mapping_defaults || {};
        const cd = data.contact_defaults || {};
        const labelFor = (list, id) => {
          const found = id ? list.find((o) => o.id === id) : null;
          return found ? found.label : '';
        };
        let expenseCodesVal;
        if (data.default_all) {
          expenseCodesVal = { all: true, selected: {} };
        } else {
          const selMap = {};
          (data.selected_codes || []).forEach((c) => {
            selMap[c] = true;
          });
          expenseCodesVal = { all: false, selected: selMap };
        }
        setState((prev) => ({
          ...prev,
          pettyCash: {
            ...prev.pettyCash,
            expenseCodes: expenseCodesVal,
            pcAccount: prev.pettyCash.pcAccount || labelFor(bank, md.pettycash),
            depositAccount: prev.pettyCash.depositAccount || labelFor(bank, md.deposit),
            directorCode: prev.pettyCash.directorCode || labelFor(director, md.director),
            cashSalesCode: prev.pettyCash.cashSalesCode || labelFor(cashSale, md.cash_sale),
            discrepancyCode: prev.pettyCash.discrepancyCode || labelFor(discrepancy, md.discrepancy),
            directorContact: prev.pettyCash.directorContact || labelFor(contacts, cd.director),
            cashSaleContact: prev.pettyCash.cashSaleContact || labelFor(contacts, cd.cash_sale),
            discrepancyContact: prev.pettyCash.discrepancyContact || labelFor(contacts, cd.discrepancy),
          },
        }));
      })
      .catch(() => {
        /* leave the step empty if the fetch fails */
      });
  }, [current, token, state.entity.id]);

  const submitAccountCodes = async () => {
    if (!token || !state.entity.id) return { ok: true };
    const p = state.pettyCash;
    const idFor = (list, label) => {
      const found = label ? (list || []).find((o) => o.label === label) : null;
      return found ? found.id : '';
    };
    const mapping = {
      pettycash: idFor(accountOptions.bank, p.pcAccount),
      deposit: idFor(accountOptions.bank, p.depositAccount),
      director: idFor(accountOptions.director, p.directorCode),
      cash_sale: idFor(accountOptions.cashSale, p.cashSalesCode),
      discrepancy: idFor(accountOptions.discrepancy, p.discrepancyCode),
    };
    const allCodes = (accountOptions.expense || []).map((e) => e.code);
    const ec = p.expenseCodes || { all: true, selected: {} };
    const isAll = ec.all !== false;
    const sel = ec.selected || {};
    const selectedCodes = allCodes.filter((c) => (isAll ? sel[c] !== false : sel[c] === true));
    try {
      const res = await fetch(urlFor(`/api/onboarding/account-codes`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id, expense_codes: selectedCodes, mapping }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "I couldn't save those account codes. Mind trying again?") };
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const submitContacts = async () => {
    if (!token || !state.entity.id) return { ok: true };
    const p = state.pettyCash;
    const idFor = (label) => {
      const found = label ? (accountOptions.contacts || []).find((o) => o.label === label) : null;
      return found ? found.id : '';
    };
    const contacts = {
      director: idFor(p.directorContact),
      cash_sale: idFor(p.cashSaleContact),
      discrepancy: idFor(p.discrepancyContact),
    };
    try {
      const res = await fetch(urlFor(`/api/onboarding/contacts`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id, contacts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "I couldn't save those contacts. Mind trying again?") };
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  // Create a brand-new Xero contact inline from the contacts step, so users
  // don't have to leave onboarding to add one. On success the returned
  // {id, label} is appended to accountOptions.contacts (no re-fetch needed) and
  // returned so the caller can select it in the relevant role dropdown.
  const createContact = async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return { ok: false, error: 'Who should I put down as the contact?' };
    if (!token || !state.entity.id) {
      // Standalone / no Module 1 handoff: fake an option so the prototype works.
      const option = { id: `local-${trimmed}`, label: trimmed };
      setAccountOptions((prev) => ({ ...prev, contacts: [...(prev.contacts || []), option] }));
      return { ok: true, option };
    }
    try {
      const res = await fetch(urlFor(`/api/onboarding/contacts/create`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id, name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 means Xero isn't connected yet — surface that so the step can
        // route the user back to the Xero step.
        return {
          ok: false,
          error: friendlyError(data, "I couldn't add those. Mind trying again?"),
          notConnected: res.status === 409 || data.connected === false,
        };
      }
      const option = { id: data.id, label: data.label || trimmed };
      setAccountOptions((prev) => ({ ...prev, contacts: [...(prev.contacts || []), option] }));
      return { ok: true, option };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const billLoadedRef = useRef(false);
  useEffect(() => {
    if (current !== 8 || billLoadedRef.current) return;
    if (!token || !state.entity.id) return;
    billLoadedRef.current = true;
    fetch(urlFor(`/api/onboarding/bill-codes?entity_id=${encodeURIComponent(state.entity.id)}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.connected) return;
        const bill = data.bill_codes || [];
        setAccountOptions((prev) => ({ ...prev, bill }));
        let billCodesVal;
        if (data.default_all) {
          billCodesVal = { all: true, selected: {} };
        } else {
          const selMap = {};
          (data.selected_codes || []).forEach((c) => {
            selMap[c] = true;
          });
          billCodesVal = { all: false, selected: selMap };
        }
        setState((prev) => ({ ...prev, bills: { ...prev.bills, billCodes: billCodesVal } }));
      })
      .catch(() => {
        /* leave the step empty if the fetch fails */
      });
  }, [current, token, state.entity.id]);

  const submitBills = async () => {
    if (!token || !state.entity.id) return { ok: true };
    const allCodes = (accountOptions.bill || []).map((e) => e.code);
    const bc = state.bills.billCodes || { all: true, selected: {} };
    const isAll = bc.all !== false;
    const sel = bc.selected || {};
    const selectedCodes = allCodes.filter((c) => (isAll ? sel[c] !== false : sel[c] === true));
    try {
      const res = await fetch(urlFor(`/api/onboarding/bill-codes`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id, selected_codes: selectedCodes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "I couldn't save those account codes. Mind trying again?") };
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const submitInvite = async ({ email, role, first_name, last_name }) => {
    // Standalone prototype (no Module 1 handoff): keep the invite local-only.
    if (!token || !state.entity.id) return { ok: true, invitation: { email, role, first_name, last_name } };
    try {
      const res = await fetch(urlFor(`/api/onboarding/invite`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id, email, role, first_name, last_name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "I couldn't send that invitation. Mind trying again?") };
      // The invitation row can be created even when the email itself fails to
      // go out (Brevo/SMTP error) — the backend signals that with
      // email_sent: false. Pass it through so the UI can warn instead of
      // showing a false "Invitation sent" success.
      //
      // Backends disagree on where email_sent lives: some put it at the top
      // level ({ email_sent, invitation }), others nest it inside the
      // invitation ({ invitation: { email_sent } }). Check both; only treat it
      // as a failure when an explicit `false` is present in either spot.
      const emailSentFlag =
        data.email_sent ?? (data.invitation && data.invitation.email_sent);
      return { ok: true, invitation: data.invitation, emailSent: emailSentFlag !== false };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const cancelInvite = async (invitationId) => {
    if (!token || !invitationId) return { ok: true };
    try {
      const res = await fetch(urlFor(`/api/onboarding/invite/cancel`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invitation_id: invitationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: friendlyError(data, "I couldn't cancel that. Mind trying again?") };
      return { ok: true };
    } catch {
      return { ok: false, error: "I couldn't reach the server. Mind trying again?" };
    }
  };

  const invitesLoadedRef = useRef(false);
  useEffect(() => {
    if (current !== 8 || invitesLoadedRef.current) return;
    if (!token || !state.entity.id) return;
    invitesLoadedRef.current = true;
    fetch(urlFor(`/api/onboarding/invite?entity_id=${encodeURIComponent(state.entity.id)}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.invitations)) return;
        setState((prev) => {
          // Keep any names typed this session (backend stores only email/role),
          // matching by email; fall back to email-derived initials otherwise.
          const known = {};
          (prev.invites || []).forEach((x) => {
            if (x.email) known[x.email.toLowerCase()] = x;
          });
          const invites = data.invitations.map((inv) => {
            const prior = known[(inv.email || '').toLowerCase()] || {};
            return {
              id: inv.id,
              email: inv.email,
              role: inv.role,
              first: prior.first || '',
              last: prior.last || '',
            };
          });
          return { ...prev, invites };
        });
      })
      .catch(() => {
        /* leave the list empty if the fetch fails */
      });
  }, [current, token, state.entity.id]);

  // Commits the deferred opening balance (when petty cash was the
  // selection), finalizes onboarding, then redirects to the entity list.
  // Bill-only users skip the opening-balance commit. Returns { ok, redirect }
  // so All Set can show errors / stay put.
  /* COMMIT ONBOARDING — WITHOUT LEAVING IT.
   *
   * This and `exitToEntityList` below were one `finishOnboarding` that committed and
   * navigated on the same click. They had to come apart: the All Set screen now states
   * the trial's real end date, and a trial that only starts as the payer leaves gives
   * that screen nothing true to print. So the commit runs when All Set is REACHED, and
   * leaving is just leaving.
   *
   * Returns the trial end for the screen to show. Finalize stays BEST-EFFORT: a failure
   * must not strand the payer on a dead end, so it resolves ok with a null date and the
   * screen drops that one row.
   */
  const completeOnboarding = async () => {
    // Onboarding done — drop this entity's saved session (and any bare draft).
    try {
      window.localStorage.removeItem(sessionKey(state.entity.id));
      window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    if (!token || !state.entity.id) return { ok: true, trialEnd: null };
    const chosen = state.modules[0]; // 'pettyCash' | 'bills' | undefined
    if (chosen !== 'bills') {
      const result = await submitOpeningBalance();
      if (!result?.ok) return result;
    }
    // Clears the mid-onboarding flag so the entity routes to its dashboard on the next
    // entity-list click instead of bouncing back here, and starts the module trials.
    try {
      const res = await fetch(urlFor(`/api/onboarding/finalize`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id: state.entity.id }),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: true, trialEnd: data?.trial_end || null };
    } catch {
      return { ok: true, trialEnd: null };
    }
  };

  /** Leave the wizard. Commits nothing — `completeOnboarding` already did, on arrival. */
  const exitToEntityList = () => {
    window.location.href = urlFor(`/entity`);
  };

  // Save-and-exit from any step: best-effort save of the current step's data
  // (each submitX no-ops on empty/standalone), then leave to the entity-list
  // dashboard. localStorage already persists current+state, so re-entering
  // onboarding resumes the user where they left off. A failed save does NOT
  // block the exit — we save what's valid and go.
  const saveAndExit = async (submitFn) => {
    try {
      if (typeof submitFn === 'function') await submitFn();
    } catch {
      /* best-effort — never block the exit on a save failure */
    }
    // Record the FE step the user is leaving from so a later resume can land
    // them right back here (see deriveResumeStep). Best-effort: a failure here
    // must never block the exit, and resume falls back to the derived step.
    if (token && state.entity.id) {
      try {
        await fetch(urlFor(`/api/onboarding/saved-step`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ entity_id: state.entity.id, saved_step: current }),
        });
      } catch {
        /* best-effort — ignore and exit anyway */
      }
    }
    window.location.href = urlFor(`/entity`);
  };

  const fetchExistingSalesMethods = async () => {
    if (!token || !state.entity.id) return null;
    try {
      const res = await fetch(urlFor(`/api/onboarding/sales-methods?entity_id=${encodeURIComponent(state.entity.id)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // Avatar initials — prefer the connected user, fall back to entity name.
  const profileInitials = (() => {
    if (user.first || user.last) {
      return ((user.first[0] || '') + (user.last[0] || '')).toUpperCase() || 'DD';
    }
    const source = user.name || state.entity.name || '';
    const fromWords = source
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
    return fromWords || 'DD';
  })();
  const profileLabel = user.name || state.entity.name || 'Your entity';

  // Apply accent CSS vars from baked-in defaults
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty('--accent', ACCENT_DEFAULTS.accent);
    r.style.setProperty('--accent-ink', ACCENT_DEFAULTS.accentInk);
    r.style.setProperty('--accent-soft', ACCENT_DEFAULTS.accentSoft);
    r.style.setProperty('--accent-hover', ACCENT_DEFAULTS.accent);
  }, []);

  // The last content step (immediately before "All Set", step 9) shows a
  // "Complete" button instead of "Save & Next". Which step that is depends on
  // the selected modules: Bills (8) when bills is on, otherwise Others (7).
  const isLastContentStep = current === activeIds[activeIds.length - 2];

  const stepProps = { state, set, next, back, submitEntity, submitModule, modulePlans, token, connectXero, disconnectXero, xeroMismatch, clearXeroMismatch: () => setXeroMismatch(''), xeroConflict, clearXeroConflict: () => setXeroConflict(''), submitSalesMethods, submitOpeningBalance, fetchExistingSalesMethods, accountOptions, submitAccountCodes, submitContacts, createContact, submitBills, submitInvite, cancelInvite, completeOnboarding, exitToEntityList, saveAndExit, isLastContentStep };

  return (
    <>
      <div className="topbar" data-screen-label="Top bar">
        <div className="topbar-inner">
          <div className="brand">
            <img className="brand-mark-img" src="/assets/minty-logo.png" alt="Minty" />
            <span>Minty</span>
          </div>
          <h1>Getting Started</h1>
          <div className="right pl-0.5 sm:pl-2">
            <button
              type="button"
              className="avatar"
              title={profileLabel}
              aria-label="Open profile"
              onClick={() => {
                if (profileUrl) window.location.href = profileUrl;
              }}
            >
              {profileInitials}
            </button>
            {/* Nav stays Logout-only through onboarding; full menu populates on the final "All Set" step. */}
            <NavMenu companyName={state.entity.name || 'Minty'} showFullMenu={current === 9} />
          </div>
        </div>
      </div>

      <Stepper current={current} onClick={goto} maxReached={maxReached} displaySteps={displaySteps} />

      <main className="page" data-screen-label={`0${current} ${STEPS[current - 1].label}`}>
        {(current === 5 || current === 6 || current === 7) && (
          <aside className="pc-side-menu" aria-label="Petty Cash sub-steps">
            <div className="pc-side-title">Petty Cash Settings</div>
            {[
              { id: 5, num: '1', label: 'Sales' },
              { id: 6, num: '2', label: 'Account Code' },
              { id: 7, num: '3', label: 'Others' },
            ].map(({ id, num, label }) => {
              // A sub-step is reachable once the user has been there. Forward
              // jumps to an incomplete step are still blocked inside goto(), so
              // clicking a not-yet-eligible item is a safe no-op; we disable it
              // here too so the cursor/affordance matches.
              const reachable = id <= maxReached;
              return (
                <button
                  key={id}
                  type="button"
                  className={'pc-side-item' + (current === id ? ' active' : '') + (current > id ? ' done' : '')}
                  onClick={() => goto(id)}
                  disabled={!reachable || current === id}
                  aria-current={current === id ? 'step' : undefined}
                >
                  <span className="substep-circle">{current > id ? <Icon.CheckSm /> : num}</span>
                  <span className="substep-label">{label}</span>
                </button>
              );
            })}
          </aside>
        )}
        {current === 1 && <StepCreateEntity {...stepProps} />}
        {current === 2 && <StepSelectModule {...stepProps} />}
        {current === 3 && <StepInvite {...stepProps} />}
        {current === 4 && <StepConnectXero {...stepProps} />}
        {current === 5 && <StepSalesSetting {...stepProps} />}
        {current === 6 && <StepAccountCode {...stepProps} />}
        {current === 7 && <StepOthers {...stepProps} />}
        {current === 8 && <StepBills {...stepProps} />}
        {current === 9 && <StepAllSet {...stepProps} />}
      </main>

      {needsXeroPrompt && mounted && ReactDOM.createPortal(
        <div
          className="skip-modal-overlay"
          role="presentation"
          onClick={() => setNeedsXeroPrompt(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            background: 'rgba(15, 23, 27, 0.45)',
          }}
        >
          <div
            className="skip-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="xero-prompt-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#f1f3f4',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.22)',
              padding: '26px 26px 22px',
              maxWidth: 440,
              width: '100%',
            }}
          >
            <p id="xero-prompt-title" className="skip-modal-lead">
              {xeroPromptReason === 'expired'
                ? 'Your session has timed out.'
                : 'Connect to your accounting system first.'}
            </p>
            <p className="skip-modal-body" style={{ marginBottom: 32 }}>
              {xeroPromptReason === 'expired'
                ? 'It has been more than 30 minutes, so your connection to Xero has expired. Please go back to the “Connect to Accounting System” step and reconnect to continue your setup.'
                : 'You’re not connected to Xero yet. Please go back to the “Connect to Accounting System” step and connect before continuing your setup.'}
            </p>
            <div className="skip-modal-actions" style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setNeedsXeroPrompt(false);
                  setMaxReached((m) => Math.max(m, 4));
                  setCurrent(4);
                }}
              >
                {xeroPromptReason === 'expired' ? 'Reconnect to Xero' : 'Go to Connect step'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}