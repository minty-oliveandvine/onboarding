// Where the wizard's in-progress state lives in the browser, and how the launch token is
// read. Extracted verbatim from OnboardingApp -- no behaviour changed.
//
// THE BROWSER IS A CACHE, NOT THE SOURCE OF TRUTH. The `entities` row is; GET /state
// reconstructs the whole picture from it, which is what makes a cold resume work in a new
// browser, incognito, or on another device. Everything here is an optimisation on top of
// that, and losing all of it costs a round trip, not the user's progress.

// Scoped only to the Xero OAuth round-trip: we stash progress here right
// before leaving for Xero and restore it on return. Cleared immediately after,
// so it does NOT persist across an ordinary refresh.
export const XERO_RESUME_KEY = 'minty_onboarding_xero_resume';

export const STORAGE_KEY = 'minty_onboarding_session';

// Session storage is keyed per entity so multiple in-progress entities don't
// clobber each other. Before an entity is created it has no id yet, so its
// draft lives under the bare global key; once `submitEntity` assigns an id,
// writes move to `minty_onboarding_session:<id>` and the bare draft is cleared.
export const sessionKey = (entityId) => (entityId ? `${STORAGE_KEY}:${entityId}` : STORAGE_KEY);

// On a plain refresh the URL carries no entity_id, so we can't look up the
// per-entity session key directly. Scan localStorage for every
// `minty_onboarding_session:<id>` blob and return the most recently saved one
// (by `savedAt`). This is what makes an ordinary refresh restore progress
// instead of resetting to the empty initial state.
export const findLatestSession = () => {
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
export function readJwtClaims(token) {
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
