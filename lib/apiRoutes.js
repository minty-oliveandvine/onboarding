// Which service answers each path.
//
// The onboarding API is being extracted from the Flask app into a separate Django
// service (../onboarding-backend). Both speak the SAME paths — `/api/onboarding/*`,
// byte for byte — so moving an endpoint between them is a change of base URL and
// nothing else. This module is that switch, and it is the only place the decision
// lives.
//
// TO MOVE AN ENDPOINT BACK TO FLASK: delete its line from DJANGO_PATHS. To move it
// across: add one. There is nothing else to change, in this file or anywhere else.
//
// WHY A LIST RATHER THAN "EVERYTHING UNDER /api/onboarding"
//
// Because the list is the record of what has actually been verified. The Django
// service answers every onboarding path today, but roughly two-thirds of them are
// thin proxies that hand the request straight back to Flask (Stripe, Xero tokens,
// subscription writes — things only one service may do). Those are safe, and they
// are also the ones most likely to need reverting in a hurry. An explicit list lets
// that be one deleted line at 2am rather than a code change under pressure.
//
// NOT EVERYTHING GOES THROUGH THE NEW SERVICE. `/auth/email/*`, `/legal/*`,
// `/xero_auth`, `/xero_connect`, `/logout` and `/entity` are Flask pages and Flask
// auth — they are not part of this extraction and are not listed here, so they fall
// through to FLASK_BASE.

// Extension included deliberately: the bundler resolves either form, but plain
// `node` resolves only this one -- which is what lets scripts/check-routes.mjs
// import this exact file rather than testing a copy of it.
import { FLASK_BASE } from './flaskBase.js';

const strip = (url) => (url || '').replace(/\/$/, '');

// Where the extracted onboarding API lives. Defaults to the port its docker service
// and `manage.py runserver` both use.
export const ONBOARDING_API_BASE = strip(
  process.env.NEXT_PUBLIC_ONBOARDING_API_URL || 'http://localhost:8001',
);

const FLASK = strip(FLASK_BASE);

// Paths the Django service answers. A `:name` segment matches exactly one segment.
//
// Matching is per SEGMENT, not by string prefix. That matters: `/invite` would
// prefix-match `/invite/cancel`, so reverting the invite list to Flask would
// silently revert cancelling too — a one-line edit with a consequence nobody asked
// for. Segment matching makes the two independent.
const DJANGO_PATHS = [
  // Reference data — implemented in Django
  '/api/onboarding/server-time',
  '/api/onboarding/currencies',
  '/api/onboarding/countries',
  '/api/onboarding/plans',
  // Wizard state — implemented in Django
  '/api/onboarding/state',
  '/api/onboarding/saved-step',
  // The company — implemented in Django
  '/api/onboarding/create',
  '/api/onboarding/entity/:entityId',
  // Petty-cash config — implemented in Django
  '/api/onboarding/sales-methods',
  '/api/onboarding/opening-balance',
  // Invites — GET and cancel implemented in Django; POST /invite is a proxy,
  // because the invitation email links into a Flask route and uses a Flask template
  '/api/onboarding/invite',
  '/api/onboarding/invite/cancel',
  // Proxied to Flask by the Django service. Listed so the wizard still talks to one
  // base URL; delete a line to route it straight at Flask instead.
  '/api/onboarding/account-codes',
  '/api/onboarding/contacts',
  '/api/onboarding/contacts/create',
  '/api/onboarding/bill-codes',
  '/api/onboarding/modules',
  '/api/onboarding/payment-method',
  '/api/onboarding/payment-method/setup',
  '/api/onboarding/payment-method/complete',
  '/api/onboarding/billing/payment-methods',
  '/api/onboarding/billing/payment-methods/setup-intent',
  '/api/onboarding/billing/payment-methods/confirm',
  '/api/onboarding/billing/payment-methods/default',
  '/api/onboarding/billing/accounts',
  '/api/onboarding/billing/authorize',
  '/api/onboarding/finalize',
  '/api/onboarding/xero/disconnect',
];

const DJANGO_PATTERNS = DJANGO_PATHS.map((p) => p.split('/'));

function matches(pattern, segments) {
  if (pattern.length !== segments.length) return false;
  return pattern.every((part, i) => part.startsWith(':') || part === segments[i]);
}

/** The base URL that answers `path`. Exported for tests and for debugging. */
export function baseFor(path) {
  // Compare the path only. A query string is never part of the routing decision,
  // and `?entity_id=…` on /state would otherwise defeat an exact match.
  const pathname = String(path || '').split('?')[0].split('#')[0];
  const segments = pathname.split('/');
  return DJANGO_PATTERNS.some((p) => matches(p, segments))
    ? ONBOARDING_API_BASE
    : FLASK;
}

/**
 * Absolute URL for an app-relative path, routed to whichever service owns it.
 *
 *   urlFor('/api/onboarding/state?entity_id=abc')  -> the onboarding service
 *   urlFor('/entity')                              -> Flask (a Flask page)
 *
 * Used for fetches AND for navigations, because the question is the same either
 * way: which service serves this path.
 */
export function urlFor(path) {
  const suffix = String(path || '');
  return `${baseFor(suffix)}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
}
