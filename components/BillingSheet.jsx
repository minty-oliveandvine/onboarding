'use client';

import {
  AddressElement,
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

import {
  authorizeBilling,
  BillingError,
  confirmCardSetup,
  fetchBillingAccounts,
  startCardSetup,
} from '@/lib/billing';
import CardBrand from './CardBrand';
import Icon from './Icon';

/**
 * The billing sheet — pick the card, agree to be billed for this entity.
 *
 * It was called "Buy now" until the name outlived the thing: nothing here buys anything,
 * as the paragraph below has always said, and the dialog now titles itself "Payment
 * Methods" or "New billing account" depending on which half of it the payer is in.
 *
 * THREE FRAMES, ONE DIALOG. Figma section 01 draws this as 01-L (the card picker), 01-D
 * (the new-billing-account form) and 01-J (the success card). They are three states of one
 * component rather than three dialogs, because two of them are reached from the third and
 * the payer never sees more than one at a time. Each has its own WIDTH — 481 / 880 / 435
 * in the frame — which is why `.billing-sheet` takes a state modifier instead of a single
 * max-width.
 *
 * WHAT THIS DOES NOT DO IS CHARGE. Nothing here takes money, today or at any point in the
 * trial. The 30-day trial still runs its full term; what the payer agrees to is what
 * happens at the END of it — Minty's trial-end job converts a trial to paid only when the
 * payer has both a card on file AND a consent row for that entity, and lets the trial
 * simply lapse otherwise. So this dialog is the difference between "converts" and
 * "expires", and the copy must never imply a charge is being made now.
 *
 * NO PRICE, NO TRIAL DATE, NO "NOTHING IS CHARGED TODAY" — AND THAT IS ON PURPOSE.
 *
 * The picker used to carry a sentence naming the amount, the trial end and the fact that
 * today costs nothing. The frame does not draw it and it has been removed. So the screen a
 * payer presses CONFIRM on — the consent itself — now states none of those things.
 *
 * They survive in two places, both outside this dialog: the footnote under the module
 * cards (`.module-caption`), and the mandate on the New billing account form, which a
 * payer choosing a card they already have never sees.
 *
 * Anyone auditing the billing copy should know that is where the disclosure went, and
 * anyone reinstating a line here should know the last one was removed deliberately rather
 * than lost. If it is ever wanted back, one quiet line above Confirm — not the paragraph
 * that was there.
 *
 * THE CARD NUMBER NEVER REACHES THIS APP. It is typed into a Stripe-hosted iframe
 * (`PaymentElement`) and confirmed straight against a SetupIntent with a client secret;
 * it does not touch this JavaScript, Minty's process, or any log. Nothing in this file
 * should ever be changed to read a card number out of the form.
 *
 * THE ACCOUNT DEFAULT IS NOT WHAT GETS CHARGED, and this paragraph used to say it was.
 *
 * A payer has one Stripe customer carrying one `invoice_settings.default_payment_method`,
 * and back when that was the only card Minty knew about, touching it re-pointed every
 * company the payer owned. It is not any more: each company is NOMINATED onto a card
 * (`store.card_for_entity`), and renewals and dunning read the nomination. Changing the
 * default moves nothing that is already running.
 *
 * What the default still decides is narrower, and worth knowing before changing it:
 *   - a company with NO nomination yet is nominated onto it at consent
 *     (`checkout._ensure_nominated`, which returns early when a nomination exists);
 *   - it is the row every card picker preselects;
 *   - a direct paid checkout uses it.
 */

/**
 * `loadStripe` per publishable key, at module scope.
 *
 * Stripe.js must not be re-initialised on every render — it injects a script tag, and
 * rebuilding it mid-flow tears down the mounted iframe. The key comes from the server
 * rather than an env var (Minty is what knows which Stripe account is configured), so
 * this is a small cache rather than the single top-level constant Stripe's docs show.
 */
const stripeByKey = new Map();

function stripeFor(key) {
  let promise = stripeByKey.get(key);
  if (!promise) {
    // Resolves to null rather than rejecting when the script can't be fetched at all — an
    // ad blocker, a privacy extension, a proxy blocking js.stripe.com. Left to reject it
    // becomes an unhandled rejection and the dialog sits on its skeleton saying nothing.
    promise = loadStripe(key).catch((err) => {
      console.error('Stripe.js failed to load', err);
      return null;
    });
    stripeByKey.set(key, promise);
  }
  return promise;
}

/** Stripe's own message when there is one — it is the only account of what the issuer said. */
function reason(err, fallback) {
  return err instanceof BillingError ? err.message : fallback;
}

/**
 * How the Elements iframes are themed, so the fields inside them are the fields the design
 * draws rather than Stripe's stock blue-grey.
 *
 * THIS IS THE ONLY LEGITIMATE WAY TO STYLE THEM. The card fields live in a cross-origin
 * iframe and no stylesheet of ours reaches inside; `appearance` is the supported channel,
 * and anything that tries to reach past it (selectors aimed at `.__PrivateStripeElement`,
 * measuring the iframe, injecting into it) breaks on Stripe's next release.
 *
 * Frozen at module scope because a new object identity on every render remounts the
 * Element — the payer would watch a half-typed card number disappear.
 */
const STRIPE_APPEARANCE = {
  theme: 'stripe',
  variables: {
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    fontSizeBase: '14px',
    colorText: '#16202E',
    colorTextPlaceholder: '#9AA6AC',
    colorDanger: '#b4231f',
    borderRadius: '8px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      border: '1px solid #D7DEE2',
      boxShadow: 'none',
      padding: '12px 14px',
    },
    '.Input:focus': {
      border: '1px solid #4FC7C7',
      boxShadow: '0 0 0 3px rgba(79, 199, 199, 0.18)',
      outline: 'none',
    },
    '.Label': {
      fontWeight: '600',
      fontSize: '13px',
      color: '#16202E',
    },
  },
};

