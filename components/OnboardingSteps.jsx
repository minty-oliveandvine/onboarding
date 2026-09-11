'use client';

// Step content components. Each receives { state, set, next, back }.
import { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import Icon from './Icon';
import MintySelect from './MintySelect';
import MintyDatePicker from './MintyDatePicker';
import Confetti from './Confetti';
import BillingSheet from './BillingSheet';
import CardBrand from './CardBrand';
import { useToast } from './Toast';
import { fetchCountries, fetchCurrencies } from '@/lib/refData';
import { acceptAmountInput, formatAmount, toAmountEditString } from '@/lib/amount';
import { formatDate } from '@/lib/date';
import { fetchBillingStatus } from '@/lib/billing';

// --- Reusable bits ---
export function Switch({ on, onChange }) {
  return <button type="button" className={'switch' + (on ? ' on' : '')} onClick={() => onChange(!on)} aria-pressed={on} />;
}
export function ToggleRow({ title, sub, on, onChange }) {
  return (
    <div className="toggle-row">
      <div>
        <div className="t-label">{title}</div>
        {sub && <div className="t-sub">{sub}</div>}
      </div>
      <Switch on={on} onChange={onChange} />
    </div>
  );
}

// Shared "Save & Exit" control shown in every step's footer. Saves the current
// step's data best-effort (via the step's submit fn) then leaves to the entity
// list dashboard. The actual save+redirect lives in OnboardingApp's saveAndExit;
// here we just manage the local "Saving…" state. `submitFn` is optional — steps
// without a per-step save (Invite, Connect Xero) pass nothing and we exit after
// persisting via localStorage.
export function SaveExitLink({ saveAndExit, submitFn, disabled = false, className = 'btn-link-center', style }) {
  const [exiting, setExiting] = useState(false);
  const onClick = async () => {
    if (exiting || disabled) return;
    setExiting(true);
    try {
      await saveAndExit(submitFn);
    } catch {
      setExiting(false); // saveAndExit redirects on success, so we only land here on failure
    }
  };
  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled={disabled || exiting}
      onClick={onClick}
    >
      {exiting ? 'Saving…' : 'Save & Exit'}
    </button>
  );
}

// Back / Save & Exit / Save & Next footer shared by the Account Code, Others,
// Bills and Sales sub-steps. `isLastContentStep` is only passed by the steps
// that can be last — when it is undefined the ternary falls through to
// "Save & Next", which is exactly what those steps rendered before.
//
// StepSelectModule deliberately does NOT use this: its primary button has
// different disabled logic and an extra sibling hint, so sharing would mean
// parameterizing more than it saves.
function StepNav({ back, saveAndExit, stepSubmit, tryNext, saving, isLastContentStep }) {
  return (
    <div className="step-nav">
      <button className="btn btn-ghost" onClick={back}>
        <Icon.ArrowLeft /> Back
      </button>
      <div className="step-actions">
        <SaveExitLink saveAndExit={saveAndExit} submitFn={stepSubmit} disabled={saving} />
        <button className="btn btn-primary" onClick={tryNext} disabled={saving}>
          {saving ? 'Saving…' : isLastContentStep ? 'Complete' : <>Save &amp; Next <Icon.Arrow /></>}
        </button>
      </div>
    </div>
  );
}

