"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  savePendingInvite,
  readPendingInvite,
  clearPendingInvite,
} from "../../lib/pendingInvite";
import AuthTopbar from "@/components/AuthTopbar";
import { FLASK_BASE } from "@/lib/flaskBase";

function AuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlInviteToken = searchParams.get("invite") || "";
  const urlEmail = searchParams.get("email") || "";
  const signupMode = searchParams.get("mode") === "signup";
  const prefilledFirstName = searchParams.get("fn") || "";
  const prefilledLastName = searchParams.get("ln") || "";
  // Set by the backend when it bounces a wrong-account user back here after a
  // forced logout (?error=wrong_account). The Flask flash explaining why can't
  // cross origins to this page, so we reconstruct the message from the params.
  const bouncedWrongAccount = searchParams.get("error") === "wrong_account";

  // After a Xero logout/login hop, Xero redirects to the *bare* /auth (its
  // registered redirect URI), so invite/email may be missing from the URL. We
  // recover them from the pending invite we stashed before the hop. The URL is
  // always authoritative when present (non-Xero users still carry params);
  // storage only fills the gap when the URL has nothing.
  const [recovered, setRecovered] = useState<{
    invite: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null>(null);
  useEffect(() => {
    if (urlInviteToken) return; // URL wins — nothing to recover.
    const pending = readPendingInvite(Date.now());
    if (pending) {
      setRecovered({
        invite: pending.invite,
        email: pending.email,
        firstName: pending.firstName,
        lastName: pending.lastName,
      });
    }
  }, [urlInviteToken]);

  const inviteToken = urlInviteToken || recovered?.invite || "";
  const prefilledEmail = urlEmail || recovered?.email || "";
  const recoveredFirstName = prefilledFirstName || recovered?.firstName || "";
  const recoveredLastName = prefilledLastName || recovered?.lastName || "";
  const [email, setEmail] = useState(prefilledEmail);
  // Self-serve signup collects the name up front (the User model requires a
  // first/last name). In login/invite mode these stay as the prefilled values.
  const [firstName, setFirstName] = useState(recoveredFirstName);
  const [lastName, setLastName] = useState(recoveredLastName);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const namesValid = !signupMode || (firstName.trim() !== "" && lastName.trim() !== "");

  const emailLocked = Boolean(inviteToken && prefilledEmail);
  // Show the "sign in as <email>" notice whenever someone arrives from an
  // invite with both the token and the target email — this covers a fresh
  // invite click and the wrong-account bounce-back (the backend re-sends the
  // same invite+email params after forcing a logout).
  const showInviteNotice = Boolean(inviteToken && prefilledEmail);

  // --- Terms of Use agreement -------------------------------------------
  // Shown whenever this page is about to CREATE an account: self-serve signup
  // (signupMode) or an invite accept. BOTH conditions are needed — invite
  // links do not set ?mode=signup, so gating on signupMode alone would
  // silently skip every invited user, and invitees are our largest group of
  // new accounts.
  //
  // This page cannot know whether the OTP will create an account or log in an
  // existing one; the server decides that. So an invitee who already has an
  // account is shown a box for Terms they may have accepted already. Harmless:
  // the unique index on (user_id, terms_version) makes the write idempotent,
  // and that is the right trade against missing a genuine first-time invitee.
  const isSignupFlow = signupMode || showInviteNotice;
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsVersion, setTermsVersion] = useState("");
  // Fetched rather than hardcoded, so the consent record names the version
  // that was actually live when this page rendered.
  useEffect(() => {
    if (!isSignupFlow) return;
    fetch(`${FLASK_BASE}/legal/current`)
      .then((r) => r.json())
      .then((d) => setTermsVersion(d.terms_version || ""))
      .catch(() => setTermsVersion(""));
  }, [isSignupFlow]);

  // The tick box gates sending the code at all, so an account cannot even
  // begin without agreement. The binding check is still the server's — see
  // _terms_consent_for_signup in the Flask app.
  const termsValid = !isSignupFlow || termsAccepted;

  const canContinue = emailValid && namesValid && termsValid && !sending;

  // Recovered values (and URL params) can resolve after the initial mount —
  // the recovery effect runs post-render — so sync them into the editable
  // fields when they appear. Only overwrite when there's a value, so a user's
  // own typing isn't clobbered by an empty recovered field.
  useEffect(() => {
    if (prefilledEmail) setEmail(prefilledEmail);
  }, [prefilledEmail]);
  useEffect(() => {
    if (recoveredFirstName) setFirstName(recoveredFirstName);
  }, [recoveredFirstName]);
  useEffect(() => {
    if (recoveredLastName) setLastName(recoveredLastName);
  }, [recoveredLastName]);

  const onContinue = async () => {
    if (!emailValid || sending) return;
    setError("");
    setSending(true);
    try {
      const res = await fetch(`${FLASK_BASE}/auth/email/request-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status === "error") {
        setError(data.message || "Something got stuck sending that code! Want to try again?");
        setSending(false);
        return;
      }
      const qs = new URLSearchParams();
      if (inviteToken) qs.set("invite", inviteToken);
      qs.set("email", email);
      if (firstName) qs.set("fn", firstName);
      if (lastName) qs.set("ln", lastName);
      // Carry the agreement to /auth/confirm, which is where verify-code (and
      // therefore account creation) actually happens. These params are only a
      // claim — the server records nothing it has not been told explicitly,
      // and enforces the requirement itself.
      if (isSignupFlow && termsAccepted) {
        qs.set("ta", "1");
        if (termsVersion) qs.set("tv", termsVersion);
      }
      // The invite now travels in the /auth/confirm URL, so the storage
      // fallback has done its job — clear it so it can't resurface later.
      clearPendingInvite();
      router.push(`/auth/confirm?${qs.toString()}`);
    } catch {
      setError("My connection timed out—let's try that again.");
      setSending(false);
    }
  };

  return (
    <>
      <AuthTopbar />

      <main className="auth-page">
        <div className="auth-card">
          <div className="page-head">
            <h2>{signupMode ? "Create your account" : "Welcome"}</h2>
            <p>
              {signupMode
                ? "Sign up with your email to get started."
                : "Start your journey with us today."}
            </p>
          </div>

          {showInviteNotice && (
            <div className="auth-invite-notice" role="status">
              {bouncedWrongAccount ? (
                <>
                  You&apos;re signed in with a different account. This invitation
                  was sent to <strong>{prefilledEmail}</strong> — please sign in
                  with that account to accept it.
                </>
              ) : (
                <>
                  This invitation was sent to <strong>{prefilledEmail}</strong>.
                  Please sign in with that account to accept it.
                </>
              )}
            </div>
          )}

          <div className="form-stack auth-form">
            {signupMode && (
              <>
                <div className="field">
                  <label htmlFor="auth-first-name">First name</label>
                  <input
                    id="auth-first-name"
                    type="text"
                    autoComplete="given-name"
                    placeholder="Jane"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="auth-last-name">Last name</label>
                  <input
                    id="auth-last-name"
                    type="text"
                    autoComplete="family-name"
                    placeholder="Doe"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                readOnly={emailLocked}
                aria-readonly={emailLocked}
                title={emailLocked ? "This invite was sent to this address" : undefined}
              />
            </div>

            {isSignupFlow && (
              <div className="field">
                <label htmlFor="auth-terms" className="auth-terms-label">
                  {/* Unticked on every render — a pre-ticked box is not
                      agreement, because the person has done nothing. */}
                  <input
                    id="auth-terms"
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                  />
                  <span>
                    I agree to the{" "}
                    <a
                      className="auth-link"
                      href={`${FLASK_BASE}/legal/terms`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Terms of Use
                    </a>{" "}
                    and{" "}
                    <a
                      className="auth-link"
                      href={`${FLASK_BASE}/legal/privacy`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!canContinue}
              onClick={onContinue}
            >
              {sending
                ? "Sending code…"
                : signupMode
                ? "Continue with Email"
                : "Log in with OTP"}
            </button>
            {error && <div className="auth-error" role="alert">{error}</div>}

            <div className="auth-divider" role="separator">
              <span>or</span>
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-block auth-xero"
              onClick={() => {
                // Top-level navigation — Xero OAuth requires a cross-origin
                // redirect, not a fetch. Flask's /callback handler now sends
                // an OTP and bounces back to /auth/confirm after the OAuth
                // round-trip succeeds. Forward the invite token so invited
                // users who choose Xero don't lose their invite.
                //
                // On an invite mismatch, Xero logs the user out and returns to
                // the *bare* /auth (no query params). Stash the pending invite
                // first so we can recover it on that param-less return.
                if (inviteToken) {
                  savePendingInvite({
                    invite: inviteToken,
                    email: prefilledEmail,
                    firstName,
                    lastName,
                    ts: Date.now(),
                  });
                }
                const xqs = new URLSearchParams();
                if (inviteToken) xqs.set("invite", inviteToken);
                const suffix = xqs.toString() ? `?${xqs.toString()}` : "";
                window.location.href = `${FLASK_BASE}/xero_auth${suffix}`;
              }}
            >
              Log in with Xero
              <img src="/xero-logo.webp" alt="" className="auth-xero-logo" />
            </button>

            <p className="auth-foot">
              Don&apos;t have an account?{" "}
              <a
                className="auth-link"
                href="https://www.xero.com/signup/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Sign up
              </a>
            </p>
          </div>

          <div className="auth-notice">
            <span className="auth-notice-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <div className="auth-notice-body">
              <div className="auth-notice-title">You&apos;re in safe hands</div>
              <p>I keep your login protected with industry-standard AES-256 encryption.</p>
            </div>
          </div>
        </div>
      </main>

      <style>{`
        .auth-page {
          min-height: calc(100vh - 60px);
          padding: 24px 16px 48px;
          display: flex;
          justify-content: center;
        }
        .auth-card {
          width: 100%;
          max-width: 380px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding-top: 24px;
        }
        /* Tighter than .page-head's default 36px because the email form
           sits right under the heading rather than across a step page. */
        .auth-card .page-head { margin-bottom: 0; }
        /* Override form-stack's 18px gap with a tighter 14px so the
           Continue button sits closer to the email input, matching the
           screenshot. Everything else (input padding 14px 16px,
           label 14px) comes from .form-stack untouched. */
        .auth-form { gap: 14px; }

        .auth-error {
          color: var(--danger);
          font-size: 13px;
          text-align: center;
          margin-top: -6px;
        }
        .auth-invite-notice {
          font-size: 13.5px;
          line-height: 1.5;
          color: var(--ink-2);
          background: var(--accent-soft);
          border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--line));
          border-radius: var(--radius);
          padding: 12px 14px;
        }
        .auth-invite-notice strong {
          color: var(--ink);
          font-weight: 600;
        }
        .auth-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--muted);
          font-size: 13px;
          padding: 2px 0;
        }
        .auth-divider::before,
        .auth-divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--line);
        }
        .auth-xero {
          background: var(--bg);
          color: var(--ink);
        }
        .auth-xero-logo {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          object-fit: cover;
        }
        /* Ties with .form-stack .field label (0,2,1) in globals.css and wins
           on order, the same way .auth-form beats .form-stack above. */
        .field label.auth-terms-label {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          font-size: 13.5px;
          font-weight: 400;
          line-height: 1.5;
          color: var(--ink-2);
          cursor: pointer;
        }
        /* globals.css ".field input" sets appearance:none and pins text-input
           padding/border/background onto EVERY input inside .field — including
           this checkbox, which then toggles state but never draws a tick, so it
           reads as permanently unchecked. Restore the native control.
           Specificity (0,3,1) beats ".form-stack .field input" (0,2,1)
           outright, so this holds regardless of stylesheet order. */
        .field .auth-terms-label input[type="checkbox"] {
          appearance: auto;
          -webkit-appearance: auto;
          flex: none;
          width: 16px;
          height: 16px;
          margin: 1px 0 0;
          padding: 0;
          border: 0;
          border-radius: 0;
          background: none;
          accent-color: var(--accent);
          cursor: pointer;
        }
        .auth-foot {
          margin: 4px 0 0;
          text-align: center;
          font-size: 14px;
          color: var(--ink-2);
        }
        .auth-link {
          color: var(--accent-ink);
          font-weight: 600;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .auth-link:hover {
          color: var(--accent);
        }
        .auth-notice {
          display: flex;
          gap: 12px;
          padding: 14px 16px;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          background: var(--bg);
        }
        .auth-notice-icon {
          color: var(--accent);
          flex-shrink: 0;
          padding-top: 2px;
        }
        .auth-notice-body {
          font-size: 13px;
          line-height: 1.55;
          color: var(--ink-2);
        }
        .auth-notice-title {
          font-weight: 700;
          color: var(--ink);
          margin-bottom: 2px;
          font-size: 14px;
        }
        .auth-notice-body p {
          margin: 0;
        }
      `}</style>
    </>
  );
}

export default function AuthPage() {
  // useSearchParams forces a Suspense boundary at build time. The fallback is
  // the bare topbar so the page header is visible during the (very short)
  // hydration window — searchParams resolve client-side immediately on mount.
  return (
    <Suspense fallback={<AuthTopbar />}>
      <AuthContent />
    </Suspense>
  );
}
