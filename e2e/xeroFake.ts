// Xero, faked at the browser's network layer.
//
// The wizard never talks to Xero. It depends on exactly four things, all of which pass
// through the browser and can be answered by page.route():
//
//   1. "Connect to Xero" navigates the tab to Flask `/xero_connect?...`. Flask would send
//      the user to login.xero.com and, on return, redirect back to
//      `/?xero=connected&step=3&org=<tenant>` (or `xero=mismatch&expected=<email>`,
//      `xero=conflict&conflict_entity=<name>`). We answer the navigation with that
//      redirect directly, so the wizard's own return-path code runs unchanged.
//   2. `GET /api/onboarding/state` carries `xero.connected`, and the wizard re-reads it on
//      every landing at step 4 or later. The real response is fetched and only `xero`
//      (and `modules`, see below) is overwritten, so saved_step, the entity fields and the
//      CORS headers are all the real service's.
//   3. `account-codes`, `contacts`, `contacts/create`, `bill-codes` are Xero-backed and
//      answer 409 without a real org. They get fixtures (e2e/fixtures/xero.ts).
//   4. `payment-method` on All Set goes to Stripe. It gets "no card, no consent".
//
// `modules` is forced to both modules so steps 5-8 render whatever the test entity's
// entity_function_map holds. That also means the real `POST /finalize` at step 9 creates
// no trial rows unless the DB has modules enabled -- see e2e/README.md.
//
// The fake is STATEFUL like the real thing: `connected` starts false, flips on a
// successful `/xero_connect`, and flips back on `xero/disconnect`. `posted` keeps every
// JSON body the wizard sent to a faked endpoint so a spec can assert on it.
//
// Everything not listed here reaches the real stack.

import type { Page, Request, Route } from '@playwright/test';
import { accountCodes, billCodes, FAKE_ORG } from './fixtures/xero';
import { BASE_URL } from './urls';

export type XeroOutcome =
  | { kind: 'connected' }
  | { kind: 'mismatch'; expected: string }
  | { kind: 'conflict'; conflictEntity: string };

export type XeroFake = {
  /** What the fake currently tells the wizard the backend believes. */
  readonly connected: boolean;
  setConnected(value: boolean): void;
  /** What the next `/xero_connect` round-trip comes back with. Default: connected. */
  setOutcome(outcome: XeroOutcome): void;
  /** JSON bodies the wizard POSTed to faked endpoints, keyed by path after `/api/onboarding/`. */
  readonly posted: Record<string, unknown[]>;
};

const API = '/api/onboarding/';

/**
 * A JSON reply the wizard's cross-origin fetch will accept.
 *
 * The wizard runs on 3001 and calls 8001 with an Authorization header, so every synthetic
 * response needs the CORS headers the real service would have sent, and a preflight has
 * to be answered too. (The `/state` route sidesteps this by reusing the real response.)
 */
async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, json: body, headers: cors(route.request()) });
}

function cors(request: Request): Record<string, string> {
  return {
    'access-control-allow-origin': request.headers()['origin'] || BASE_URL,
    vary: 'Origin',
  };
}

async function preflight(route: Route): Promise<void> {
  const req = route.request();
  await route.fulfill({
    status: 204,
    headers: {
      ...cors(req),
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers':
        req.headers()['access-control-request-headers'] || 'authorization, content-type',
      'access-control-max-age': '600',
    },
  });
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
}

export async function installXeroFake(
  page: Page,
  { org = FAKE_ORG }: { org?: string } = {},
): Promise<XeroFake> {
  let connected = false;
  let outcome: XeroOutcome = { kind: 'connected' };
  const posted: Record<string, unknown[]> = {};
  let createdContacts = 0;

  const record = (key: string, body: unknown) => {
    (posted[key] ||= []).push(body);
  };

  /** Route one `/api/onboarding/<name>` path; OPTIONS is answered before `handler` runs. */
  const api = (name: string, handler: (route: Route, request: Request) => Promise<void>) =>
    page.route(
      (url) => url.pathname === `${API}${name}`,
      async (route, request) => {
        if (request.method() === 'OPTIONS') return preflight(route);
        try {
          await handler(route, request);
        } catch (err) {
          // A poll (the wizard re-reads /state) can still be in flight when the page
          // navigates - the OAuth round-trip redirects it - or when the test's last
          // assertion passes and the page goes away. Playwright then disposes the fetched
          // response under the handler ("Response has been disposed") and would report
          // the throw as a failure of a request the browser itself abandoned. What the
          // wizard shows is asserted by the spec; an answer nobody is waiting for is not.
          const message = err instanceof Error ? err.message : String(err);
          if (page.isClosed() || /disposed|has been closed|already handled/.test(message)) return;
          throw err;
        }
      },
    );

  // 1. The OAuth round-trip, collapsed to its final redirect.
  await page.route(
    (url) => url.pathname === '/xero_connect',
    async (route) => {
      const back = new URL('/', BASE_URL);
      back.searchParams.set('xero', outcome.kind);
      back.searchParams.set('step', '3');
      if (outcome.kind === 'connected') {
        connected = true;
        back.searchParams.set('org', org);
      } else if (outcome.kind === 'mismatch') {
        back.searchParams.set('expected', outcome.expected);
      } else {
        back.searchParams.set('conflict_entity', outcome.conflictEntity);
      }
      await route.fulfill({ status: 302, headers: { location: back.toString() } });
    },
  );

  // 2. The real state, with only the Xero-owned fields replaced.
  await api('state', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const real = await response.json();
    // The real headers minus the ones that describe the ORIGINAL body: the patched
    // body is longer, and a stale content-length can truncate it in the browser --
    // which the wizard reads as "no state", falls back to standalone mode, and then
    // fakes the Xero connection locally without ever leaving the page.
    const headers = { ...response.headers() };
    delete headers['content-length'];
    delete headers['content-encoding'];
    delete headers['transfer-encoding'];
    await route.fulfill({
      status: response.status(),
      headers,
      json: {
        ...real,
        xero: { connected, org: connected ? org : '' },
        modules: ['PETTY_CASH', 'PAYMENT_REQUEST'],
      },
    });
  });

  await api('xero/disconnect', async (route, request) => {
    record('xero/disconnect', await jsonBody(request));
    connected = false;
    await fulfillJson(route, { ok: true, connected: false });
  });

  // 3. Xero-backed data for steps 5-8.
  await api('account-codes', async (route, request) => {
    if (request.method() === 'GET') return fulfillJson(route, accountCodes);
    record('account-codes', await jsonBody(request));
    await fulfillJson(route, { ok: true });
  });

  await api('contacts', async (route, request) => {
    record('contacts', await jsonBody(request));
    await fulfillJson(route, { ok: true });
  });

  await api('contacts/create', async (route, request) => {
    const body = (await jsonBody(request)) as { name?: string } | null;
    record('contacts/create', body);
    createdContacts += 1;
    await fulfillJson(route, { id: `contact-new-${createdContacts}`, label: body?.name || '' }, 201);
  });

  await api('bill-codes', async (route, request) => {
    if (request.method() === 'GET') return fulfillJson(route, billCodes);
    record('bill-codes', await jsonBody(request));
    await fulfillJson(route, { ok: true });
  });

  // 4. Keep All Set off Stripe.
  await api('payment-method', async (route) => {
    await fulfillJson(route, { has_payment_method: false, has_billing_consent: false, card: null });
  });

  return {
    get connected() {
      return connected;
    },
    setConnected(value) {
      connected = value;
    },
    setOutcome(next) {
      outcome = next;
    },
    posted,
  };
}