// --- Step 1: Create Entity ---
export function StepCreateEntity({ state, set, next, submitEntity, saveAndExit }) {
  const s = state.entity;
  const upd = (k, v) => set({ entity: { ...s, [k]: v } });
  // Phone and email are optional — but if the user does type something, it must
  // still be valid (Module 1 create-entity: 8–11 digits; standard email shape).
  const emailOk = s.email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email);
  const phoneDigits = s.phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length === 0 || (phoneDigits.length >= 8 && phoneDigits.length <= 11);
  const canNext = s.name.trim().length > 0 && phoneOk && emailOk;
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  // Set when the backend rejects the name as already-taken, so we can flag the
  // Entity Name field and clear the flag as soon as the user edits the name.
  const [nameTaken, setNameTaken] = useState(false);
  // Country / currency options come from the backend registries
  // (country_info / currency_info): the dropdown shows the name but its
  // value — what gets stored and submitted — is the registry uuid, so the
  // created entity's country_id / currency_id FKs receive uuids.
  const [countryOptions, setCountryOptions] = useState([]);
  const [currencyOptions, setCurrencyOptions] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchCountries().then((list) => {
      if (!cancelled) {
        setCountryOptions(list.map((c) => ({ value: c.country_id, label: c.country_name_en })));
      }
    });
    fetchCurrencies().then((list) => {
      if (!cancelled) {
        setCurrencyOptions(list.map((c) => ({ value: c.currency_id, label: c.currency_name })));
      }
    });
    return () => { cancelled = true; };
  }, []);
  // Migrate legacy name values (the pre-registry defaults like 'Hong Kong' /
  // 'Hong Kong Dollar', or an old saved session) to their registry uuids once
  // the options are in, so submits always carry uuids.
  useEffect(() => {
    const byLabel = (opts, v) =>
      v && !opts.some((o) => o.value === v) ? opts.find((o) => o.label === v) : null;
    const country = byLabel(countryOptions, s.country);
    const currency = byLabel(currencyOptions, s.currency);
    if (country || currency) {
      set({
        entity: {
          ...s,
          ...(country ? { country: country.value } : {}),
          ...(currency ? { currency: currency.value } : {}),
        },
      });
    }
  }, [countryOptions, currencyOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = async () => {
    if (!canNext || saving) return;
    setNameTaken(false);
    if (typeof submitEntity === 'function') {
      setSaving(true);
      const result = await submitEntity();
      setSaving(false);
      if (!result?.ok) {
        // A duplicate name is announced by the inline field message, which points
        // at the field the user has to change. Raising the toast too would say the
        // same thing twice, so only non-duplicate failures get one.
        if (result?.duplicate) setNameTaken(true);
        else toast.error(result.error);
        return;
      }
    }
    next();
  };

  const backToEntityList = () => {
    const base = (process.env.NEXT_PUBLIC_MODULE1_API_URL || 'http://localhost:5001').replace(/\/$/, '');
    window.location.href = `${base}/entity`;
  };
  return (
    <>
      <div className="page-head">
        <img src="/assets/basic-info-cat.png" alt="" className="basic-info-cat" />
        <h2>Basic Information</h2>
        <p>Let&apos;s start by creating your first entity. It only takes a minute.</p>
      </div>
      <div className="form-stack">
        <div className={'field' + (nameTaken ? ' field-error' : '')}>
          <label>Entity Name</label>
          <input
            type="text"
            name="organization"
            autoComplete="organization"
            placeholder="Please enter your company name"
            value={s.name}
            aria-invalid={nameTaken}
            onChange={(e) => {
              // Editing the name clears the duplicate field flag so it doesn't
              // linger while the user types a new name. The toast dismisses
              // itself, so there's nothing to clear there.
              if (nameTaken) setNameTaken(false);
              upd('name', e.target.value);
            }}
          />
          {nameTaken && (
            <div className="field-required" role="alert">Oh, someone got there first! Do you have another name in mind?</div>
          )}
        </div>
        <div className="field">
          <label>Country</label>
          <MintySelect value={s.country} onChange={(v) => upd('country', v)} options={countryOptions} searchable />
        </div>
        <div className="field">
          <label>Currency</label>
          <MintySelect value={s.currency} onChange={(v) => upd('currency', v)} options={currencyOptions} searchable />
        </div>
        <div className="field">
          <label>Contact Phone <span className="field-optional">(optional)</span></label>
          <input type="tel" name="tel" autoComplete="tel" inputMode="numeric" maxLength={11} pattern="[0-9]{8,11}" title="Phone number must be 8-11 digits" placeholder="Please enter your contact phone number" value={s.phone} onChange={(e) => upd('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} />
        </div>
        <div className="field">
          <label>Business Email <span className="field-optional">(optional)</span></label>
          <input type="email" name="email" autoComplete="email" placeholder="Please enter your business email" value={s.email} onChange={(e) => upd('email', e.target.value)} />
        </div>
      </div>
      <div className="cta-stack">
        <button className="btn btn-primary btn-block btn-jelly" disabled={!canNext || saving} onClick={handleNext}>
          {saving ? 'Saving…' : 'Save & Next'}
        </button>
        <SaveExitLink saveAndExit={saveAndExit} submitFn={submitEntity} disabled={saving} />
        <button className="btn-link-center" onClick={backToEntityList}>Back to Entity List</button>
      </div>
    </>
  );
}

// --- Step 2: Select Module ---
// `tile` and `art` come off the card exports rather than being derived from `accent`:
// the design gives each module its own tile wash and its own illustration size (Petty
// Cash 80px, Payment Request 95px), and a colour-mix of the accent landed near neither.
// `accent` is kept because the illustration inherits it as `currentColor`.
export const MODULES = [
  { id: 'pettyCash', title: 'Petty Cash', desc: 'Track and reimburse small office expenses with receipt capture and instant approvals.', img: '/pettycash-icon.png', accent: '#f5b945', tile: '#FFF7EC', art: 80, price: '280 HKD per Month' },
  { id: 'bills', title: 'Payment Request', desc: 'Capture vendor payments, schedule payments, and reconcile with your accounting ledger.', img: '/payment-icon.png', accent: '#3aa6f5', tile: '#EDF5FC', art: 95, price: '280 HKD per Month' },
];

// Backend module codes → the ids used by MODULES / state.modules above, so the
// live plan catalog from /api/onboarding/plans can be matched to the picked cards.
const FE_MODULE_BY_CODE = { PETTY_CASH: 'pettyCash', BILL: 'bills' };

/** Index the live plan catalog by frontend module id (empty when it didn't load). */
function plansByModuleId(catalog) {
  const byId = {};
  (catalog?.plans || []).forEach((p) => {
    const id = FE_MODULE_BY_CODE[p.code];
    if (id) byId[id] = p;
  });
  return byId;
}

/**
 * "HKD 560", but "HKD 560.50" when a price genuinely carries cents.
 *
 * Spaced, because the leading token is whatever /api/onboarding/plans sends as
 * `currency_symbol` — and `currency_info` is empty, so in practice that is the bare
 * code "HKD" rather than a symbol. "HKD560" runs together; "HKD 560" reads. The same
 * space is what lib/amount.js formatMoney() already puts there.
 */
function money(symbol, value) {
  const text = trimZeroCents(formatAmount(value));
  if (!text) return '';
  return symbol ? `${symbol} ${text}` : text;
}

/**
 * "280.00" -> "280", but "280.50" stays. The rule money() has always applied, pulled
 * out because the module cards and the beta footnote print the SERVER's
 * `formatted_amount` rather than formatting the number themselves — and that string
 * arrives with the cents on, because it is the same formatter the invoice memo and the
 * charge-confirmation dialog use, where the cents belong.
 */
function trimZeroCents(text) {
  return String(text ?? '').replace(/\.00$/, '');
}

/**
 * What the picked modules cost, and when the first charge falls.
 *
 * Lifted out of the summary panel because the billing sheet has to quote the SAME figures: the
 * dialog names an amount and a date the payer then consents to, and a second copy of the
 * bundle test is exactly how that comes to disagree with the panel beside it.
 *
 * `picked` is the priced rows (module + plan), already filtered to the selection.
 */
function priceSelection(catalog, picked) {
  const symbol = picked[0].plan.currency_symbol || picked[0].plan.currency_code || '';
  const interval = picked[0].plan.billing_interval || 'month';
  const subtotal = picked.reduce((sum, r) => sum + r.plan.amount, 0);

  // The bundle is a price in its own right, not a per-line discount, so it applies
  // only when the picked set is EXACTLY the set it covers — the same test as
  // BundlePlanView.covers() and the settings summary.
  const bundleCodes = (catalog.bundle_codes || []).map((c) => String(c).toUpperCase());
  const bundleAmount = Number(catalog.bundle_amount || 0);
  const pickedCodes = picked.map((r) => String(r.plan.code).toUpperCase());
  const isBundle =
    bundleAmount > 0 &&
    bundleCodes.length > 0 &&
    bundleCodes.length === pickedCodes.length &&
    bundleCodes.every((c) => pickedCodes.includes(c));

  return {
    symbol,
    interval,
    subtotal,
    isBundle,
    // Returned in its own right, not just folded into `total`: the summary's bundle line
    // strikes the subtotal through and prints the bundle price beside it, so it needs
    // both numbers at once.
    bundleAmount,
    total: isBundle ? bundleAmount : subtotal,
    saving: isBundle ? subtotal - bundleAmount : 0,
    trialDays: Number(catalog.trial_period_days || 0),
  };
}

/**
 * The priced rows for a selection, in canonical order — or [] when there is nothing to
 * price (no catalog, or no module picked yet).
 */
function pricedRows(catalog, selected) {
  const byId = plansByModuleId(catalog);
  return MODULES.map((m) => ({ module: m, plan: byId[m.id], on: selected.includes(m.id) }))
    .filter((r) => r.plan && r.on);
}

/**
 * The trial-activation card for the module picker — the onboarding twin of Minty's
 * settings panel (templates/entity/partials/module_subscription_section.html).
 *
 * The pricing rule is the SERVER'S rather than a second implementation of it: two
 * modules together bill at the BUNDLE price — one `billing_plan` row keyed by the
 * sorted module SET — and any other selection is the sum of the standalone plans.
 * That is what get_subscription_summary and checkout do, so this preview and the
 * invoice that eventually lands cannot quote different numbers. Both figures come out
 * of priceSelection(), which the billing sheet is quoted from too.
 *
 * This used to read `catalog.discount_unit` / `catalog.discount_currency`, a
 * coupon-shaped model left over from when the price catalog lived in Stripe.
 * /api/onboarding/plans does not send those fields and never has — it sends
 * bundle_amount / bundle_codes — so the discount silently evaluated to zero and
 * picking both modules quoted the undiscounted 560 against the 400 they are
 * actually billed. Reading the bundle is the fix.
 *
 * NOTHING IS CHARGED ON THIS STEP, and the card must never imply otherwise. Trials are
 * created at /api/onboarding/finalize; the button below only opens the dialog that saves
 * a card and records consent. That is why "Due today" prints an explicit zero rather
 * than leaving the payer to infer it from a struck-through price — the previous version
 * of this panel showed the words "Free Trial" beside a crossed-out total and never named
 * the amount actually being taken today.
 *
 * The button is OPTIONAL. Consent decides how the trial ENDS — converts to paid, or
 * lapses — not whether it can start, so the step's own Save & Next moves on without it.
 */
function ModuleSubscriptionSummary({ catalog, selected, card, cardLoading, onOpenBilling }) {
  const picked = pricedRows(catalog, selected);

  // Nothing to price — no catalog (endpoint unreachable) or no module picked yet.
  // The panel is absent entirely rather than reserved, so the cards stay centred
  // on the page until there's actually something to show beside them.
  if (picked.length === 0) return null;

  const { symbol, interval, isBundle, subtotal, total } = priceSelection(catalog, picked);
  // Only when the bundle actually saves something. A struck price equal to the one
  // beside it is not a discount, it is a typo the payer has to work out.
  const struck = isBundle && subtotal > total ? trimZeroCents(formatAmount(subtotal)) : null;

  return (
    <aside className="sub-summary" aria-live="polite">
      <h3 className="sub-summary-title">Subscription Summary</h3>

      <div className={'sub-plan ' + (isBundle ? 'is-bundle' : 'is-single')}>
        <span className="sub-row-label">Selected plan</span>
        <div className="sub-plan-value">
          {isBundle ? (
            <>
              <span className="sub-plan-name">SuperMinty</span>
              {/* Named as well as priced: the invoice will say "SuperMinty", and a
                  payer who only ever saw two module names here would not recognise it. */}
              <span className="sub-plan-note">Both modules selected</span>
            </>
          ) : (
            <>
              <span className="sub-plan-name">{picked[0].module.title}</span>
              {/* "only" is doing work — it is what says the OTHER module is not
                  included, on a screen whose whole question is which to start. */}
              <span className="sub-plan-note">only</span>
            </>
          )}
        </div>
        {isBundle ? (
          <img className="sub-plan-art" src="/assets/superminty-cat.png" alt="" aria-hidden="true" />
        ) : null}
      </div>

      <div className="sub-pay">
        <span className="sub-pay-head">
          <span className="sub-row-label">Payment method</span>
          {/* ONLY ONCE THERE IS A CARD TO CHANGE. Not while the status is still loading —
              offering to change something not yet shown — and not instead of "Add card",
              which is this same action wearing the name that fits when there is nothing
              there yet.

              The frame draws no such control: once a card is confirmed it simply shows the
              card. Added because without it a payer who picks the wrong card on this step
              cannot correct it until onboarding is over and they find the payer portal. */}
          {!cardLoading && card ? (
            <button type="button" className="sub-pay-change" onClick={onOpenBilling}>
              Change
            </button>
          ) : null}
        </span>
        {/* WHILE WE DO NOT YET KNOW, SAY NOTHING — and "Add card" is not nothing.
            The status is a round trip, and until it lands `card` is null, which used to
            fall straight through to the button below. A payer returning to this step with
            a card already confirmed was therefore offered the chance to add one, for as
            long as the request took, before the row corrected itself. Offering an action
            that is about to be withdrawn is worse than a moment of visible waiting. */}
        {cardLoading ? (
          <span
            className="sub-pay-loading"
            role="status"
            aria-label="Checking your payment method"
          >
            <span className="sub-pay-bar" aria-hidden="true" />
            <span className="sub-pay-bar is-short" aria-hidden="true" />
          </span>
        ) : card ? (
          /* THE MARK, THEN THE WHOLE STRING — 01-C draws it that way, and the string is one
             line rather than a brand stacked over "ending in NNNN". Same component as the
             picker's rows, so the card a payer confirms in the dialog is the card they see
             here, drawn identically.

             `card.label` is the fallback for a method with no last4 to end in: a Link
             wallet exposes no card object at all, and "Link" is the true answer. */
          <span className="sub-pay-card">
            <CardBrand brand={card.brand} label={card.brand_label} className="sub-pay-mark" />
            <span className="sub-pay-name">
              {card.last4 ? `${card.brand_label} ending in ${card.last4}` : card.label}
            </span>
          </span>
        ) : (
          /* A button, not a link: it opens a dialog rather than going anywhere, and a
             payer using a keyboard should reach it in the tab order with the controls
             it belongs to. */
          <button type="button" className="sub-pay-add" onClick={onOpenBilling}>
            Add card
          </button>
        )}
      </div>

      {/* AFTER THE TRIAL — not now. Nothing on this step charges anything, which is why
          this tile is labelled with when the money moves rather than with a total. */}
      <div className="sub-tile">
        <span className="sub-tile-label">After trial</span>
        <span className="sub-tile-price">
          {/* THE STRUCK SUBTOTAL STACKS OVER THE FIGURE, NOT OVER THE WHOLE LINE — which
              is why "/month" sits outside this column rather than inside the price span.
              With it inside, right-aligning the column put 560 above the word "month"
              instead of above the 400 it is being compared with.

              It carries no currency code because it sits directly above one in the same
              currency; the figure that will actually be charged is the one named in full. */}
          <span className="sub-tile-figure">
            {struck ? <span className="sub-tile-was">{struck}</span> : null}
            <span className="sub-tile-now">{money(symbol, total)}</span>
          </span>
          <span className="sub-tile-per">/{interval}</span>
        </span>
      </div>
    </aside>
  );
}

export function StepSelectModule({ state, set, next, back, submitModule, modulePlans, token, saveAndExit }) {
  const sel = state.modules.filter((id) => MODULES.some((m) => m.id === id));
  // No per-card price lookup any more: the cards carry a trial status, not a figure,
  // and the ONE price on this step is the summary's "After trial" tile. It reads the
  // live catalog through priceSelection(), so there is nothing left here to drift.
  // Multi-select toggle: clicking a card adds or removes it from the
  // selection. Continue is gated on sel.length > 0 so users must pick at
  // least one — both can be picked together for a full setup.
  const pick = (id) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    set({ modules: next });
  };
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [billingOpen, setBillingOpen] = useState(false);
  const busy = saving;

  // What the billing sheet will quote. Computed from the same helper as the summary beside
  // it, so the dialog can't name a figure the page has already contradicted.
  const priced = pricedRows(modulePlans, sel);
  const pricing = priced.length > 0 ? priceSelection(modulePlans, priced) : null;

  // "30 days", from the SERVER's trial_period_days rather than the words. The card, the
  // intro and the footnote all print it, and three hardcoded thirties are three places
  // that keep saying thirty after billing_policy is tuned to something else.
  // DAYS, not trialPeriodLabel(). That helper turns 30 into "1 month" — right for the
  // billing sheet, where the term is being quoted as the interval it will bill in, and
  // wrong here: this step's copy is written in days throughout ("30-day free trial",
  // "30 days free trial"), and a card reading "1 month free trial" beside a footnote
  // promising 30 days invites the reader to work out whether they are the same offer.
  // Still the SERVER's number, so tuning billing_policy moves all three strings.
  const trialDays = Number(modulePlans?.trial_period_days || 30);
  const trialDaysLabel = trialDays + ' days';   // "30 days free trial"  (the card)
  const trialTermLabel = trialDays + '-day';    // "its own 30-day free trial" (prose)

  /* THE CARD THIS ENTITY IS CONFIRMED ON — not "a card the payer owns".
   *
   * This row used to read the payer's wallet and print their ACCOUNT DEFAULT, which made
   * a card appear here the moment the payer had one anywhere, for any company, agreed to
   * or not. Two things were wrong with that, and they compound:
   *
   *   - It printed BEFORE consent. Saving a card is not agreeing to be billed on it, and
   *     the row reads as a statement that this entity is set up when it is not.
   *   - It printed the WRONG CARD. Nomination is per entity; the account default is a
   *     different card as soon as the payer has two, so the row could name a card this
   *     company was never going to be charged on.
   *
   * Both are answered by the same source: `/onboarding/payment-method` returns the
   * nominated card and the consent flag together, and the row shows a card only when it
   * has both. No consent, or nothing nominated, and it offers "Add card" — which is the
   * truth in either case.
   *
   * Re-read after the billing dialog reports a confirmation, which is the only thing on
   * this step that can change the answer. */
  const [savedCard, setSavedCard] = useState(null);
  const [cardEpoch, setCardEpoch] = useState(0);
  // Starts TRUE so the first paint shows the placeholder rather than "Add card" — see the
  // note on the row itself. Set back to true on every re-read, because a confirmation
  // re-runs this and the row should not flicker through the old answer on the way to the
  // new one.
  const [cardLoading, setCardLoading] = useState(true);
  useEffect(() => {
    if (!token || !state?.entity?.id) {
      // Nothing to wait for, so stop waiting — without this the placeholder would sit
      // there for ever on a step that has no entity to ask about.
      setCardLoading(false);
      return;
    }
    let live = true;
    setCardLoading(true);
    fetchBillingStatus(token, state.entity.id)
      .then((res) => {
        if (!live) return;
        setSavedCard(res?.has_billing_consent ? res.card || null : null);
      })
      // Silent: a payer with no Stripe customer yet is the ordinary case on this step,
      // not an error, and the row simply offers "Add card" instead.
      .catch(() => {})
      .finally(() => {
        if (live) setCardLoading(false);
      });
    return () => {
      live = false;
    };
  }, [token, state?.entity?.id, cardEpoch]);

  // Confetti is part of the SuperMinty STATE, not a one-shot animation: 01-B draws it
  // in the frame, so it stays up for as long as both modules are ticked and goes the
  // moment one is unticked. Derived, so it needs no state, no timer and no cleanup —
  // and re-entering the step with both already picked shows it, as the frame does.
  const bothPicked = sel.length === MODULES.length;

  /**
   * Save & Next — the only way forward, and the only route to billing.
   *
   * Card and consent are asked for ON THE WAY OUT of this step rather than from a button
   * of their own: the subscription card beside the modules has already stated the term,
   * the amount and the date, so the dialog is the signature at the bottom of a page the
   * payer has just read.
   *
   * ORDER MATTERS. The module selection is saved FIRST, before the dialog opens. The
   * dialog quotes a price for the modules picked, and consent recorded against a
   * selection that was never persisted would be consent to something the entity does
   * not have.
   *
   * CONSENT REMAINS OPTIONAL. It decides how the trial ENDS — converts to paid, or
   * lapses — not whether it can start, so dismissing the dialog still advances the step.
   * A payer who skips it finishes onboarding and gets the full trial; it just runs out
   * at the end of the term instead of continuing. That is why the dismissal path calls
   * next() rather than stranding them here: the modules are already saved, and a second
   * press of Save & Next would only reopen a dialog they just declined.
   */
  /* SAVE & NEXT DOES NOT ASK ABOUT BILLING. It saves the modules and moves on, whether or
   * not there is a card on file, because the card is optional at this step.
   *
   * This used to open the billing sheet whenever consent was missing, which made a card the
   * price of reaching step 3. The sheet is now reached deliberately, from "Add card" in the
   * summary beside these cards, or later from the All Set step. Anyone restoring the prompt
   * here should know they are also restoring the need for an escape out of it. */
  const handleNext = async () => {
    if (sel.length === 0 || busy) return;
    if (typeof submitModule === 'function') {
      setSaving(true);
      const result = await submitModule();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };

  // The step is one column, and the column has two widths: the two cards on their own,
  // or the cards plus the summary panel. Everything on the step tracks it, so the
  // heading and the footnote widen with the row instead of keeping an edge the cards
  // no longer have.
  const wide = sel.length > 0 ? ' is-wide' : '';

  return (
    <>
      <div className={'page-head module-head' + wide}>
        <h2>Which free trial would you like to start today?</h2>
        <p>
          Each module includes its own {trialTermLabel} free trial. Start with one module or
          unlock the full Minty experience. Any unselected module can be activated later.
        </p>
      </div>
      <div className={'module-layout' + wide}>
      <div className="module-grid module-grid-2">
        {/* Two bursts flanking the pair, straight out of the 01-B frame. NOT the falling
            Confetti component the All Set step uses — the design draws a moment, not a
            shower, and the pieces are positioned artwork rather than generated. */}
        {bothPicked ? (
          <>
            <img className="module-burst is-left" src="/assets/confetti-left.png" alt="" aria-hidden="true" />
            <img className="module-burst is-right" src="/assets/confetti-right.png" alt="" aria-hidden="true" />
          </>
        ) : null}
        {MODULES.map((m) => {
          const I = m.icon ? Icon[m.icon] : null;
          const on = sel.includes(m.id);
          return (
            <div
              key={m.id}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              className={'module-pick' + (on ? ' selected' : '')}
              onClick={() => pick(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pick(m.id);
                }
              }}
            >
              <div className="mp-card">
                <div className="mp-art" style={{ '--art-accent': m.accent, '--art-tile': m.tile, '--art-size': m.art + 'px' }}>
                  {m.img ? <img src={m.img} alt="" className="mp-img" /> : I ? <I width={m.art} height={m.art} /> : null}
                </div>
                <div className="mp-name">{m.title}</div>
                {/* The card's whole status line. "Available" and "Selected" are the two
                    states this screen actually has — the price is deliberately not here
                    any more, because nothing on this step is being charged and a figure
                    beside a trial reads as one that is. It is in the summary, under
                    "After trial", where it is true. */}
                <div className="mp-trial">
                  <span className="mp-trial-term">{trialDaysLabel} free trial</span>
                  <span className="mp-trial-state">{on ? 'Selected' : 'Available'}</span>
                </div>
              </div>
              <div className="mp-circle" aria-hidden>
                {on && <Icon.CheckSm />}
              </div>
            </div>
          );
        })}
      </div>
        <ModuleSubscriptionSummary
          catalog={modulePlans}
          selected={sel}
          card={savedCard}
          cardLoading={cardLoading}
          onOpenBilling={() => setBillingOpen(true)}
        />
      </div>
      {/* WHERE "nothing is charged today" NOW LIVES. The summary panel used to carry a
          "Due today" line saying it explicitly; the design replaced that panel with four
          elements and this footnote. If this sentence goes, the step stops saying it at
          all — the only other place is the billing dialog, which a payer can finish the
          step without ever opening. */}
      <p className={'module-caption' + wide}>
        Each module comes with its own {trialTermLabel} free trial. Start with one module
        today, or unlock both and enjoy the complete Minty experience. You can always
        activate the other trial later. No payment is required today.
      </p>
      <div className={'step-nav module-nav' + wide}>
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} submitFn={submitModule} disabled={busy} />
          <button className="btn btn-primary" disabled={sel.length === 0 || busy} onClick={handleNext}>
            {saving ? 'Saving…' : <>Save &amp; Next <Icon.Arrow /></>}
          </button>
          {sel.length === 0 ? (
            <div className="step-reminder" role="note">
              <Icon.Info />
              Pick a module to continue with your registration.
            </div>
          ) : null}
        </div>
      </div>
      {billingOpen && pricing ? (
        <BillingSheet
          token={token}
          entityId={state.entity.id}
          /* WHICH CARD IS CURRENTLY BILLING THIS ENTITY, so the picker opens on it rather
             than on the payer's account default. Those are the same card until somebody
             changes one — which is exactly what the Change button above is for. */
          nominatedId={savedCard?.id}
          // Closing costs nothing: the payer opened this from "Add card" and is put back
          // where they were, with the modules untouched.
          onClose={() => setBillingOpen(false)}
          /* NEITHER EXIT NAVIGATES, and `next()` here would be a bug rather than a
             convenience. This sheet is now only ever opened from "Add card", a path that
             has NOT run submitModule() — advancing from it would land on step 3 with the
             module selection unsaved. Save & Next is the only thing that moves the wizard,
             because it is the only thing that saves first. */
          onDone={() => {
            setBillingOpen(false);
            // Re-read the wallet: the card the payer just saved is what the summary's
            // Payment method row should now name.
            setCardEpoch((n) => n + 1);
            toast.success("Card saved — we'll bill this entity when the trial ends.");
          }}
        />
      ) : null}
    </>
  );
}

// --- Step 3: Connect to Xero ---
export function StepConnectXero({ state, next, back, connectXero, disconnectXero, xeroMismatch, clearXeroMismatch, xeroConflict, clearXeroConflict, saveAndExit }) {
  const connected = state.xero.connected;
  const lastConnected = state.xero.lastConnected || '07 May 2026';
  const xeroEntity = state.xero.org || state.entity.name || 'Olive & Vine Inc';
  const [disconnecting, setDisconnecting] = useState(false);
  const toast = useToast();

  // Wrong-account block from the OAuth round-trip: `xeroMismatch` holds the
  // email the user must log in with. This arrives via redirect (query param)
  // rather than a submit, so raise it from an effect — the toast is fire-and-
  // forget, so consume the mismatch immediately to stop it re-firing on every
  // re-render. This is the direct analogue of the Flask partial draining
  // get_flashed_messages() on page load.
  useEffect(() => {
    if (!xeroMismatch) return;
    toast.error(
      xeroMismatch === 'unknown'
        ? "That's a different Xero account. Sign in with your onboarding email?"
        : `Hmm, that's a different Xero account. Sign in with ${xeroMismatch}?`
    );
    if (typeof clearXeroMismatch === 'function') clearXeroMismatch();
  }, [xeroMismatch, clearXeroMismatch, toast]);

  // One-org-one-entity block, same redirect-driven shape as the mismatch above:
  // raise it from an effect and consume it immediately. `xeroConflict` holds the
  // name of the entity already using the org, or 'unknown' when the backend
  // couldn't tell us — in that case the copy has to stay generic rather than
  // naming a placeholder entity.
  useEffect(() => {
    if (!xeroConflict) return;
    toast.error(
      xeroConflict === 'unknown'
        ? 'Oh, another entity got to this Xero org first! Disconnect it there, then come back?'
        : `Oh, “${xeroConflict}” is using this Xero org already! Disconnect it there, then come back?`
    );
    if (typeof clearXeroConflict === 'function') clearXeroConflict();
  }, [xeroConflict, clearXeroConflict, toast]);

  const handleDisconnect = async () => {
    if (disconnecting || typeof disconnectXero !== 'function') return;
    setDisconnecting(true);
    const result = await disconnectXero();
    setDisconnecting(false);
    if (!result?.ok) {
      toast.error(result.error);
    }
  };
  return (
    <>
      <div className="page-head" style={{ textAlign: 'center', maxWidth: 'none', marginBottom: 18 }}>
        <h2 style={{ fontSize: 30, display: 'inline-flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <img src="/xero-logo.webp" alt="Xero" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
          Xero Integration
          <span className="info-tip" tabIndex="0" aria-label="More info">
            <Icon.Info />
            <span className="info-tip-pop" role="tooltip">
              <p>
                Currently Minty can be used only by integrating to Xero. If you wish to be informed about our feature update, please{' '}
                <a href="#" className="pc-link">
                  register here
                </a>
                .
              </p>
            </span>
          </span>
        </h2>
      </div>

      <div className="notice notice-info">
        <div className="notice-icon">
          <Icon.Info />
        </div>
        <div className="notice-body">
          <div className="notice-title">Before you connect</div>
          <p>Our service team can walk you through setting up your Xero integration — want to reach out to them first?</p>
        </div>
      </div>

      <div className={'card status-card' + (connected ? ' status-connected' : '')} style={{ marginTop: 16 }}>
        <div className="status-head">
          <div>
            <div className="card-title">Connection Status</div>
            {connected ? (
              <div className="status-meta">
                <div>
                  Last connected: <b>{lastConnected}</b>
                </div>
                <div>
                  Xero Entity: <b>{xeroEntity}</b>
                </div>
              </div>
            ) : (
              <div className="status-meta">
                <div>Not connected to Xero yet.</div>
              </div>
            )}
          </div>
          <span className={'pill-status ' + (connected ? 'ok' : 'off')}>{connected ? 'Connected' : 'Not connected'}</span>
        </div>
        {connected ? (
          <div
            className="btn btn-block"
            style={{
              marginTop: 16,
              background: 'var(--accent-soft)',
              color: 'var(--accent-ink)',
              border: '1px solid var(--accent)',
              cursor: 'default',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
            aria-disabled="true"
          >
            <Icon.Check /> Xero Connected
          </div>
        ) : null}
        {connected && (
          <>
            <button
              className="btn btn-ghost btn-block"
              style={{ marginTop: 10 }}
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : <><Icon.Link /> Disconnect from Xero</>}
            </button>
          </>
        )}
        {!connected && (
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 16 }}
            onClick={connectXero}
          >
            <Icon.Link /> Connect to Xero
          </button>
        )}
      </div>

      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} />
          <button className="btn btn-primary" onClick={next} disabled={!connected}>
            Save &amp; Next <Icon.Arrow />
          </button>
          {!connected && (
            <div className="step-reminder" role="note">
              <Icon.Info />
              Connect to Xero to continue.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// --- Step 4: Petty Cash Settings ---
const CURRENCY_CODES = {
  'Hong Kong Dollar': 'HKD',
  'Singapore Dollar': 'SGD',
  'Australian Dollar': 'AUD',
  'New Zealand Dollar': 'NZD',
  'Pound Sterling': 'GBP',
  'US Dollar': 'USD',
  'Indian Rupee': 'INR',
};
// state.entity.currency holds a currency_info uuid (Step 1 dropdowns submit
// uuids); resolve it to the ISO code via the fetched registry. The name-based
// map remains as a fallback for sessions saved before the uuid switch. Never
// render a bare uuid — while the registry is still loading, show nothing.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const currencyCode = (c, registry = []) => {
  const row = registry.find((r) => r.currency_id === c);
  if (row) return row.iso_code || row.currency_name;
  if (UUID_RE.test(c || '')) return '';
  return CURRENCY_CODES[c] || (c || '').split(' ')[0];
};

function MethodList({ title, methods, placeholder = 'Enter method name', onAdd, onChange, autoFilled = false }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const remove = (i) => {
    const copy = methods.slice();
    copy.splice(i, 1);
    onChange(copy);
  };

  const onDragStart = (i) => (e) => {
    setDragIdx(i);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(i));
      } catch {}
    }
  };
  const onDragOver = (i) => (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (overIdx !== i) setOverIdx(i);
  };
  const onDrop = (i) => (e) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const copy = methods.slice();
    const [moved] = copy.splice(dragIdx, 1);
    copy.splice(i, 0, moved);
    onChange(copy);
    setDragIdx(null);
    setOverIdx(null);
  };
  const onDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  const cancel = () => {
    setAdding(false);
    setName('');
  };
  const submit = () => {
    const v = name.trim();
    if (!v) return;
    onAdd(v);
    setName('');
    setAdding(false);
  };

  return (
    <div className="method-card open">
      <div className="method-head method-head-static">
        <span className="method-title">
          {title}
          {autoFilled && (
            <span className="method-sparkle" aria-hidden>
              <Icon.Sparkle />
            </span>
          )}
        </span>
      </div>
      <div className="method-body" style={{ display: 'block' }}>
        <ul className="method-list">
          {methods.map((m, i) => (
            <li
              className={'method-row' + (dragIdx === i ? ' is-dragging' : '') + (overIdx === i && dragIdx !== i ? ' is-drag-over' : '')}
              key={m + i}
              onDragOver={onDragOver(i)}
              onDrop={onDrop(i)}
              onDragLeave={() => {
                if (overIdx === i) setOverIdx(null);
              }}
            >
              <span className="method-name">{m}</span>
              <div className="method-actions">
                <button type="button" className="method-trash" aria-label={'Delete ' + m} onClick={() => remove(i)}>
                  <Icon.Trash />
                </button>
                <span
                  className="method-drag"
                  role="button"
                  aria-label={'Drag to reorder ' + m}
                  draggable
                  onDragStart={onDragStart(i)}
                  onDragEnd={onDragEnd}
                  title="Drag to reorder"
                >
                  <Icon.Grip />
                </span>
              </div>
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="method-add-form">
            <div className="method-add-field">
              <label>Name</label>
              <div className="field">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={placeholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                    if (e.key === 'Escape') cancel();
                  }}
                />
              </div>
            </div>
            <div className="method-add-actions">
              <button type="button" className="btn-cancel-outline" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="btn-mint-pill" disabled={!name.trim()} onClick={submit}>
                Add
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="method-add" onClick={() => setAdding(true)}>
            <Icon.Plus /> Add New Method
          </button>
        )}
      </div>
    </div>
  );
}

