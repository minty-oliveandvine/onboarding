'use client';

import {
  AddressElement,
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

import {
  authorizeBilling,
  BillingError,
  confirmCardSetup,
  fetchPaymentMethods,
  startCardSetup,
} from '@/lib/billing';
import Icon from './Icon';

/**
 * "Buy now" — pick the card, agree to be billed for this entity.
 *
 * WHAT THIS DOES NOT DO IS CHARGE. Nothing here takes money, today or at any point in the
 * trial. The 30-day trial still runs its full term; what the payer agrees to is what
 * happens at the END of it — Minty's trial-end job converts a trial to paid only when the
 * payer has both a card on file AND a consent row for that entity, and lets the trial
 * simply lapse otherwise. So this dialog is the difference between "converts" and
 * "expires", and the copy must never imply a charge is being made now.
 *
 * THE CARD NUMBER NEVER REACHES THIS APP. It is typed into a Stripe-hosted iframe
 * (`PaymentElement`) and confirmed straight against a SetupIntent with a client secret;
 * it does not touch this JavaScript, Minty's process, or any log. Nothing in this file
 * should ever be changed to read a card number out of the form.
 *
 * THE DEFAULT CARD IS ACCOUNT-WIDE. A payer has one Stripe customer carrying one default
 * payment method, shared by every entity they pay for — there is no per-entity card to
 * choose. Choosing here re-points their other entities too, which is why the dialog says
 * so rather than leaving the payer to discover it on an invoice.
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
 * The card form. Split out because `useStripe`/`useElements` only work INSIDE
 * `<Elements>`, which can't be mounted until the client secret has arrived.
 */
function CardForm({ setupIntent, onSaved, onBack, onDefer, busyLabel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dead, setDead] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || busy) return;

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
      await onSaved(confirmed?.id || setupIntent, confirmed?.payment_method);
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
    <form onSubmit={submit} className="buynow-form">
      {/* `loaderror` is the Element itself failing to come up — a blocked js.stripe.com, a
          client secret it can't fetch, a key from another account. Left unhandled it logs
          to the console and shows an empty box forever, which is indistinguishable from a
          button that does nothing. */}
      <PaymentElement
        onLoadError={(event) => {
          console.error('Stripe PaymentElement failed to load', event);
          setDead(true);
          setError(
            event?.error?.message ||
              "The card form couldn't load. If you're running an ad blocker or privacy extension, allow js.stripe.com and try again.",
          );
        }}
        /* `terms.card: 'never'` suppresses Stripe's own mandate line, which is rendered
           inside the iframe and names the STRIPE ACCOUNT rather than Minty — in test mode
           that reads "Cash sandbox". Suppressing it moves the disclosure obligation to us,
           so the sentence below is not decoration: it is the mandate, and it has to keep
           saying that a payment method is being stored and may be charged. */
        options={{
          layout: 'tabs',
          terms: { card: 'never' },
          /* The name and address are the AddressElement's below. Left on, PaymentElement
             asks for them too and the payer fills the same fields twice. */
          fields: { billingDetails: { name: 'never', address: 'never' } },
        }}
      />

      {/* The billing name and address the issuer checks. Collected here rather than left
          out: the payer portal shows both on the saved card, and a method saved without
          them shows blanks a payer cannot fill in from anywhere. */}
      <div className="buynow-address">
        <AddressElement options={{ mode: 'billing', display: { name: 'full' } }} />
      </div>

      <p className="buynow-mandate">
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
        <p className="buynow-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="buynow-actions">
        {/* The way out for a payer with no card to hand. Distinct from closing the
            dialog, which leaves them on the step: this one moves onboarding on without
            a card and without consent. Present on the empty-wallet path too, where
            there is no list to go Back to. */}
        <button
          type="button"
          className="btn btn-ghost buynow-later"
          onClick={onDefer}
          disabled={busy}
        >
          Do it later
        </button>
        {onBack ? (
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
            Back
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={!stripe || busy || dead}>
          {busy ? busyLabel : 'Save'}
        </button>
      </div>
    </form>
  );
}

/**
 * @param {object}   props
 * @param {string}   props.token      onboarding JWT
 * @param {string}   props.entityId   the entity being authorised
 * @param {string}   props.entityName shown so a payer with several can see which one
 * @param {string}   props.priceLabel e.g. "HK$280 / month" — already formatted upstream
 * @param {?string}  props.trialLabel e.g. "17 Sep 2026" — when the first charge falls,
 *                                or null when the catalog offers no trial at all
 * @param {Function} props.onClose    dismissed — the caller keeps them on the step
 * @param {Function} props.onDefer    "Do it later" — move on with no card and no consent
 * @param {Function} props.onDone     consent recorded; the caller flips its own state
 *
 * onClose and onDefer are deliberately NOT the same thing. Closing (the X, Esc, a click
 * on the backdrop) is "not now, I'm still reading" and must not navigate — a stray click
 * outside a dialog is not a decision about billing. Deferring is the decision, and it is
 * only ever reached by pressing a button that says so.
 */
export default function BuyNowSheet({
  token,
  entityId,
  entityName,
  priceLabel,
  trialLabel,
  onClose,
  onDefer,
  onDone,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState([]);
  const [chosen, setChosen] = useState('');
  const [adding, setAdding] = useState(false);
  const [intent, setIntent] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [saving, setSaving] = useState(false);
  // The saved-card list COLLAPSES to the chosen card. A payer with several cards made
  // this sheet taller than the viewport and pushed the price and the buttons off the
  // bottom — and the list is a control they want when changing something, not every
  // time they read what they are agreeing to.
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef(null);

  // Load the wallet once, on open. A payer with no Stripe customer yet (`has_account`
  // false) has never opened one — that is not an empty wallet, it is no wallet, and the
  // only thing to show is the card form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPaymentMethods(token);
        if (cancelled) return;
        const list = data.methods || [];
        setMethods(list);
        setChosen(data.default_id || (list[0] ? list[0].id : ''));
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
  }, [token]);

  // Esc closes, and focus starts inside the dialog — it covers the wizard, so leaving the
  // focus behind it would let a keyboard user tab through a form they can't see.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    if (closeRef.current) closeRef.current.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

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

  // Collapsible only when there is more than one card AND one of them is actually the
  // chosen row. Without that second half, a `chosen` matching nothing — a default
  // pointing at a detached card, say — would collapse the list to nothing at all and
  // leave the payer no way to pick.
  const collapsible = methods.length > 1 && methods.some((m) => m.id === chosen);

  const openCardForm = useCallback(() => {
    setError('');
    setAdding(true);
  }, []);

  /**
   * Consent for a card the payer just typed in.
   *
   * `make_default: false`. THIS SHEET DOES NOT TOUCH THE ACCOUNT DEFAULT — it is confirming
   * one entity, and the default is account-wide, so making every captured card the default
   * silently re-pointed which card the payer's OTHER companies would be offered. The card
   * is named on `authorizeBilling` instead, which puts this company on it and moves nothing
   * else. A payer's FIRST card still becomes the default: Minty does that itself, because
   * an account whose only card is not the default has nothing for dunning to point at.
   *
   * Promoting a card afterwards belongs to the payer portal (Billing → "Make default").
   */
  const saveNewCard = async (setupIntentId, paymentMethodId) => {
    await confirmCardSetup(token, setupIntentId, false);
    // Without the id we would be back to Minty inferring the card from the account
    // default, so it is passed explicitly. It is absent only if Stripe returned no intent
    // object, in which case the fallback is the old behaviour rather than no nomination.
    await authorizeBilling(token, entityId, paymentMethodId);
    onDone();
  };

  /**
   * Consent for a card already on file.
   *
   * The card is NOMINATED first and the consent recorded only if that succeeded — the same
   * guarantee the old `setDefaultPaymentMethod` call gave, one level down and confined to
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

  const body = (
    <div
      className="buynow-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="buynow-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={adding ? 'New billing account' : 'Confirm billing'}
      >
        <div className="buynow-head">
          <div>
            {/* The title names what the dialog is asking for right now. With the card
                form up there is nothing yet to confirm billing AGAINST — naming the
                entity there promises a choice the payer has not been given. `adding`
                covers both routes to the form: an empty wallet, and "Use a different
                card" from a full one.

                Held back entirely until the wallet has loaded: which of the two applies
                is not known until then, and a payer with no card would otherwise watch
                "Confirm billing for X" flip to "New billing account" under them. */}
            {loading ? null : (
              <p className="buynow-title">
                {adding ? 'New billing account' : `Confirm billing for ${entityName}`}
              </p>
            )}
            {/* Two sentences for two questions, and they swap with the title above.

                ON THE FORM: where the card number goes, worded identically in Minty and
                the payer portal — the same act, in three apps, should not be explained
                three ways. What may be charged, and when, is the mandate under the form.

                ON THE LIST: the single most important sentence in the dialog. A payer who
                reads nothing else must still come away knowing today costs nothing — so
                the no-trial wording says it too, rather than falling back to a bare
                price. */}
            <p className="buynow-sub">
              {adding ? (
                <>
                  Card details are held by our payment provider, Stripe — they are never
                  stored by Minty.
                </>
              ) : trialLabel ? (
                <>
                  You won&apos;t be charged today. Your free trial runs until {trialLabel},
                  then {priceLabel} — unless you cancel before then.
                </>
              ) : (
                <>
                  You won&apos;t be charged today. This confirms {priceLabel} may be charged
                  to the card you choose when your subscription begins.
                </>
              )}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="buynow-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <Icon.Close />
          </button>
        </div>

        {loading ? (
          <p className="buynow-loading">Loading your payment methods…</p>
        ) : adding ? (
          <>
            {intent && stripePromise ? (
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: intent.client_secret }}
              >
                <CardForm
                  setupIntent={intent.setup_intent}
                  onSaved={saveNewCard}
                  onBack={methods.length > 0 ? () => setAdding(false) : null}
                  onDefer={onDefer}
                  busyLabel="Confirming…"
                />
              </Elements>
            ) : error ? (
              <p className="buynow-error" role="alert">
                {error}
              </p>
            ) : (
              <p className="buynow-loading">Opening the card form…</p>
            )}
          </>
        ) : (
          <>
            {/* Collapsed to the chosen card until the payer asks to change it. Every
                row stays MOUNTED and is hidden with a class rather than filtered out of
                the map: unmounting the unchosen radios would drop the group's keyboard
                navigation, and a filtered list re-mounts on every toggle. */}
            {/* The header is ALWAYS here, one saved card or seven. It used to appear only
                alongside a collapsible list, so a payer with a single card met an
                unlabelled row — the same list, in the same product, missing the words
                that say what it is. The TOGGLE is still conditional: "Change" over a
                one-row list is a control that cannot do anything. */}
            <div className="buynow-listhead">
              <span className="buynow-listlabel">Billing accounts</span>
              {methods.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-link buynow-change"
                  onClick={() => setExpanded((v) => !v)}
                  disabled={saving}
                  aria-expanded={expanded}
                  aria-controls="buynow-pm-list"
                >
                  {expanded ? 'Done' : 'Change'}
                </button>
              ) : null}
            </div>

            <ul className="buynow-list" id="buynow-pm-list">
              {methods.map((m) => (
                <li
                  key={m.id}
                  className={
                    !expanded && collapsible && chosen !== m.id
                      ? 'is-collapsed'
                      : undefined
                  }
                >
                  <label className={'buynow-pm' + (chosen === m.id ? ' is-chosen' : '')}>
                    <input
                      type="radio"
                      name="buynow-pm"
                      value={m.id}
                      checked={chosen === m.id}
                      disabled={saving}
                      onChange={() => { setChosen(m.id); setExpanded(false); }}
                    />
                    <span className="buynow-pm-main">
                      <span className="buynow-pm-label">{m.label}</span>
                      <span className="buynow-pm-meta">
                        {m.expiry ? `Expires ${m.expiry}` : m.wallet_label || m.brand_label}
                      </span>
                    </span>
                    {/* The flags, as PILLS rather than words appended to the meta line.
                        What a card IS to the account and when it stops working are facts
                        about the card, not part of its expiry date, and the same rail in
                        the same order carries them in Minty and the payer portal.

                        An expired card can still be selected and WOULD be charged — said
                        here rather than at the first failed renewal weeks from now. */}
                    <span className="buynow-pm-flags">
                      {m.is_default ? (
                        <span className="buynow-pm-flag is-default">Default</span>
                      ) : null}
                      {m.expires_soon && !m.expired ? (
                        <span className="buynow-pm-flag is-soon">Expiring soon</span>
                      ) : null}
                      {m.expired ? (
                        <span className="buynow-pm-flag is-expired">Expired</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {/* ALWAYS shown, collapsed list or open. It used to be hidden beside a
                collapsed list so that "Change" and the add-card link were never two
                near-identical links side by side — a fair worry, but the restart screen
                and the payer portal both show the pair, and a link that comes and goes as
                the list opens is the stranger thing to meet. */}
            <button
              type="button"
              className="btn btn-link buynow-add"
              onClick={openCardForm}
              disabled={saving}
            >
              New billing account
            </button>

            {error ? (
              <p className="buynow-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="buynow-actions">
              {/* Replaces "Cancel": the X and Esc already close, and a payer choosing
                  not to do this now needs to know it does not block them. */}
              <button
                type="button"
                className="btn btn-ghost buynow-later"
                onClick={onDefer}
                disabled={saving}
              >
                Do it later
              </button>
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
