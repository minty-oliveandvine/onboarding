// Pending-invite recovery across the Xero logout/login hop.
//
// Why this exists: on an invite mismatch the backend logs the wrong user out of
// Xero, and Xero redirects back to the *bare* /auth URL (its registered
// redirect URI — it can't carry our invite/email query params). So after a
// Xero hop, /auth may load with no invite/email in the URL. We stash the
// pending invite right before sending the user to Xero and recover it on return.
//
// sessionStorage (not localStorage): it survives the same-tab top-level
// navigation through Xero but is scoped to the tab and clears when it closes,
// so a stale invite can't leak into an unrelated login in another session.

const KEY = "pendingInvite";
// Recovery is only meant to bridge the Xero round-trip, which is seconds to a
// couple of minutes. Cap it so an abandoned invite can't resurface hours later
// on a normal visit to /auth and wrongly show "accept invitation as <X>".
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// Stash the invite just before the Xero hop. `ts` is passed in by the caller
// (Date.now() isn't available everywhere) so this stays a pure writer.
export function savePendingInvite({ invite, email, firstName, lastName, ts }) {
  if (typeof window === "undefined" || !invite) return;
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        invite,
        email: email || "",
        firstName: firstName || "",
        lastName: lastName || "",
        ts: ts || 0,
      })
    );
  } catch {
    // Storage can throw (private mode / quota). Recovery is best-effort — the
    // non-Xero path still carries params in the URL, so we just skip stashing.
  }
}

// Read the stashed invite, or null if absent/expired/malformed. `now` is passed
// in by the caller for the same reason as `ts` above.
export function readPendingInvite(now) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.invite) return null;
    if (typeof now === "number" && data.ts && now - data.ts > MAX_AGE_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}