function MintCheck({ checked, onChange, ariaLabel }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={ariaLabel} className={'mint-check' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
      {checked && <Icon.CheckSm />}
    </button>
  );
}

// Shared account-code picker for the Account Code and Bill steps.
//
// The two steps differ in three ways, each kept as a prop rather than
// normalized away, because each is observable behavior:
//   - `header`      Bill renders a title/subtitle block above the list.
//   - `searchLabels` Account matches the typed query against the full
//                    "CODE · Name" label; Bill matches the raw code only.
//   - `labelAria`   Account's checkbox aria-label is the full label; Bill's
//                    is the bare code.
// `bodyStyle` carries the two steps' differing padding/display.
function AccountCodesCard({
  codes,
  value,
  onChange,
  labels,
  header = null,
  searchLabels = true,
  labelAria = true,
  bodyStyle = { padding: 20 },
}) {
  const [q, setQ] = useState('');
  const sel = value.selected || {};
  const isAll = value.all !== false;
  const isOn = (code) => (isAll ? sel[code] !== false : sel[code] === true);
  const allOn = codes.length > 0 && codes.every((c) => isOn(c));
  const labelOf = (code) => (labels && labels[code]) || code;
  const toggle = (code) => {
    if (isAll) {
      const next = {};
      codes.forEach((c) => {
        next[c] = true;
      });
      next[code] = false;
      onChange({ all: false, selected: next });
      return;
    }
    const cur = isOn(code);
    onChange({ all: false, selected: { ...sel, [code]: !cur } });
  };
  const toggleAll = () => {
    if (allOn) {
      const off = {};
      codes.forEach((c) => {
        off[c] = false;
      });
      onChange({ all: false, selected: off });
    } else {
      onChange({ all: true, selected: {} });
    }
  };
  const searchTextOf = (code) => (searchLabels ? labelOf(code) : code);
  const filtered = codes.filter((c) => searchTextOf(c).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="method-card acc-card open">
      {header}
      <div className="method-body" style={bodyStyle}>
        <div className="acc-search">
          <input type="text" placeholder="Search account code" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="acc-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </span>
        </div>
        <div className="acc-allrow">
          <span className="acc-all-label">{allOn ? 'Deselect all' : 'Select all'}</span>
          <MintCheck checked={allOn} onChange={toggleAll} ariaLabel="Select all" />
        </div>
        <ul className="acc-list">
          {filtered.map((code) => (
            <li className="acc-row" key={code}>
              <span className="acc-name">{labelOf(code)}</span>
              <MintCheck
                checked={isOn(code)}
                onChange={() => toggle(code)}
                ariaLabel={labelAria ? labelOf(code) : code}
              />
            </li>
          ))}
          {codes.length === 0 && <li className="acc-empty">Connect to Xero to load account codes</li>}
          {codes.length > 0 && filtered.length === 0 && <li className="acc-empty">No matching account code</li>}
        </ul>
      </div>
    </div>
  );
}

