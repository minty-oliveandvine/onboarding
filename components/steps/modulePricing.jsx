// The module cards, and the arithmetic behind the Step 2 subscription summary.
// Extracted verbatim from OnboardingSteps.
//
// THE BUNDLE IS THE DISCOUNT. /api/onboarding/plans returns per-module prices plus a
// bundle price and the codes it covers; when the picked set is exactly those codes the
// bundle price applies, otherwise the standalone prices are summed. There is no separate
// discount field, and inventing one would double-count.


// --- Step 2: Select Module ---
// `tile` and `art` come off the card exports rather than being derived from `accent`:
// the design gives each module its own tile wash and its own illustration size (Petty
// Cash 80px, Payment Request 95px), and a colour-mix of the accent landed near neither.
// `accent` is kept because the illustration inherits it as `currentColor`.

import CardBrand from '../CardBrand';
import { formatAmount } from '@/lib/amount';
import { MODULE_ID_BY_CODE } from '../../lib/modules';
export const MODULES = [
  { id: 'pettyCash', title: 'Petty Cash', desc: 'Track and reimburse small office expenses with receipt capture and instant approvals.', img: '/pettycash-icon.png', accent: '#f5b945', tile: '#FFF7EC', art: 80, price: '280 HKD per Month' },
  { id: 'bills', title: 'Payment Request', desc: 'Capture vendor payments, schedule payments, and reconcile with your accounting ledger.', img: '/payment-icon.png', accent: '#3aa6f5', tile: '#EDF5FC', art: 95, price: '280 HKD per Month' },
];

// Backend module codes → the ids used by MODULES / state.modules above, so the
// live plan catalog from /api/onboarding/plans can be matched to the picked cards.

/** Index the live plan catalog by frontend module id (empty when it didn't load). */
export function plansByModuleId(catalog) {
  const byId = {};
  (catalog?.plans || []).forEach((p) => {
    const id = MODULE_ID_BY_CODE[p.code];
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
export function money(symbol, value) {
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
export function trimZeroCents(text) {
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
export function priceSelection(catalog, picked) {
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
export function pricedRows(catalog, selected) {
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
export function ModuleSubscriptionSummary({ catalog, selected, card, cardLoading, onOpenBilling }) {
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