/* Options objects, out here for the same reason: a fresh literal each render is a new
   prop, and these Elements remount when their options change identity. */
const PAYMENT_ELEMENT_OPTIONS = {
  layout: 'tabs',
  /* `terms.card: 'never'` suppresses Stripe's own mandate line, which is rendered inside
     the iframe and names the STRIPE ACCOUNT rather than Minty — in test mode that reads
     "Cash sandbox". Suppressing it moves the disclosure obligation to us, so the sentence
     in the form below is not decoration: it is the mandate, and it has to keep saying that
     a payment method is being stored and may be charged. */
  terms: { card: 'never' },
  /* The name and address are the AddressElement's. Left on, PaymentElement asks for them
     too and the payer fills the same fields twice. */
  fields: { billingDetails: { name: 'never', address: 'never' } },
};
const ADDRESS_ELEMENT_OPTIONS = { mode: 'billing', display: { name: 'full' } };

/**
 * 01-D — the new billing account form.
 *
 * Split out because `useStripe`/`useElements` only work INSIDE `<Elements>`, which can't be
 * mounted until the client secret has arrived.
 *
 * THE EMAIL AND COMPANY ARE THE ACCOUNT'S IDENTITY, not a copy of the payer's profile.
 * They land on `payer_billing_group` and are what Minty puts on the Stripe customer and
 * the invoice, which is why a payer can hold several accounts: one company each, separate
 * invoices, cards that may or may not be shared.
 *
 * BOTH ARE REQUIRED HERE, AND ONLY HERE. The columns are nullable and the API still
 * accepts a card with neither — that is what every account opened before this form
 * existed looks like, and what `_payer_identity` falls back to the user record for. So
 * this is a rule about what a payer may CREATE, not an invariant about what exists.
 * Anything reading these columns must still handle null.
 */