function PCSection({ title, fields, cardRef }) {
  const cardHasError = fields.some((f) => f.error);
  return (
    <div className={'pc-card' + (cardHasError ? ' is-error' : '')} ref={cardRef}>
      <div className="pc-title">{title}</div>
      {fields.map((f, i) => (
        <div className={'pc-field' + (f.error ? ' field-error' : '')} key={i}>
          <div className="pc-sub">{f.label}</div>
          <MintySelect
            value={f.value}
            onChange={f.onChange}
            options={f.options}
            placeholder="Select an option"
            searchable
            clearable
            onCreate={f.onAddNew}
            createNoun="contact"
          />
          {f.error && <div className="field-required">I&apos;ll need this one to keep going.</div>}
        </div>
      ))}
    </div>
  );
}

export function StepSalesSetting({ state, set, next, back, submitSalesMethods, submitOpeningBalance, fetchExistingSalesMethods, saveAndExit }) {
  // Save everything on this step: sales methods AND the opening balance/date.
  // submitOpeningBalance no-ops when the balance is empty, so a blank balance
  // never blocks Save & Next / Save & Exit — we persist whatever's filled in.
  // completeOnboarding re-submits the opening balance later; that's idempotent.
  const stepSubmit = async () => {
    const methodsResult = await submitSalesMethods();
    if (!methodsResult?.ok) return methodsResult;
    if (typeof submitOpeningBalance === 'function') {
      const balanceResult = await submitOpeningBalance();
      if (!balanceResult?.ok) return balanceResult;
    }
    return { ok: true };
  };
  const p = state.pettyCash;
  const upd = (k, v) => set({ pettyCash: { ...p, [k]: v } });
  const balanceRef = useRef(null);
  // Currency registry for the amount prefix — entity.currency is a uuid.
  const [currencyRegistry, setCurrencyRegistry] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchCurrencies().then((list) => { if (!cancelled) setCurrencyRegistry(list); });
    return () => { cancelled = true; };
  }, []);
  const [showBalanceError, setShowBalanceError] = useState(false);
  // While focused the field shows plain digits; commas and the trailing ".00"
  // are applied on blur (and on any value rehydrated from the backend).
  const [balanceFocused, setBalanceFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const balanceEmpty = p.openingBalance === undefined || p.openingBalance === null || String(p.openingBalance).trim() === '';

  // Server-authoritative "today" in Hong Kong time — caps the opening date so a
  // future date can't be selected. Falls back to an HK date derived in the
  // browser if the server call fails (the raw browser timezone isn't trusted).
  const dateRef = useRef(null);
  const [serverToday, setServerToday] = useState('');
  const [showDateError, setShowDateError] = useState(false);
  const hkTodayFallback = (() => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
    } catch {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  })();
  const openingMaxDate = serverToday || hkTodayFallback;
  const dateIsFuture = !!p.openingDate && p.openingDate > openingMaxDate;
  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_MODULE1_API_URL || 'http://localhost:5001').replace(/\/$/, '');
    let cancelled = false;
    fetch(`${base}/api/onboarding/server-time`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && d.today) setServerToday(d.today);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onBlocked = () => {
      setShowBalanceError(true);
      requestAnimationFrame(() => {
        if (balanceRef.current) {
          balanceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const input = balanceRef.current.querySelector('input');
          if (input) input.focus({ preventScroll: true });
        }
      });
    };
    window.addEventListener('onb-validation-blocked', onBlocked);
    return () => window.removeEventListener('onb-validation-blocked', onBlocked);
  }, []);

  const tryNext = async () => {
    if (balanceEmpty) {
      setShowBalanceError(true);
      requestAnimationFrame(() => {
        if (balanceRef.current) {
          balanceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const input = balanceRef.current.querySelector('input');
          if (input) input.focus({ preventScroll: true });
        }
      });
      return;
    }
    setShowBalanceError(false);
    if (dateIsFuture) {
      setShowDateError(true);
      requestAnimationFrame(() => {
        if (dateRef.current) dateRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setShowDateError(false);
    if (saving) return;
    // Save everything on this step (sales methods + opening balance/date).
    if (typeof submitSalesMethods === 'function') {
      setSaving(true);
      const result = await stepSubmit();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };
  const DEFAULT_ELECTRONIC = ['Visa', 'Alipay', 'WeChat Pay', 'Mastercard', 'UnionPay', 'Amex', 'Octopus'];
  const DEFAULT_DELIVERY = ['Foodpanda', 'Deliveroo', 'KeeTa'];
  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const isAutofilled = sameList(p.electronicMethods || [], DEFAULT_ELECTRONIC) && sameList(p.deliveryMethods || [], DEFAULT_DELIVERY);

  const [autoFilling, setAutoFilling] = useState(false);
  const resetDefaults = async () => {
    if (isAutofilled) {
      set({
        pettyCash: {
          ...p,
          electronicMethods: [],
          deliveryMethods: [],
        },
      });
      return;
    }
    if (autoFilling) return;
    setAutoFilling(true);
    let electronic = [...DEFAULT_ELECTRONIC];
    let delivery = [...DEFAULT_DELIVERY];
    if (typeof fetchExistingSalesMethods === 'function') {
      const existing = await fetchExistingSalesMethods();
      if (existing && Array.isArray(existing.electronic) && existing.electronic.length > 0) {
        electronic = existing.electronic;
      }
      if (existing && Array.isArray(existing.delivery) && existing.delivery.length > 0) {
        delivery = existing.delivery;
      }
    }
    set({
      pettyCash: {
        ...p,
        electronicMethods: electronic,
        deliveryMethods: delivery,
        expenseCodes: { all: true, selected: {} },
        openingDate: openingMaxDate || todayIso,
      },
    });
    setAutoFilling(false);
  };
  return (
    <>
      <div className="autofill-row">
        <button
          type="button"
          className={'autofill-btn' + (isAutofilled ? ' is-active' : '')}
          onClick={resetDefaults}
          aria-pressed={isAutofilled}
          aria-label={isAutofilled ? 'Clear auto-filled methods' : 'Auto fill default settings'}
        >
          <img src="/tab-logo-alt.png" alt="" className="autofill-logo" />
          <span className="autofill-label">{isAutofilled ? 'Revert' : 'Auto Fill'}</span>
          <span className="autofill-spark" aria-hidden>
            <Icon.Sparkle />
          </span>
        </button>
        <span className="autofill-hint">Not sure what to choose? I&apos;ll set some sensible defaults for you.</span>
      </div>
      <div className="page-head pc-page-head" style={{ textAlign: 'left', marginBottom: 18 }}>
        <div className="pc-head-row">
          <h2 style={{ fontSize: 30 }}>Type of sales method of your company</h2>
        </div>
        <p style={{ marginTop: 6 }}>Add the payment and delivery channels you accept. You can always go back to settings to edit options</p>
      </div>

      <div className="pc-stack">
        <MethodList
          title="Electronic"
          placeholder="Enter payment method name"
          methods={p.electronicMethods || []}
          autoFilled={isAutofilled}
          onAdd={(name) => upd('electronicMethods', [...(p.electronicMethods || []), name])}
          onChange={(list) => upd('electronicMethods', list)}
        />

        <MethodList
          title="Delivery"
          placeholder="Enter delivery method name"
          methods={p.deliveryMethods || []}
          autoFilled={isAutofilled}
          onAdd={(name) => upd('deliveryMethods', [...(p.deliveryMethods || []), name])}
          onChange={(list) => upd('deliveryMethods', list)}
        />

        <div className="pc-section-head">
          <div className="pc-section-title">Petty Cash Opening Balance</div>
          <div className="pc-section-sub">Set the starting point so future movements reconcile correctly.</div>
        </div>
        <div className={'pc-card' + (showBalanceError && balanceEmpty ? ' is-error' : '')} ref={balanceRef}>
          <div className={'pc-field' + (showDateError && dateIsFuture ? ' field-error' : '')} ref={dateRef}>
            <div className="pc-sub">
              Choose the first date that you wish to use <span className="pc-hint">(I&apos;ve put today&apos;s date in — click if you&apos;d like another)</span>
            </div>
            <MintyDatePicker
              value={p.openingDate || ''}
              onChange={(v) => {
                upd('openingDate', v);
                setShowDateError(false);
              }}
              placeholder="Select a date"
              maxDate={openingMaxDate}
            />
            {showDateError && dateIsFuture && <div className="field-required">That day hasn&apos;t happened yet! Pick an earlier one?</div>}
          </div>
          <div className={'pc-field' + (showBalanceError && balanceEmpty ? ' field-error' : '')}>
            <div className="pc-sub">Choose the beginning petty cash balance of the day</div>
            <div className="field">
              <div className="input-prefix">
                <div className="prefix">{currencyCode(state.entity.currency, currencyRegistry)}</div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={balanceFocused ? toAmountEditString(p.openingBalance) : formatAmount(p.openingBalance)}
                  onFocus={() => setBalanceFocused(true)}
                  onChange={(e) => {
                    const raw = acceptAmountInput(e.target.value);
                    if (raw === null) return; // past the digit limits — refuse the keystroke
                    upd('openingBalance', raw);
                    if (raw !== '') setShowBalanceError(false);
                  }}
                  onBlur={() => setBalanceFocused(false)}
                />
              </div>
            </div>
            {showBalanceError && balanceEmpty && <div className="field-required">I&apos;ll need a starting balance here.</div>}
          </div>
        </div>
      </div>

      <StepNav
        back={back}
        saveAndExit={saveAndExit}
        stepSubmit={stepSubmit}
        tryNext={tryNext}
        saving={saving}
      />
    </>
  );
}

export function StepAccountCode({ state, set, next, back, accountOptions, submitAccountCodes, saveAndExit }) {
  const stepSubmit = submitAccountCodes;
  const p = state.pettyCash;
  const upd = (k, v) => set({ pettyCash: { ...p, [k]: v } });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [showErrors, setShowErrors] = useState(false);

  const pcAccountRef = useRef(null);
  const depositAccountRef = useRef(null);
  const directorCodeRef = useRef(null);
  const cashSalesCodeRef = useRef(null);
  const discrepancyCodeRef = useRef(null);

  const opts = accountOptions || {};
  const labelsOf = (list) => (list || []).map((o) => o.label);
  const bankLabels = labelsOf(opts.bank);
  // Hide each chosen bank from the other dropdown — they can't be the same.
  const pcBankOptions = bankLabels.filter((l) => l !== p.depositAccount);
  const depositBankOptions = bankLabels.filter((l) => l !== p.pcAccount);
  const directorLabels = labelsOf(opts.director);
  const cashSaleLabels = labelsOf(opts.cashSale);
  const discrepancyLabels = labelsOf(opts.discrepancy);
  const expenseCodes = (opts.expense || []).map((e) => e.code);
  const expenseLabels = Object.fromEntries(
    (opts.expense || []).map((e) => [e.code, e.name ? `${e.code} · ${e.name}` : e.code])
  );

  const missingFields = [
    { key: 'pcAccount', empty: !p.pcAccount, ref: pcAccountRef },
    { key: 'depositAccount', empty: !p.depositAccount, ref: depositAccountRef },
    { key: 'directorCode', empty: !p.directorCode, ref: directorCodeRef },
    { key: 'cashSalesCode', empty: !p.cashSalesCode, ref: cashSalesCodeRef },
    { key: 'discrepancyCode', empty: !p.discrepancyCode, ref: discrepancyCodeRef },
  ];

  const tryNext = async () => {
    if (saving) return;
    const firstMissing = missingFields.find((f) => f.empty);
    if (firstMissing) {
      setShowErrors(true);
      requestAnimationFrame(() => {
        const node = firstMissing.ref.current;
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setShowErrors(false);
    if (typeof submitAccountCodes === 'function') {
      setSaving(true);
      const result = await submitAccountCodes();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: 'left', marginBottom: 18 }}>
        <h2 style={{ fontSize: 30 }}>Account Code Setting</h2>
        <p style={{ marginTop: 6 }}>Map each cash flow to the right account in your ledger — these settings need manual input from you.</p>
      </div>

      <div className="pc-stack">
        <div className="pc-section-head" style={{ marginTop: 0, paddingTop: 0, border: 0 }}>
          <div className="pc-section-title">Petty Cash Account Codes</div>
          <div className="pc-section-sub">Only selected account code will appear when adding an expense in Petty Cash.</div>
        </div>
        <AccountCodesCard
          codes={expenseCodes}
          labels={expenseLabels}
          value={p.expenseCodes || { all: true, selected: {} }}
          onChange={(v) => upd('expenseCodes', v)}
        />

        <PCSection
          title="Petty Cash Account"
          cardRef={pcAccountRef}
          fields={[
            {
              label: (
                <>
                  Select Bank account in Xero that will record petty cash movement. You may need to first add a bank account in Xero.{' '}
                  <a
                    href="https://my.xero.com/"
                    className="pc-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    (Link)
                  </a>
                </>
              ),
              value: p.pcAccount || '',
              onChange: (v) => upd('pcAccount', v),
              options: pcBankOptions,
              error: showErrors && !p.pcAccount,
            },
          ]}
        />

        <PCSection
          title="Deposit Bank Account"
          cardRef={depositAccountRef}
          fields={[
            {
              label: 'Select bank account in Xero for actual bank that your company use to deposit and withdraw cash.',
              value: p.depositAccount || '',
              onChange: (v) => upd('depositAccount', v),
              options: depositBankOptions,
              error: showErrors && !p.depositAccount,
            },
          ]}
        />

        <PCSection
          title="Director Personal Account"
          cardRef={directorCodeRef}
          fields={[
            {
              label: 'Select account code for the Advance Payment from director',
              value: p.directorCode || '',
              onChange: (v) => upd('directorCode', v),
              options: directorLabels,
              error: showErrors && !p.directorCode,
            },
          ]}
        />

        <PCSection
          title="Cash Sales"
          cardRef={cashSalesCodeRef}
          fields={[
            {
              label: 'Select account code for cash sales',
              value: p.cashSalesCode || '',
              onChange: (v) => upd('cashSalesCode', v),
              options: cashSaleLabels,
              error: showErrors && !p.cashSalesCode,
            },
          ]}
        />

        <div className="pc-section-head">
          <div className="pc-section-title">
            Cash Discrepancy — Other Expense
            <span className="info-tip" tabIndex="0" aria-label="More info">
              <Icon.Info />
              <span className="info-tip-pop" role="tooltip">
                <p>Account code to record the outliers such as extra cash or lost cash.</p>
                <p>Extra cash may be due to tips from the customer.</p>
                <p>Lost cash may be due to lost receipts.</p>
              </span>
            </span>
          </div>
          <div className="pc-section-sub">Where to post unaccounted-for cash differences when reconciling petty cash.</div>
        </div>
        <PCSection
          title="Discrepancy — Other Expense"
          cardRef={discrepancyCodeRef}
          fields={[
            {
              label: 'Select account code to record Cash Discrepancy',
              value: p.discrepancyCode || '',
              onChange: (v) => upd('discrepancyCode', v),
              options: discrepancyLabels,
              error: showErrors && !p.discrepancyCode,
            },
          ]}
        />
      </div>

      <StepNav
        back={back}
        saveAndExit={saveAndExit}
        stepSubmit={stepSubmit}
        tryNext={tryNext}
        saving={saving}
      />
    </>
  );
}

export function StepOthers({ state, set, next, back, accountOptions, submitContacts, createContact, saveAndExit, isLastContentStep }) {
  const stepSubmit = submitContacts;
  const p = state.pettyCash;
  const upd = (k, v) => set({ pettyCash: { ...p, [k]: v } });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [showErrors, setShowErrors] = useState(false);

  const directorContactRef = useRef(null);
  const cashSaleContactRef = useRef(null);
  const discrepancyContactRef = useRef(null);

  const contactLabels = ((accountOptions || {}).contacts || []).map((c) => c.label);

  const missingFields = [
    { key: 'directorContact', empty: !p.directorContact, ref: directorContactRef },
    { key: 'cashSaleContact', empty: !p.cashSaleContact, ref: cashSaleContactRef },
    { key: 'discrepancyContact', empty: !p.discrepancyContact, ref: discrepancyContactRef },
  ];

  const tryNext = async () => {
    if (saving) return;
    const firstMissing = missingFields.find((f) => f.empty);
    if (firstMissing) {
      setShowErrors(true);
      requestAnimationFrame(() => {
        const node = firstMissing.ref.current;
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setShowErrors(false);
    if (typeof submitContacts === 'function') {
      setSaving(true);
      const result = await submitContacts();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: 'left', marginBottom: 22 }}>
        <h2 style={{ fontSize: 30 }}>Contact Setup</h2>
        <p style={{ marginTop: 6 }}>Choose the Xero contacts used for the director&apos;s account, cash sales, and cash discrepancy.</p>
      </div>

      <div className="pc-stack">
        <PCSection
          title="Director&apos;s Contact"
          cardRef={directorContactRef}
          fields={[
            {
              label: 'Select Director or Responsible person',
              value: p.directorContact || '',
              onChange: (v) => upd('directorContact', v),
              options: contactLabels,
              error: showErrors && !p.directorContact,
              onAddNew: createContact,
            },
          ]}
        />

        <PCSection
          title="Cash Sales Contact"
          cardRef={cashSaleContactRef}
          fields={[
            {
              label: 'Select the Customer contact for cash sales',
              value: p.cashSaleContact || '',
              onChange: (v) => upd('cashSaleContact', v),
              options: contactLabels,
              error: showErrors && !p.cashSaleContact,
              onAddNew: createContact,
            },
          ]}
        />

        <PCSection
          title="Discrepancy Contact"
          cardRef={discrepancyContactRef}
          fields={[
            {
              label: 'Select the contact used to record cash discrepancies',
              value: p.discrepancyContact || '',
              onChange: (v) => upd('discrepancyContact', v),
              options: contactLabels,
              error: showErrors && !p.discrepancyContact,
              onAddNew: createContact,
            },
          ]}
        />
      </div>

      <StepNav
        back={back}
        saveAndExit={saveAndExit}
        stepSubmit={stepSubmit}
        tryNext={tryNext}
        saving={saving}
        isLastContentStep={isLastContentStep}
      />
    </>
  );
}

// --- Step 7: Bill Settings ---

export function StepBills({ state, set, next, back, accountOptions, submitBills, saveAndExit, isLastContentStep }) {
  const stepSubmit = submitBills;
  const b = state.bills;
  const upd = (k, v) => set({ bills: { ...b, [k]: v } });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const billCodes = ((accountOptions || {}).bill || []).map((e) => e.code);
  const billLabels = Object.fromEntries(
    ((accountOptions || {}).bill || []).map((e) => [e.code, e.name ? `${e.code} · ${e.name}` : e.code])
  );

  const tryNext = async () => {
    if (saving) return;
    if (typeof submitBills === 'function') {
      setSaving(true);
      const result = await submitBills();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: 'left', marginBottom: 18 }}>
        <h2 style={{ fontSize: 30 }}>Payment Settings</h2>
        <p style={{ marginTop: 6 }}>Choose account code for expenses that will incur with supporting documents.</p>
      </div>

      <div className="pc-stack">
        <AccountCodesCard
          codes={billCodes}
          labels={billLabels}
          value={b.billCodes || { all: true, selected: {} }}
          onChange={(v) => upd('billCodes', v)}
          // Bill searches the raw code and labels its checkboxes with the bare
          // code, unlike the Account Code step which uses the full label.
          searchLabels={false}
          labelAria={false}
          bodyStyle={{ display: 'block' }}
          header={
            <div className="method-head method-head-static" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
              <div className="method-title">Payment Account Code</div>
              <div className="acc-sub">Only selected account code will appear when adding a payment in Payment.</div>
            </div>
          }
        />
      </div>

      <StepNav
        back={back}
        saveAndExit={saveAndExit}
        stepSubmit={stepSubmit}
        tryNext={tryNext}
        saving={saving}
        isLastContentStep={isLastContentStep}
      />
    </>
  );
}

// --- Step 8: User Invite ---
const ROLES = ['Admin', 'Accountant', 'Shop Manager', 'Cashier'];

// Display label ↔ backend role value (matches Settings' _normalize_role_name).
const roleToValue = (label) => (label || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const roleLabel = (value) => (value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function StepInvite({ state, set, next, back, submitInvite, cancelInvite, saveAndExit }) {
  const list = state.invites.filter((x) => x.email && x.email.includes('@'));
  const [form, setForm] = useState({ first: '', last: '', email: '', role: '' });
  const notify = useToast();
  // Rows whose long name/email is expanded (wrapped) instead of truncated.
  const [expandedRows, setExpandedRows] = useState({});
  const toggleExpanded = (key) => setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  // Confirmation modal nudging the user to invite an accountant — the later
  // steps need expertise. Shown automatically on arrival at the Invite step
  // (right after Save & Next on Select Module) and again on "Skip for now".
  const [confirmSkip, setConfirmSkip] = useState(true);
  const [sending, setSending] = useState(false);
  // Portal the modal to <body> so its fixed overlay can't be clipped to a
  // transformed/overflow ancestor (which left the grey backdrop covering only
  // part of the page on desktop). Guarded for SSR — body isn't there yet.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const setF = (k, v) => setForm({ ...form, [k]: v });
  // Show the "invalid email" hint only once the user has interacted with the
  // field, so a pristine empty form doesn't start out shouting an error.
  const [emailTouched, setEmailTouched] = useState(false);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const emailInvalid = emailTouched && form.email.trim() !== '' && !emailOk;
  // Don't gate the button on email format — let the user click Send and get an
  // explicit toast explaining why, instead of a silently-disabled button.
  const canSend = form.first.trim() && form.last.trim() && form.email.trim() && form.role && !sending;

  const send = async () => {
    if (!canSend) return;
    if (!emailOk) {
      setEmailTouched(true);
      notify.error("That doesn't look like an email. Try user@domain.com?");
      return;
    }
    setSending(true);
    const sentEmail = form.email.trim();
    const result = await submitInvite({
      email: sentEmail,
      role: roleToValue(form.role),
      first_name: form.first.trim(),
      last_name: form.last.trim(),
    });
    setSending(false);
    if (!result.ok) {
      notify.error(result.error);
      return;
    }
    // If the backend couldn't actually send the email (Brevo/SMTP failure →
    // email_sent: false), treat the invite as failed: surface an error and do
    // NOT add it to the pending list — the invitee received nothing. The form
    // is left filled so the user can retry without re-typing.
    if (result.emailSent === false) {
      notify.error(`That invite didn't reach ${sentEmail}! Want to try again?`);
      return;
    }
    const inv = result.invitation || {};
    const nextList = [
      ...list,
      { id: inv.id, first: form.first.trim(), last: form.last.trim(), email: inv.email || sentEmail, role: inv.role || roleToValue(form.role) },
    ];
    set({ invites: nextList });
    setForm({ first: '', last: '', email: '', role: '' });
    setEmailTouched(false);
    notify.success(`Invitation sent to ${sentEmail}.`);
  };

  const cancel = () => {
    setForm({ first: '', last: '', email: '', role: '' });
    setEmailTouched(false);
  };
  const removeRow = async (i) => {
    const target = list[i];
    if (target?.id) {
      const result = await cancelInvite(target.id);
      if (!result.ok) {
        notify.error(result.error);
        return;
      }
    }
    set({ invites: list.filter((_, idx) => idx !== i) });
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: 'center', marginBottom: 18 }}>
        <h2 style={{ fontSize: 30 }}>User Invite</h2>
        <p style={{ marginTop: 6 }}>
          Heads up — users can be added or removed any time from <b>Settings → Users</b>.
        </p>
      </div>

      <div className="invite-grid">
        <div className="invite-card">
          <div className="invite-card-head">
            <div className="invite-card-title">Invite User</div>
            <button type="button" className="invite-close" onClick={cancel} aria-label="Clear">
              <Icon.Close />
            </button>
          </div>

          <div className="invite-field">
            <label>
              First Name<span className="req">*</span>
            </label>
            <div className="field">
              <input type="text" placeholder="Enter first name" value={form.first} onChange={(e) => setF('first', e.target.value)} />
            </div>
          </div>
          <div className="invite-field">
            <label>
              Last Name<span className="req">*</span>
            </label>
            <div className="field">
              <input type="text" placeholder="Enter last name" value={form.last} onChange={(e) => setF('last', e.target.value)} />
            </div>
          </div>
          <div className="invite-field">
            <label>
              Email Address<span className="req">*</span>
            </label>
            <div className={'field' + (emailInvalid ? ' field-error' : '')}>
              <input
                type="email"
                placeholder="Enter email address"
                value={form.email}
                onChange={(e) => setF('email', e.target.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={emailInvalid}
              />
            </div>
          </div>
          <div className="invite-field">
            <label>
              Role<span className="req">*</span>
            </label>
            <MintySelect value={form.role} onChange={(v) => setF('role', v)} options={ROLES} placeholder="Select a role" />
          </div>

          <div className="invite-actions">
            <button type="button" className="btn btn-ghost btn-cancel" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!canSend} onClick={send}>
              {sending ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
        </div>

        {list.length > 0 && (
          <div className="invite-list">
            <div className="invite-list-title">Pending invitations · {list.length}</div>
            {list.map((u, i) => {
              const hasName = (u.first || u.last);
              const initials = hasName
                ? `${(u.first[0] || '').toUpperCase()}${(u.last[0] || '').toUpperCase()}`
                : (u.email[0] || '').toUpperCase();
              const rowKey = u.id || u.email || i;
              const expanded = !!expandedRows[rowKey];
              return (
                <div className="invite-row-card" key={rowKey}>
                  <div className="invite-avatar">{initials}</div>
                  <button
                    type="button"
                    className={'invite-meta' + (expanded ? ' is-expanded' : '')}
                    onClick={() => toggleExpanded(rowKey)}
                    title={expanded ? 'Click to collapse' : 'Click to show full address'}
                  >
                    <div className="invite-name">{hasName ? `${u.first} ${u.last}`.trim() : u.email}</div>
                    {hasName && <div className="invite-email">{u.email}</div>}
                  </button>
                  <span className="invite-role">{roleLabel(u.role)}</span>
                  <button type="button" className="icon-x" onClick={() => removeRow(i)} aria-label="Remove">
                    <Icon.Close />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} />
          <button
            className="btn btn-primary"
            onClick={() => {
              // Both "Continue" (invites added) and "Add later" (no invites)
              // just advance — "Add later" means "keep going", so resume never
              // pins the user back to Invite.
              next();
            }}
          >
            {list.length > 0 ? 'Continue' : 'Add later'} <Icon.Arrow />
          </button>
        </div>
      </div>

      {confirmSkip && mounted && ReactDOM.createPortal(
        <div
          className="skip-modal-overlay"
          role="presentation"
          onClick={() => setConfirmSkip(false)}
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
            aria-labelledby="skip-modal-title"
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
            <p id="skip-modal-title" className="skip-modal-lead">
              The following setup steps require accounting expertise.
            </p>
            <p className="skip-modal-body">
              Xero recommends you invite your accountant or bookkeeper to assist you with these steps.
            </p>
            <p className="skip-modal-body" style={{ marginBottom: 32 }}>Do you want to invite users now?</p>
            <div
              className="skip-modal-actions"
              style={{ display: 'flex', justifyContent: 'center', gap: 10 }}
            >
              <button type="button" className="btn btn-primary" onClick={() => setConfirmSkip(false)}>
                Ok
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// --- Step 9: All Set ---
/**
 * Step 9 — All Set. Figma 01-E (`1705:1355`).
 *
 * THIS SCREEN COMMITS ONBOARDING, which is new and is the whole reason it can say what it
 * says. The frame states the trial HAS STARTED and names the day it ends; that was
 * unprintable while the trials only began as the payer left, so `completeOnboarding()`
 * now runs on arrival and hands back the committed `trial_end`. "Go to entity list" is
 * afterwards only a redirect.
 *
 * Nothing here predicts. If the date does not come back the row is dropped rather than
 * filled with today + 30 — a wrong date about billing is worse than a missing one.
 */
export function StepAllSet({
  state,
  token,
  modulePlans,
  completeOnboarding,
  exitToEntityList,
}) {
  const [trialEnd, setTrialEnd] = useState(null);
  const [committing, setCommitting] = useState(true);
  const [billingOpen, setBillingOpen] = useState(false);
  // `null` while unknown, so the nudge renders in NEITHER state until the answer is in.
  // Showing "add a payment method" and then retracting it is the flicker the subscription
  // summary was just fixed for.
  const [hasConsent, setHasConsent] = useState(null);
  const toast = useToast();

  /* COMMITTED ONCE, AND THE HANDLE IS KEPT. This ref does two jobs.
   *
   * It is the run-once guard: StrictMode invokes effects twice in development and this one
   * POSTs. Both halves are idempotent — finalize is guarded server-side by
   * `status == "onboarding"` and the opening balance is documented as re-submittable — so
   * a double call is survivable rather than fine, which is not a reason to make one.
   *
   * AND IT IS THE PROMISE ANYTHING THAT NAVIGATES MUST WAIT ON, which is the half that
   * matters. Committing is two round trips, and the billing dialog on this screen now
   * LEAVES THE PAGE when it finishes. A payer quick enough to confirm a card before
   * finalize returns would unload the tab out from under that request: consent recorded,
   * the entity still `onboarding`, and no trial ever started — silently, and precisely the
   * state this screen tells them is impossible. The exit button is already held by
   * `committing`; the dialog's exit is held by awaiting this.
   *
   * It never rejects. `completeOnboarding` reports failure by resolving `{ok: false}`, and
   * anything thrown is caught below — so a failed commit still lets the payer leave rather
   * than trapping them on a screen whose buttons no longer work.
   */
  const commit = useRef(null);
  useEffect(() => {
    if (commit.current) return;
    if (typeof completeOnboarding !== 'function') {
      commit.current = Promise.resolve();
      setCommitting(false);
      return;
    }
    commit.current = (async () => {
      try {
        const result = await completeOnboarding();
        if (!result?.ok) toast.error(result?.error || "Couldn't finish setting up.");
        setTrialEnd(result?.trialEnd || null);
      } catch {
        toast.error("Couldn't finish setting up.");
      } finally {
        setCommitting(false);
      }
    })();
  }, [completeOnboarding, toast]);

  // Whether this entity is already authorised. Re-read after the billing sheet reports a
  // confirmation, which is the only thing here that can change the answer.
  useEffect(() => {
    if (!token || !state?.entity?.id) return;
    let live = true;
    fetchBillingStatus(token, state.entity.id)
      .then((res) => {
        if (live) setHasConsent(!!res?.has_billing_consent);
      })
      // A payer with no Stripe customer is the ordinary case here, not an error. Treated
      // as "no consent", which is the truth and shows the nudge.
      .catch(() => {
        if (live) setHasConsent(false);
      });
    return () => {
      live = false;
    };
    // Read ONCE. It used to re-run after a confirmation, through a `cardEpoch` counter the
    // billing sheet's onDone bumped — but confirming now leaves the page, so there is no
    // longer a moment where this screen has to notice the answer changing under it.
  }, [token, state?.entity?.id]);

  /* "Petty Cash", "Payment Request", or — with both — "SuperMinty", the name step 2 gives
     the pair. One line covers the sentence and the Module enabled row, so the two cannot
     drift into describing the same choice differently. */
  const picked = state.modules || [];
  const moduleLabel =
    picked.length > 1
      ? 'SuperMinty'
      : (MODULES.find((m) => m.id === picked[0]) || {}).title || 'your module';

  const trialDays = Number(modulePlans?.trial_period_days || 30);
  // Formatted from the SERVER's date. This is not the `firstChargeLabel` that was deleted:
  // that one added days to today in the browser and called the result a fact.
  /* Both requests in, so the block can be drawn. `committing` covers the trial date and
     `hasConsent === null` covers the nudge and the buttons; either outstanding means part
     of what is about to be shown is still unknown. */
  const ready = !committing && hasConsent !== null;

  const trialEndLabel = trialEnd
    ? formatDate(new Date(trialEnd), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        upper: false,
      })
    : null;

  return (
    <>
      {/* Not in the frame, because a still frame cannot draw it. This is the one screen in
          the flow that has earned it. */}
      <Confetti count={42} />
      <div className="celebrate">
        <div className="check-circle">
          <Icon.CheckBig />
        </div>
        <h2 className="allset-title">You&apos;re all set!</h2>
      </div>

      <div className="mascot-video-wrap">
        <img className="mascot-video" src="/all-set.png" alt="" aria-hidden="true" />
      </div>

      {/* NOTHING HERE APPEARS OUT OF NOWHERE. Everything below waits on two requests — the
          commit, which returns the trial's end date, and the billing status, which decides
          whether there is anything left to nudge about — and until both land the block is
          drawn as a skeleton of the same shape.

          It used to resolve in pieces: the facts rendered instantly with a missing date
          row, then the nudge appeared, then "Add Payment Now" appeared above an exit button
          that had already been sitting there as a text link and now became a filled one.
          Each part was individually correct and the whole thing read as a glitch. */}
      {ready ? null : (
        <div
          className="allset-skeleton"
          role="status"
          aria-label="Finishing setting up your entity"
        >
          <span className="skel-bar sk-lede" aria-hidden="true" />
          <div className="sk-rows" aria-hidden="true">
            <span className="skel-bar" />
            <span className="skel-bar" />
            <span className="skel-bar" />
            <span className="skel-bar" />
            <span className="skel-bar" />
            <span className="skel-bar" />
          </div>
          <span className="skel-bar sk-nudge" aria-hidden="true" />
          <div className="sk-actions" aria-hidden="true">
            <span className="skel-bar sk-btn" />
            <span className="skel-bar sk-btn is-link" />
          </div>
        </div>
      )}

      {/* One left-aligned column, centred on the page. The sentence, the label/value pair
          and the nudge share a left edge; only the buttons below are centred. */}
      {ready ? (
      <div className="allset-facts">
        <p className="allset-lede">
          Your {trialDays}-day {moduleLabel} trial has started.
        </p>

        <dl className="allset-grid">
          <dt>Entity</dt>
          <dd className="is-entity">{state.entity.name || '—'}</dd>
          <dt>Module enabled</dt>
          <dd>{moduleLabel}</dd>
          {/* Dropped entirely when the server gave us no date — see the note above. */}
          {trialEndLabel ? (
            <>
              <dt>Trial period until</dt>
              <dd>{trialEndLabel}</dd>
            </>
          ) : null}
        </dl>

        {/* Nothing to nudge someone about who has already authorised this entity. Gated on
            CONSENT, not on owning a card: a payer can hold a card this entity was never
            authorised against, and only consent decides whether the trial converts. */}
        {hasConsent === false ? (
          <p className="allset-nudge">
            Avoid interruption by adding a payment method today.
          </p>
        ) : null}
      </div>
      ) : null}

      {/* Both buttons or neither: which of them belongs here is one of the things the
          billing status decides, so the row arrives assembled with the facts above it. */}
      {ready ? (
        <div className="allset-actions">
          {hasConsent ? null : (
            <button
              type="button"
              className="btn btn-primary allset-pay"
              onClick={() => setBillingOpen(true)}
            >
              Add Payment Now
            </button>
          )}
          {/* A text button beneath the primary, as the frame draws it — and promoted to
              the filled one when it is the only action left, so the screen does not end on
              a link. */}
          <button
            type="button"
            className={hasConsent ? 'btn btn-primary allset-pay' : 'allset-exit'}
            onClick={exitToEntityList}
            disabled={committing}
          >
            Go to entity list <Icon.Arrow />
          </button>
        </div>
      ) : null}

      {billingOpen && state.entity?.id ? (
        <BillingSheet
          token={token}
          entityId={state.entity.id}
          onClose={() => setBillingOpen(false)}
          /* CONFIRMING HERE FINISHES ONBOARDING. All Set is the terminal screen — a card
             was the last outstanding thing on it, and leaving is all that follows — so
             both routes through this dialog go straight to the entity list rather than
             returning to a screen whose only remaining button says the same.

             Both routes, deliberately: Done after adding a card and Confirm after picking
             a saved one each record consent, so neither is less finished than the other.

             CLOSING IS STILL NOT FINISHING. The X, Esc and the backdrop go through
             `onClose` above and leave the payer here, which is the distinction this dialog
             has protected from the start.

             No toast and no state refresh: `exitToEntityList` assigns
             `window.location.href`, so a toast fired first is never read and the state it
             would refresh belongs to a screen that is going away. */
          onDone={async () => {
            setBillingOpen(false);
            // NOT before the commit lands — see `commit` above. Navigating here while
            // finalize is still in flight cancels it, and the payer leaves with a card
            // authorised against an entity whose trial never started.
            await commit.current;
            exitToEntityList();
          }}
        />
      ) : null}
    </>
  );
}