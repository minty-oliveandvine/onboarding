'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

import {
  authorizeBilling,
  BillingError,
  confirmCardSetup,
  fetchPaymentMethods,
  setDefaultPaymentMethod,
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
function CardForm({ setupIntent, forceDefault, onSaved, onBack, busyLabel }) {
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
      await onSaved(confirmed?.id || setupIntent);
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
        options={{ layout: 'tabs' }}
      />

      {forceDefault ? (
        <p className="buynow-note">
          This will be the card your Minty invoices are charged to.
        </p>
      ) : (
        <p className="buynow-note">
          This card becomes your default — it replaces the card your Minty invoices are
          charged to, including for any other entities you pay for.
        </p>
      )}

      {error ? (
        <p className="buynow-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="buynow-actions">
        {onBack ? (
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
            Back
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={!stripe || busy || dead}>
          {busy ? busyLabel : 'Confirm'}
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
 * @param {Function} props.onClose    dismissed without consenting
 * @param {Function} props.onDone     consent recorded; the caller flips its own state
 */
export default function BuyNowSheet({
  token,
  entityId,
  entityName,
  priceLabel,
  trialLabel,
  onClose,
  onDone,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [methods, setMethods] = useState([]);
  const [chosen, setChosen] = useState('');
  const [defaultId, setDefaultId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [intent, setIntent] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [saving, setSaving] = useState(false);
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
        setDefaultId(data.default_id || null);
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

  const openCardForm = useCallback(() => {
    setError('');
    setAdding(true);
  }, []);

  /**
   * Consent for a card the payer just typed in.
   *
   * `make_default: true` — a card added HERE is the one they were shown and agreed to be
   * charged on, so it must be the one that gets charged. Adding it without defaulting
   * would record consent against a different card than the dialog described.
   */
  const saveNewCard = async (setupIntentId) => {
    await confirmCardSetup(token, setupIntentId, true);
    await authorizeBilling(token, entityId);
    onDone();
  };

  /**
   * Consent for a card already on file.
   *
   * The default is set FIRST and consent only if that succeeded. The payer agreed to be
   * billed on the card this dialog named; recording consent while the account still points
   * at a different card would authorise a charge they were never shown.
   */
  const confirmExisting = async () => {
    if (!chosen || saving) return;
    setSaving(true);
    setError('');
    try {
      if (chosen !== defaultId) await setDefaultPaymentMethod(token, chosen);
      await authorizeBilling(token, entityId);
      onDone();
    } catch (err) {
      setError(reason(err, "Couldn't confirm billing. Please try again."));
      setSaving(false);
    }
  };

  const selected = methods.find((m) => m.id === chosen);

  const body = (
    <div
      className="buynow-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="buynow-sheet" role="dialog" aria-modal="true" aria-label="Buy now">
        <div className="buynow-head">
          <div>
            <p className="buynow-title">Confirm billing for {entityName}</p>
            {/* The single most important sentence in the dialog. A payer who reads
                nothing else must still come away knowing today costs nothing — so the
                no-trial wording says it too, rather than falling back to a bare price. */}
            <p className="buynow-sub">
              {trialLabel ? (
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
                  forceDefault={methods.length === 0}
                  onSaved={saveNewCard}
                  onBack={methods.length > 0 ? () => setAdding(false) : null}
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
            <ul className="buynow-list">
              {methods.map((m) => (
                <li key={m.id}>
                  <label className={'buynow-pm' + (chosen === m.id ? ' is-chosen' : '')}>
                    <input
                      type="radio"
                      name="buynow-pm"
                      value={m.id}
                      checked={chosen === m.id}
                      disabled={saving}
                      onChange={() => setChosen(m.id)}
                    />
                    <span className="buynow-pm-main">
                      <span className="buynow-pm-label">{m.label}</span>
                      <span className="buynow-pm-meta">
                        {m.expiry ? `Expires ${m.expiry}` : m.wallet_label || m.brand_label}
                        {m.is_default ? ' · Current default' : ''}
                      </span>
                    </span>
                    {/* An expired card can be selected and would be charged — say so here
                        rather than at the first failed renewal weeks from now. */}
                    {m.expired ? <span className="buynow-pm-flag">Expired</span> : null}
                  </label>
                </li>
              ))}
            </ul>

            <button
              type="button"
              className="btn btn-link buynow-add"
              onClick={openCardForm}
              disabled={saving}
            >
              Use a different card
            </button>

            {selected && selected.id !== defaultId ? (
              <p className="buynow-note">
                This card becomes your default — it replaces the card your Minty invoices
                are charged to, including for any other entities you pay for.
              </p>
            ) : null}

            {error ? (
              <p className="buynow-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="buynow-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
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
