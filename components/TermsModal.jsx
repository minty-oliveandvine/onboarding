"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Read-to-agree modal for the Terms of Use.
 *
 * WHY THIS EXISTS
 *
 * A bare tick box next to a link is legally sufficient — clickwrap holds up
 * because the document was available and the assent was unambiguous, not
 * because anyone read it. But someone signing in with Xero meets the full
 * document on the acceptance gate afterwards, while an OTP user only ever saw
 * a link. This closes that gap so both routes show the same thing.
 *
 * STYLING IS A DELIBERATE MIRROR of Minty's templates/legal/_terms_styles.html
 * (the panel behind the post-login gate and the Flask sign-up page). Same
 * two-column layout, same type scale, same mascot, same buttons. It cannot
 * literally share that stylesheet — this is a separate Next.js app — so the
 * values below are duplicated on purpose. Change one, change the other.
 *
 * The document body is fetched rather than framed in an <iframe>: this app is
 * a different origin, and a browser will not let us read the scroll position
 * of a cross-origin frame, which is the one thing the lock depends on.
 *
 * Props:
 *   open      — whether the modal is showing
 *   onClose   — called when dismissed without agreeing
 *   onAgree   — called with the version string once they reach the end and agree
 *   flaskBase — origin of the Flask app
 */
export default function TermsModal({ open, onClose, onAgree, flaskBase }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const [atEnd, setAtEnd] = useState(false);
  const scrollRef = useRef(null);

  // Fetch on first open, then keep it — reopening should not refetch or reset
  // how far they had read.
  useEffect(() => {
    if (!open || doc) return;
    let cancelled = false;
    fetch(`${flaskBase}/legal/content/terms`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the Terms. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, doc, flaskBase]);

  const checkAtEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A document shorter than its box has nothing to scroll — without this
    // branch those users could never satisfy the condition and would be stuck
    // with the button disabled forever.
    if (el.scrollHeight <= el.clientHeight + 4) {
      setAtEnd(true);
      return;
    }
    // Tolerance of 4px, not equality: sub-pixel layout and browser zoom mean
    // scrollTop + clientHeight often lands a hair short of scrollHeight at the
    // true bottom.
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 4) setAtEnd(true);
  }, []);

  // Re-check once the body has rendered, and on resize — a window change can
  // turn a scrollable box into a non-scrollable one.
  useEffect(() => {
    if (!open || !doc) return;
    const id = window.requestAnimationFrame(checkAtEnd);
    window.addEventListener("resize", checkAtEnd);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", checkAtEnd);
    };
  }, [open, doc, checkAtEnd]);

  // Escape closes. Unlike the post-login gate — which is a trap by design,
  // because refusing there means refusing Minty — this one is dismissible:
  // nothing has been created yet and the person can simply not sign up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="tc-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Terms and Conditions"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tc-modal">
        <div className="tc-grid">

          {/* Left: heading, notices, the document */}
          <div className="tc-main">
            <h1 className="tc-title">Terms &amp; Conditions</h1>
            <p className="tc-lead">
              Please review and accept our Terms &amp; Conditions and Privacy Policy to
              finish setting up your account.
            </p>

            {doc && doc.is_pinned === false && (
              <div className="tc-draft">
                <strong>Draft.</strong> This wording is not final, so this screen is for
                testing only.
              </div>
            )}

            <div className="tc-card">
              {doc?.effective_date && (
                <p className="tc-updated">Last updated: {doc.effective_date}</p>
              )}
              {error ? (
                <div className="tc-state tc-state-error">{error}</div>
              ) : !doc ? (
                <div className="tc-state">Loading…</div>
              ) : (
                <div
                  className="tc-doc"
                  ref={scrollRef}
                  onScroll={checkAtEnd}
                  tabIndex={0}
                  dangerouslySetInnerHTML={{ __html: doc.html }}
                />
              )}
            </div>
          </div>

          {/* Right: the mascot, then the actions */}
          <aside className="tc-side">
            {/* Decorative, so alt="" — a screen reader announcing it would come
                between the person and the agreement they are being asked to make. */}
            <img
              className="tc-illus-img"
              src={`${flaskBase}/static/img/minty_important_update.png`}
              alt=""
              width={400}
              height={467}
              decoding="async"
            />
            <div className="tc-actions">
              <button type="button" className="tc-cancel" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="tc-accept"
                disabled={!doc || !atEnd}
                onClick={() => onAgree(doc.version)}
              >
                Accept &amp; Continue
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </div>
          </aside>

        </div>
      </div>

      <style jsx>{`
        .tc-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          background: rgba(249, 250, 251, 0.72);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          overflow-y: auto;
        }
        .tc-modal {
          background: #fff;
          border-radius: 18px;
          width: 100%;
          max-width: 1180px;
          padding: 36px 38px 32px;
          margin: auto;
          color: #111827;
          box-shadow: 0 10px 40px rgba(16, 24, 40, 0.16),
            0 2px 6px rgba(16, 24, 40, 0.06);
        }
        .tc-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 400px;
          gap: 40px;
          align-items: start;
        }
        .tc-main {
          min-width: 0;
        }
        .tc-side {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .tc-title {
          font-size: 27px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #111827;
          margin: 0 0 10px;
          line-height: 1.2;
        }
        .tc-lead {
          color: #6b7280;
          font-size: 14px;
          line-height: 1.6;
          margin: 0 0 18px;
        }
        .tc-draft {
          border-radius: 10px;
          padding: 14px 16px;
          margin-bottom: 18px;
          font-size: 14px;
          line-height: 1.55;
          background: #fffbeb;
          border: 1px solid #fcd34d;
          color: #92400e;
        }

        .tc-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 18px 10px 18px 20px;
          box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04),
            0 4px 14px rgba(16, 24, 40, 0.05);
        }
        .tc-updated {
          font-size: 13px;
          color: #9ca3af;
          margin: 0 14px 16px 0;
        }
        /* Scrollable, not paginated: the whole document is present, so
           "I was not shown it" is not available as an argument. */
        .tc-doc {
          max-height: min(52vh, 520px);
          overflow-y: auto;
          padding-right: 12px;
          scrollbar-width: thin;
          scrollbar-color: #d1d5db transparent;
        }
        .tc-doc::-webkit-scrollbar {
          width: 6px;
        }
        .tc-doc::-webkit-scrollbar-track {
          background: transparent;
        }
        .tc-doc::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 999px;
        }
        /* :global — this markup arrives from Flask, so styled-jsx cannot scope it. */
        .tc-doc :global(h1),
        .tc-doc :global(h2) {
          font-size: 16px;
          font-weight: 700;
          color: #111827;
          margin: 24px 0 7px;
          line-height: 1.35;
        }
        .tc-doc :global(> :first-child) {
          margin-top: 0;
        }
        .tc-doc :global(p) {
          font-size: 15px;
          line-height: 1.55;
          color: #6b7280;
          margin: 0 0 12px;
        }
        .tc-doc :global(ul) {
          margin: 0 0 14px 20px;
          padding: 0;
        }
        .tc-doc :global(li) {
          font-size: 15px;
          line-height: 1.55;
          color: #6b7280;
          margin-bottom: 5px;
        }
        .tc-state {
          padding: 48px 0;
          text-align: center;
          font-size: 14px;
          color: #6b7280;
        }
        .tc-state-error {
          color: #b91c1c;
        }

        /* aspect-ratio matches the source file (2400x1792) cropped to portrait,
           so the mascot fills the frame rather than swimming in background. */
        .tc-illus-img {
          width: 100%;
          height: auto;
          display: block;
          border-radius: 14px;
          aspect-ratio: 6 / 7;
          object-fit: cover;
        }

        /* Capped and centred: at 400px the buttons would stretch to the full
           column width and stop reading as buttons. */
        .tc-actions {
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 100%;
          max-width: 300px;
          margin: 0 auto;
        }
        .tc-cancel {
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 999px;
          padding: 10px 20px;
          font: inherit;
          font-size: 14px;
          font-weight: 500;
          color: #374151;
          text-align: center;
          cursor: pointer;
          transition: background-color 0.15s ease;
        }
        .tc-cancel:hover {
          background: #f9fafb;
        }
        .tc-accept {
          background: #36c3b4;
          border: 0;
          border-radius: 999px;
          padding: 11px 20px;
          font: inherit;
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background-color 0.15s ease;
        }
        .tc-accept:hover:not(:disabled) {
          background: #2ba99c;
        }
        .tc-accept:disabled {
          background: #d1d5db;
          cursor: not-allowed;
        }
        .tc-accept svg {
          width: 16px;
          height: 16px;
        }

        /* Narrow: one column, illustration hidden. It is decorative, and on a
           phone it would push the actual agreement below the fold. */
        @media (max-width: 860px) {
          .tc-grid {
            grid-template-columns: minmax(0, 1fr);
            gap: 24px;
          }
          .tc-illus-img {
            display: none;
          }
          .tc-side {
            gap: 12px;
          }
        }
        @media (max-width: 640px) {
          .tc-modal {
            padding: 24px 20px 22px;
            border-radius: 14px;
          }
          .tc-title {
            font-size: 22px;
          }
        }
      `}</style>
    </div>
  );
}
