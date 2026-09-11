// Routing check for lib/apiRoutes.js -- the switch that decides which service
// answers each path during the Flask -> Django onboarding extraction.
//
// This repo has no test runner, and this is the one piece of logic where a silent
// mistake is expensive: send a path to the wrong service and it 404s, or worse,
// reaches a service that answers it differently. So it gets a check of its own.
//
//   npm run check:routes
//
// Two properties matter most, and neither is obvious from reading the list:
//
//   * /invite and /invite/cancel are INDEPENDENT. Prefix matching would tie them
//     together, so reverting one would silently revert the other.
//   * An UNLISTED /api/onboarding/* path falls through to Flask. Unknown means "not
//     verified here", and the safe answer is the service that has always served it.

process.env.NEXT_PUBLIC_MODULE1_API_URL = 'https://flask.example';
process.env.NEXT_PUBLIC_ONBOARDING_API_URL = 'https://django.example';

const { urlFor } = await import('../lib/apiRoutes.js');

const DJANGO = 'https://django.example';
const FLASK = 'https://flask.example';

// Every path the wizard actually calls, taken from the components.
const cases = [
  // --- must reach the onboarding service ---
  ['/api/onboarding/server-time', DJANGO],
  ['/api/onboarding/currencies', DJANGO],
  ['/api/onboarding/countries', DJANGO],
  ['/api/onboarding/plans', DJANGO],
  ['/api/onboarding/state?entity_id=abc-123', DJANGO],
  ['/api/onboarding/saved-step', DJANGO],
  ['/api/onboarding/create', DJANGO],
  ['/api/onboarding/entity/2749a5a2-5a9f-482a-97df-af2b6a5ac0e6', DJANGO],
  ['/api/onboarding/sales-methods', DJANGO],
  ['/api/onboarding/sales-methods?entity_id=abc', DJANGO],
  ['/api/onboarding/opening-balance', DJANGO],
  ['/api/onboarding/invite', DJANGO],
  ['/api/onboarding/invite?entity_id=abc', DJANGO],
  ['/api/onboarding/invite/cancel', DJANGO],
  ['/api/onboarding/account-codes?entity_id=abc', DJANGO],
  ['/api/onboarding/account-codes', DJANGO],
  ['/api/onboarding/contacts', DJANGO],
  ['/api/onboarding/contacts/create', DJANGO],
  ['/api/onboarding/bill-codes?entity_id=abc', DJANGO],
  ['/api/onboarding/bill-codes', DJANGO],
  ['/api/onboarding/modules', DJANGO],
  ['/api/onboarding/finalize', DJANGO],
  ['/api/onboarding/xero/disconnect', DJANGO],
  ['/api/onboarding/billing/payment-methods', DJANGO],
  ['/api/onboarding/billing/payment-methods/setup-intent', DJANGO],
  ['/api/onboarding/billing/payment-methods/confirm', DJANGO],
  ['/api/onboarding/billing/accounts', DJANGO],
  ['/api/onboarding/billing/authorize', DJANGO],
  ['/api/onboarding/payment-method?entity_id=abc', DJANGO],

  // --- must STAY on Flask: pages and auth, not part of the extraction ---
  ['/entity', FLASK],
  ['/logout', FLASK],
  ['/xero_connect?from=onboarding', FLASK],
  ['/xero_auth', FLASK],
  ['/auth/email/request-code', FLASK],
  ['/auth/email/verify-code', FLASK],
  ['/legal/current', FLASK],
  ['/legal/terms', FLASK],
  ['/legal/content/terms', FLASK],

  // --- an unlisted onboarding path must NOT be assumed local ---
  ['/api/onboarding/not-a-real-endpoint', FLASK],
];

let failed = 0;
for (const [path, want] of cases) {
  const got = urlFor(path);
  const ok = got === `${want}${path}`;
  if (!ok) { failed++; console.log(`  FAIL  ${path}\n        want ${want}${path}\n        got  ${got}`); }
}
console.log(`${cases.length} paths checked, ${failed} wrong`);
process.exit(failed ? 1 : 0);
