// Shape checks that were written out in several places and could drift apart.
//
// These are DELIBERATELY SHALLOW. The email test is one "@" with something either side and
// a dot in the domain — the same rule the backend applies, and for the same reason: these
// addresses never authenticate anybody, so a stricter parser would reject legitimate
// addresses (`a+b@sub.domain.museum`) for no gain.
//
// The point of putting them here is not cleverness, it is that the completion gate and the
// UI hint for the same field were two separate copies of the rule and could disagree about
// whether a form was valid.

/** One "@", something either side, a dot in the domain. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when `value` looks like an email address. Empty is NOT valid — callers that treat
 *  an empty field as acceptable check for that themselves, because "optional" is their
 *  rule, not this one's. */
export function isEmail(value) {
  return EMAIL_RE.test(String(value ?? '').trim());
}

/** Canonical uuid, any case. Used to tell a stored id from a display value. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a uuid. */
export function isUuid(value) {
  return UUID_RE.test(String(value ?? ''));
}
