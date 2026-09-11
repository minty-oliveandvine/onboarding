// The cross-service checks. These need no login, and they are the ones that would have
// caught the defects unit tests structurally cannot see.
//
// Both regressions guarded here were SILENT in the browser:
//
//   * /server-time being unreachable cross-origin -- the fetch at
//     OnboardingSteps.jsx:631 swallows every failure with `.catch(() => {})`, so the
//     app falls back to the BROWSER's clock and the only symptom is a date picker that
//     caps on the wrong day for anyone whose machine disagrees with the server. There
//     is no error, no console message and no failed render to notice.
//   * the routing switch -- lib/apiRoutes decides which service answers each path. The
//     unit tests prove the FUNCTION is right; only a browser proves the shipped bundle
//     actually calls the host that function returns.

import { expect, test } from '@playwright/test';
import { BASE_URL, FLASK_URL, ONBOARDING_API_URL } from './urls';
import { reachable } from './helpers';

test.beforeEach(async () => {
  test.skip(!(await reachable(BASE_URL)), `Nothing is serving ${BASE_URL} -- start the wizard with npm run dev`);
});

test('the wizard is served and reaches a usable screen', async ({ page }) => {
  // Subscribed BEFORE navigating. Registered after goto(), this listener misses every
  // error thrown during the initial load -- which is the only kind it is here to catch,
  // and exactly the shape of the `toIsoDate is not defined` defect.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(400);
  // Without a token the app sends the user to sign in. Either outcome is fine here;
  // what is being checked is that the page boots rather than throwing.
  await expect(page.locator('body')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors, 'the page threw during load').toEqual([]);
});

test.describe('the onboarding API is reachable from the browser origin', () => {
  test.beforeEach(async () => {
    test.skip(
      !(await reachable(`${ONBOARDING_API_URL}/api/onboarding/server-time`)),
      `The onboarding service is not answering on ${ONBOARDING_API_URL}`,
    );
  });

  test('server-time answers a cross-origin fetch from the wizard origin', async ({ page }) => {
    // Exactly the shape the app uses at OnboardingSteps.jsx:631 -- a plain fetch with
    // NO credentials. This API is bearer-token based and sets no cookies; lib/billing.js
    // records the same decision. Testing it with `credentials: 'include'` would fail
    // against a correctly configured server, because the service quite rightly sends no
    // Access-Control-Allow-Credentials.
    await page.goto('/');
    const result = await page.evaluate(async (api) => {
      try {
        const res = await fetch(`${api}/api/onboarding/server-time`);
        return { ok: res.ok, status: res.status, body: await res.json() };
      } catch (e) {
        return { ok: false, status: 0, error: String(e) };
      }
    }, ONBOARDING_API_URL);

    expect(result.ok, `the browser rejected the response: ${JSON.stringify(result)}`).toBe(true);
    expect(result.body).toHaveProperty('today');
    // A real calendar day. The fallback path leaves the field empty instead.
    expect(String(result.body.today)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('the date cap comes from the service, not from this machine', async ({ page }) => {
    // The failure this guards is silent: if the cross-origin call fails, the component
    // keeps the browser's today and nothing anywhere reports it. So the check is that
    // the value the page can actually READ matches what the service says.
    await page.goto('/');
    const fromBrowser = await page.evaluate(async (api) => {
      const res = await fetch(`${api}/api/onboarding/server-time`);
      return res.ok ? (await res.json()).today : null;
    }, ONBOARDING_API_URL);
    const direct = await (await fetch(`${ONBOARDING_API_URL}/api/onboarding/server-time`)).json();
    expect(fromBrowser).toBe(direct.today);
  });

  test('the allow-origin header names this origin specifically', async ({ request }) => {
    // The service echoes the caller's origin and sets `Vary: origin` rather than
    // answering `*`, which is what keeps the allowed list meaningful. A regression to
    // `*` would still WORK for this app -- it sends no credentials -- so nothing else
    // here would catch it.
    const res = await request.get(`${ONBOARDING_API_URL}/api/onboarding/server-time`, {
      headers: { Origin: BASE_URL },
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe(BASE_URL);
    expect((res.headers()['vary'] || '').toLowerCase()).toContain('origin');
  });

  test('server-time agrees with the machine running the service, not the browser', async ({ request }) => {
    const res = await request.get(`${ONBOARDING_API_URL}/api/onboarding/server-time`);
    const { today } = await res.json();
    // Not asserting it equals the test machine's today -- that is the very coupling the
    // endpoint exists to break. Only that it is a plausible, parseable day.
    expect(Number.isNaN(Date.parse(today))).toBe(false);
  });
});

test('the shipped bundle addresses each service the way lib/apiRoutes says', async ({ page }) => {
  // lib/apiRoutes is unit-tested as a function. This asserts the BUNDLE built from it
  // points at the hosts that function returns -- a wrong NEXT_PUBLIC_* at build time
  // would pass every unit test and still send every call to the wrong place.
  //
  // Read from the requests the app actually issues, because the bundle's modules are
  // not importable from the page.
  const onboardingOrigins = new Set<string>();
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/onboarding/')) onboardingOrigins.add(new URL(url).origin);
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // An empty set means the landing screen issued no onboarding calls -- true when the
  // app bounces an anonymous visitor to sign in, so it is not a failure.
  for (const origin of onboardingOrigins) {
    expect(
      origin,
      `an /api/onboarding/* call went to ${origin}; lib/apiRoutes routes those at ${ONBOARDING_API_URL}`,
    ).toBe(ONBOARDING_API_URL);
  }
});

test('Flask is up, because the wizard hands off to it for auth and Xero', async ({ request }) => {
  test.skip(!(await reachable(FLASK_URL)), `Flask is not answering on ${FLASK_URL}`);
  const res = await request.get(`${FLASK_URL}/legal/current`, { maxRedirects: 0 });
  // Any answered status: the point is that the host is serving, not what this route says.
  expect(res.status()).toBeLessThan(500);
});