function CardForm({ setupIntent, onSaved, onBack, busyLabel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dead, setDead] = useState(false);
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [fieldErrors, setFieldErrors] = useState({ email: '', company: '' });

  /* Both fields are REQUIRED, and this runs before Stripe is touched at all.
   *
   * ORDER IS THE WHOLE POINT. `stripe.confirmSetup` attaches the card to the payer at
   * Stripe, and that is not undone by us returning early afterwards. Validating after it
   * would leave a card saved against no billing account every time someone submitted with
   * an empty company — a real payment method, attached, that the payer never sees the
   * result of. So nothing here may move below the confirmSetup call.
   *
   * The email pattern is deliberately loose. Anything stricter rejects addresses that are
   * perfectly valid (new TLDs, plus-addressing, quoted locals), and the only real proof an
   * address works is sending to it — so this catches typos, not edge cases.
   */
  const validate = () => {
    const next = { email: '', company: '' };
    const e = email.trim();
    const c = company.trim();
    if (!e) next.email = 'Enter the email address invoices should go to.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) next.email = "That email address doesn't look right.";
    if (!c) next.company = 'Enter the company name to invoice.';
    setFieldErrors(next);
    return !next.email && !next.company;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || busy) return;

    if (!validate()) return;

    setBusy(true);
    setError('');

    // The Element's own validation first, so an empty or malformed field is caught in the
    // form rather than coming back as a confirm failure.
    const submitted = await elements.submit();
    if (submitted.error) {
      setError(submitted.error.message || 'Please check the card details.');
      setBusy(false);
      return;
    }

    // `redirect: 'if_required'` keeps this on the page. The intent is card-only, so the
    // only redirect left is 3-D Secure, which Stripe runs in its own modal.
    const { error: confirmError, setupIntent: confirmed } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message || "That card couldn't be saved.");
      setBusy(false);
      return;
    }

    try {
      // The card exists at Stripe now; this is what makes it the account's — and for a
      // first card, what creates the customer. A failure here is not cosmetic: the method
      // would sit attached to nothing.
      //
      // The PAYMENT METHOD id rides along with the intent id: the caller nominates this
      // company onto that exact card rather than letting Minty infer it from the account
      // default, which is what stops one entity's confirmation moving the others.
      /* Both are required by the form above, so these are always real values by the
         time they get here. Still trimmed, and still `|| null` rather than '': the
         column is nullable and an empty string is a NAME — it would sit on the invoice
         as a blank company overriding the payer's own record. The guard is the form's;
         this is the belt. */
      await onSaved(confirmed?.id || setupIntent, confirmed?.payment_method, {
        email: email.trim() || null,
        company: company.trim() || null,
      });
    } catch (err) {
      setError(
        reason(
          err,
          "Your card was saved with our payment provider, but we couldn't finish. Refresh and check before trying again.",
        ),
      );
      setBusy(false);
    }
  };

  return (
    /* `noValidate` turns off the BROWSER'S validation UI, not ours: `required` stays on
       both inputs so assistive tech announces them, but the messages are the ones below
       rather than a native bubble in the corner of the viewport, which on a portalled
       dialog can render somewhere the payer is not looking. */
    <form onSubmit={submit} className="billing-form" noValidate>
      <div className="billing-field">
        <label className="billing-label" htmlFor="billing-email">
          Email
        </label>
        <input
          id="billing-email"
          className={'billing-input' + (fieldErrors.email ? ' is-invalid' : '')}
          type="email"
          required
          autoComplete="email"
          placeholder="name@company.com"
          value={email}
          /* The error clears as soon as they start fixing it. Left until the next submit,
             a message sits under a field the payer has already corrected. */
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: '' }));
          }}
          disabled={busy}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? 'billing-email-error' : undefined}
        />
        {fieldErrors.email ? (
          <p className="billing-fielderror" id="billing-email-error">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="billing-field">
        <label className="billing-label" htmlFor="billing-company">
          Billing company
        </label>
        <input
          id="billing-company"
          className={'billing-input' + (fieldErrors.company ? ' is-invalid' : '')}
          type="text"
          required
          autoComplete="organization"
          placeholder="Company name"
          value={company}
          onChange={(e) => {
            setCompany(e.target.value);
            if (fieldErrors.company) setFieldErrors((f) => ({ ...f, company: '' }));
          }}
          disabled={busy}
          aria-invalid={fieldErrors.company ? true : undefined}
          aria-describedby={fieldErrors.company ? 'billing-company-error' : undefined}
        />
        {fieldErrors.company ? (
          <p className="billing-fielderror" id="billing-company-error">
            {fieldErrors.company}
          </p>
        ) : null}
      </div>

      {/* The design draws the card fields inside their own bordered block under a
          "Payment method" heading, which is also the honest boundary: everything in here
          is rendered by Stripe, in Stripe's iframe, and is the one part of this form we do
          not see the contents of. */}
      <div className="billing-field">
        <span className="billing-label">Payment method</span>
        <div className="billing-stripe">
          {/* `loaderror` is the Element itself failing to come up — a blocked
              js.stripe.com, a client secret it can't fetch, a key from another account.
              Left unhandled it logs to the console and shows an empty box forever, which
              is indistinguishable from a button that does nothing. */}
          <PaymentElement
            onLoadError={(event) => {
              console.error('Stripe PaymentElement failed to load', event);
              setDead(true);
              setError(
                event?.error?.message ||
                  "The card form couldn't load. If you're running an ad blocker or privacy extension, allow js.stripe.com and try again.",
              );
            }}
            options={PAYMENT_ELEMENT_OPTIONS}
          />

          {/* The billing name and address the issuer checks. Collected here rather than
              left out: the payer portal shows both on the saved card, and a method saved
              without them shows blanks a payer cannot fill in from anywhere. */}
          <div className="billing-address">
            <AddressElement options={ADDRESS_ELEMENT_OPTIONS} />
          </div>
        </div>
      </div>

      <p className="billing-mandate">
        By providing your payment method, you authorise Minty to charge applicable
        subscription fees in accordance with the Subscription Terms.{' '}
        {/* Placeholder, as on the subscription card: there is no terms page in this app
            yet, so the click is swallowed rather than jumping to the top of the dialog.
            This link is part of a mandate disclosure — it needs a real URL before the
            wording above is doing its job. */}
        <a href="#" onClick={(e) => e.preventDefault()}>
          (Details)
        </a>
      </p>

      {error ? (
        <p className="billing-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="billing-actions">
        {/* Cancel goes BACK to the picker, which is what the design's arrow says
            (▶ Cancel → 01-L). With no picker to go back to — a payer whose wallet is
            empty meets this form directly — it closes the dialog instead, because a
            Cancel that does nothing is worse than one that leaves. */}
        <button
          type="button"
          className="btn btn-ghost billing-cancel"
          onClick={onBack}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary billing-save"
          disabled={!stripe || busy || dead}
        >
          {busy ? busyLabel : 'Save billing account'}
        </button>
      </div>
    </form>
  );
}

/**
 * 01-J — the card was saved.
 *
 * A CONFIRMATION, NOT A RECEIPT. It is shown after the card is attached and this entity's
 * consent is recorded, and it still has to be true that nothing was charged.
 *
 * THE "default payment method" LINE IS TRUE, WHICH IS WHY IT IS HERE. Saving sends
 * `make_default: true`, so the card the payer just added is the account default by the
 * time this renders.
 *
 * It reads off `isDefault` anyway rather than being printed unconditionally. That is a
 * belt, not the old design decision: this sentence is a statement about which card gets
 * charged, and if promoting ever stops happening — Stripe refusing the customer update,
 * someone flipping the flag back — the sentence should disappear rather than quietly
 * become a lie on the screen that confirms the payer's billing.
 */
function CardAdded({ card, isDefault, onDone }) {
  // Done is the only control on this card, and the button that was focused a moment ago
  // (Save) has just unmounted — without this the focus falls to <body> and a keyboard
  // user is outside the dialog while looking at it.
  const doneRef = useRef(null);
  useEffect(() => {
    if (doneRef.current) doneRef.current.focus();
  }, []);

  const name = card
    ? [card.brand_label, card.last4].filter(Boolean).join(' ') || card.label
    : 'Your card';

  return (
    <div className="billing-done">
      {/* Heading and cat are ONE ROW, and a real one — the cat used to be positioned
          absolutely over the block, which meant it contributed no height and hung down
          past the heading into the space the body text occupies. As a flex row the row is
          as tall as whichever is taller, and everything below simply flows after it. */}
      <div className="billing-done-head">
        <p className="billing-done-title">
          New Card added
          <br />
          <span>Successfully</span>
        </p>
        <img
          className="billing-done-art"
          src="/assets/billing-cat-celebrate.png"
          alt=""
          aria-hidden="true"
        />
      </div>
      <p className="billing-done-body">
        <span className="billing-done-card">{name}</span> is added successfully.
      </p>
      {isDefault ? (
        <p className="billing-done-body">This card is set as the default payment method.</p>
      ) : null}
      <div className="billing-done-actions">
        <button
          ref={doneRef}
          type="button"
          className="btn btn-primary billing-done-btn"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * @param {object}   props
 * @param {string}   props.token      onboarding JWT
 * @param {string}   props.entityId   the entity being authorised
 * @param {?string}  props.nominatedId the card this entity is billed to today, if any —
 *                                the row the picker opens on. Absent is fine and means
 *                                "nothing nominated yet".
 * @param {Function} props.onClose    dismissed — the caller keeps them on the step
 * @param {Function} props.onDone     consent recorded; the caller flips its own state
 *
 * CLOSING DOES NOT NAVIGATE. The X, Esc and a click on the backdrop all mean "not now,
 * I'm still reading" and leave the payer on the step — a stray click outside a dialog is
 * not a decision about billing.
 *
 * THE CARD IS OPTIONAL, AND THIS DIALOG IS NEVER IN ANYBODY'S WAY. It is opened only when
 * a payer asks for it — "Add card" in the subscription summary, or the All Set step — and
 * Save & Next moves onboarding along without it. It used to carry a "Do it later" button
 * calling an `onDefer` prop, which existed because the step DID block on this dialog; both
 * the block and the button are gone.
 *
 * NEITHER EXIT NAVIGATES. Closing and finishing both leave the payer exactly where they
 * were. That is the caller's rule rather than this file's, and it is load-bearing: the
 * paths that open this sheet have not saved the wizard's own state, so anything here that
 * advanced the wizard would advance it over unsaved work.
 */
export default function BillingSheet({
  token,
  entityId,
  nominatedId,
  onClose,
  onDone,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [chosen, setChosen] = useState('');
  const [adding, setAdding] = useState(false);
  const [intent, setIntent] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [saving, setSaving] = useState(false);
  // The 01-J card, once there is one: `{card, isDefault}`. Non-null means the save
  // succeeded and the payer is looking at the confirmation rather than either form.
  const [saved, setSaved] = useState(null);
  const closeRef = useRef(null);

  /* Read the wallet, on open.
   *
   * ACCOUNTS RATHER THAN LOOSE CARDS, in ONE request: `/billing/accounts` returns the flat
   * wallet as well (`methods`, `default_id`), so it is a strict superset of
   * `/billing/payment-methods` and the picker can label a row with the company it invoices
   * without a second round trip. A payer with no Stripe customer yet (`has_account` false)
   * has never opened one — that is not an empty wallet, it is no wallet, and the only
   * thing to show is the card form.
   *
   * It used to run a second time, after a card was added, and took a `keep` option so that
   * refresh did not hand the payer's just-made choice back to the account default. Saving
   * a card now finishes the dialog outright, so there is no second read and no choice to
   * preserve across one.
   */
  const loadWallet = useCallback(async () => {
    const data = await fetchBillingAccounts(token);
    const list = data.methods || [];
    setMethods(list);
    setAccounts(data.accounts || []);
    /* THE ENTITY'S CARD FIRST, the account default only as a suggestion.
     *
     * These are the same card right up until somebody changes one, and then opening on the
     * default would show the payer a card that is NOT the one billing this company — and
     * a glance plus Confirm would move them onto it. The default is offered when nothing
     * is nominated yet, which is the only case where there is nothing better to offer.
     *
     * The `list.some` check is not belt and braces: a nominated card since detached at
     * Stripe is absent here, and selecting it would tick a row that does not exist and
     * leave Confirm disabled with nothing on screen explaining why. */
    setChosen(
      nominatedId && list.some((m) => m.id === nominatedId)
        ? nominatedId
        : data.default_id || (list[0] ? list[0].id : ''),
    );
    return list;
  }, [token, nominatedId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadWallet();
        if (cancelled) return;
        if (list.length === 0) setAdding(true);
      } catch (err) {
        if (!cancelled) setError(reason(err, "Couldn't load your payment methods."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWallet]);

  /* HOW THIS DIALOG IS DISMISSED, and it is two answers because there are two things the
   * payer can be looking at.
   *
   * ON EITHER FORM, closing is "not now, I'm still reading": it must not navigate, because
   * a stray click outside a dialog is not a decision about billing. `onClose`.
   *
   * ON THE SUCCESS CARD the card is attached AND this entity's consent is recorded — the
   * work is done and the dialog is only reporting it. Closing through `onClose` there
   * would leave the caller offering "Add card" over a card that exists, and the payer
   * would add it twice. `onDone`. */
  const dismiss = saved ? onDone : onClose;

  // Esc closes, and focus starts inside the dialog — it covers the wizard, so leaving the
  // focus behind it would let a keyboard user tab through a form they can't see. (The
  // success card focuses its own Done button; the X is not rendered there.)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) dismiss();
    };
    window.addEventListener('keydown', onKey);
    if (closeRef.current) closeRef.current.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss, saving]);

  // Showing the form and fetching what it needs are deliberately two things: the button
  // (and the empty-wallet case) only says "show it", and this fetches the SetupIntent
  // once, whenever the form is up without one. Wanting the intent opened from a click
  // handler as well means it would be requested twice on the empty-wallet path.
  //
  // A server trip of its own, so it is only taken when the form is actually wanted —
  // never preloaded behind the list.
  useEffect(() => {
    if (!adding || intent) return;
    let cancelled = false;
    (async () => {
      try {
        const handle = await startCardSetup(token);
        if (cancelled) return;
        setIntent(handle);
        setStripePromise(stripeFor(handle.publishable_key));
      } catch (err) {
        if (cancelled) return;
        setError(reason(err, "Couldn't open the card form. Please try again."));
        // Back to the list rather than stranding them on a form that will never mount —
        // unless there is no list to go back to.
        if (methods.length > 0) setAdding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adding, intent, methods.length, token]);

  /* Which billing account each card sits on, so a row can name the company it invoices.
     A card may sit on SEVERAL accounts — that is the whole point of dropping the old
     one-card-one-account constraint — and a row can only carry one name, so the first is
     taken and the rest are left to the payer portal, where an account is the subject
     rather than an annotation. */
  const companyByCard = useMemo(() => {
    const map = new Map();
    for (const account of accounts) {
      if (!account.billing_company) continue;
      for (const card of account.cards || []) {
        if (!map.has(card.id)) map.set(card.id, account.billing_company);
      }
    }
    return map;
  }, [accounts]);

  const openCardForm = useCallback(() => {
    setError('');
    setAdding(true);
  }, []);

  /**
   * Consent for a card the payer just typed in.
   *
   * `make_default: true`, AND THE SUCCESS CARD IS WHY.
   *
   * 01-J tells the payer "This card is set as the default payment method." Saving with
   * `false` left that sentence true only for a payer's first card — Minty promotes that
   * one itself, since an account whose only card is not the default gives dunning nothing
   * to point at — so for everyone else the line had to be hidden or it would have been a
   * lie about their billing, on the screen confirming it. Making it TRUE is the better
   * answer than suppressing it.
   *
   * This was `false` for a long time on the reasoning that the default was account-wide
   * and promoting a card re-pointed the payer's other companies. That has not been true
   * since nomination went per entity: see the note at the top of this file for what the
   * default does and does not still control. The one real consequence is that the payer's
   * NEXT company starts pointed at this card rather than their oldest.
   *
   * The card this company goes on is still named explicitly on `authorizeBilling` rather
   * than inferred from the default — that has not changed and must not.
   *
   * The email and company OPEN A BILLING ACCOUNT in the same request — that is what makes
   * this the "New billing account" form rather than an add-a-card form. Passing neither
   * keeps the older behaviour: the card is saved, and that is all that happens.
   */
  const saveNewCard = async (setupIntentId, paymentMethodId, account) => {
    /* ADDING A CARD *IS* CHOOSING IT, so saving nominates — every time, whether or not the
     * payer already had a billing account.
     *
     * The picker's rule and this one are not in tension, though they used to be tangled
     * together. "Ask the payer to choose" is about choosing BETWEEN CARDS THEY ALREADY
     * HOLD, which is what the list is for. Someone who has just typed a card number in has
     * answered that question; sending them back to a list to point at the card they only
     * just created asks it again.
     *
     * This replaced a round trip — Done returned to the picker with the new row ticked and
     * Confirm did the nominating — which carried a state nothing could design away: close
     * from that picker without pressing Confirm and the payer ends with a card on file, NO
     * CONSENT, and a trial that lapses instead of converting. There is no such gap now.
     *
     * The card is NAMED EXPLICITLY on `authorizeBilling` rather than inferred from the
     * account default. That is unaffected by any of the above and must stay: it is what
     * stops confirming one company from moving another company's billing. */
    const fresh = await confirmCardSetup(token, setupIntentId, true, account);
    await authorizeBilling(token, entityId, paymentMethodId);

    // 01-J names the card that was saved, so it is only shown when we can actually say
    // which one that was. Unidentifiable — no payment method id came back, or the fresh
    // list doesn't contain it — and the dialog finishes rather than showing a success
    // card with a blank in it. The consent above has already been recorded either way.
    const card = (fresh?.methods || []).find((m) => m.id === paymentMethodId);
    if (!card) {
      onDone();
      return;
    }
    setSaved({ card, isDefault: fresh.default_id === card.id });
  };

  /**
   * Consent for a card already on file.
   *
   * The card is NOMINATED first and the consent recorded only if that succeeded — the same
   * guarantee the account-wide default-setting call once gave, one level down and confined to
   * this company. The payer agreed to be billed on the card this sheet named; recording
   * consent while the company still points at a different card would authorise a charge
   * they were never shown. Both happen inside `authorizeBilling`, in that order.
   */
  const confirmExisting = async () => {
    if (!chosen || saving) return;
    setSaving(true);
    setError('');
    try {
      await authorizeBilling(token, entityId, chosen);
      onDone();
    } catch (err) {
      setError(reason(err, "Couldn't confirm billing. Please try again."));
      setSaving(false);
    }
  };

  /* The three frames are three widths, and the modifier is what carries that — see the
     note at the top of the file. `is-list` is the fallback while the wallet loads, so the
     dialog does not resize under the payer the moment it knows what to show. */
  const stage = saved ? 'done' : adding ? 'form' : 'list';

  const body = (
    <div
      className="billing-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) dismiss();
      }}
    >
      <div
        className={`billing-sheet is-${stage}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          stage === 'done'
            ? 'Card added'
            : stage === 'form'
              ? 'New billing account'
              : 'Payment methods'
        }
      >
        <div className="billing-head">
          <div className="billing-headtext">
            {/* The title names what the dialog is asking for right now.

                Held back entirely until the wallet has loaded: which of the two applies
                is not known until then, and a payer with no card would otherwise watch
                "Payment Methods" flip to "New billing account" under them.

                Nothing on the success card — 01-J carries its own heading, in two
                colours, and a second title above it would be a heading for a heading. */}
            {loading || stage === 'done' ? null : (
              <p className="billing-title">
                {adding ? 'New billing account' : 'Payment Methods'}
              </p>
            )}
            {/* ON THE FORM ONLY, because that is where the frame draws one: what happens
                to the card number, worded identically in Minty and the payer portal — the
                same act, in three apps, should not be explained three ways.

                `stage !== 'done'` IS NOT REDUNDANT. `adding` stays TRUE through the success
                card — nothing clears it on the way to 01-J — so this sentence rendered over
                "New Card added Successfully", explaining where the card number goes to
                somebody who has just finished typing one. Test both screens before
                simplifying this condition back to `adding`.

                THE PICKER USED TO CARRY ONE TOO and it was removed deliberately — see the
                note in the component docblock before writing another. */}
            {adding && !loading && stage !== 'done' ? (
              <p className="billing-sub">
                Card details are held by our payment provider, Stripe — they are never
                stored by Minty.
              </p>
            ) : null}
          </div>
          {stage === 'done' ? null : (
            <button
              ref={closeRef}
              type="button"
              className="billing-close"
              onClick={onClose}
              disabled={saving}
              aria-label="Close"
            >
              <Icon.Close />
            </button>
          )}
        </div>

        {loading ? (
          <p className="billing-loading">Loading your payment methods…</p>
        ) : stage === 'done' ? (
          <CardAdded card={saved.card} isDefault={saved.isDefault} onDone={onDone} />
        ) : adding ? (
          <div className="billing-formwrap">
            <div className="billing-formcol">
              {intent && stripePromise ? (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret: intent.client_secret,
                    appearance: STRIPE_APPEARANCE,
                  }}
                >
                  <CardForm
                    setupIntent={intent.setup_intent}
                    onSaved={saveNewCard}
                    onBack={methods.length > 0 ? () => setAdding(false) : onClose}
                    busyLabel="Saving…"
                  />
                </Elements>
              ) : error ? (
                <p className="billing-error" role="alert">
                  {error}
                </p>
              ) : (
                <p className="billing-loading">Opening the card form…</p>
              )}
            </div>
            {/* Decoration, and hidden below the two-column breakpoint. `alt=""` because it
                says nothing the form does not — a described illustration here would be
                read out between the company field and the card number. */}
            <img
              className="billing-formart"
              src="/assets/billing-cat-card.png"
              alt=""
              aria-hidden="true"
            />
          </div>
        ) : (
          <>
            {/* EVERY ROW IS VISIBLE, and the list scrolls when there are more than fit.
                This used to collapse to the chosen card behind a "Change" toggle, which
                solved the same problem — a wallet of seven cards pushing the buttons off
                the bottom — by hiding the choice the dialog exists to offer. A scroll
                container keeps the sheet inside the viewport AND keeps the rows the design
                draws; the toggle went with it. */}
            <ul className="billing-list" id="billing-pm-list">
              {methods.map((m) => {
                const company = companyByCard.get(m.id);
                return (
                  <li key={m.id}>
                    <label className={'billing-pm' + (chosen === m.id ? ' is-chosen' : '')}>
                      <input
                        type="radio"
                        name="billing-pm"
                        value={m.id}
                        checked={chosen === m.id}
                        disabled={saving}
                        onChange={() => setChosen(m.id)}
                      />
                      <CardBrand brand={m.brand} label={m.brand_label} />
                      <span className="billing-pm-main">
                        {/* "Visa ending in 4121" — composed here rather than taken from
                            the server's `label`, which is the one-line form
                            ("Visa •••• 4121") used where a card has to fit in a sentence.
                            A wallet has no last4 to end in, so it keeps the server's. */}
                        <span className="billing-pm-label">
                          {m.last4 ? `${m.brand_label} ending in ${m.last4}` : m.label}
                        </span>
                        {m.expiry ? (
                          <span className="billing-pm-meta">
                            <span className="billing-pm-metalabel">Expire on</span>
                            {m.expiry}
                          </span>
                        ) : (
                          <span className="billing-pm-meta">
                            {m.wallet_label || m.brand_label}
                          </span>
                        )}
                        {/* Which billing account invoices on this card, when the payer has
                            named one. Absent for everybody who has never opened a second
                            account, which is the case the design draws. */}
                        {company ? (
                          <span className="billing-pm-company">{company}</span>
                        ) : null}
                      </span>
                      {/* The flags, as PILLS rather than words appended to the meta line.
                          What a card IS to the account and when it stops working are facts
                          about the card, not part of its expiry date, and the same rail in
                          the same order carries them in Minty and the payer portal.

                          An expired card can still be selected and WOULD be charged — said
                          here rather than at the first failed renewal weeks from now. */}
                      <span className="billing-pm-flags">
                        {m.expires_soon && !m.expired ? (
                          <span className="billing-pm-flag is-soon">Expiring soon</span>
                        ) : null}
                        {m.expired ? (
                          <span className="billing-pm-flag is-expired">Expired</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              className="billing-add"
              onClick={openCardForm}
              disabled={saving}
            >
              Add New Card
            </button>

            {error ? (
              <p className="billing-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="billing-actions is-single">
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmExisting}
                disabled={!chosen || saving}
              >
                {saving ? 'Confirming…' : 'Confirm'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Portalled to the body for the same reason the other wizard dialogs are: the step
  // content sits in a transformed, scrolling container, which would otherwise clip a
  // position:fixed overlay to the card instead of the viewport.
  return typeof document === 'undefined' ? null : ReactDOM.createPortal(body, document.body);
}
