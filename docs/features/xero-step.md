# Step 4 — Connect to Accounting System (Xero)

The one step that leaves the wizard. `StepConnectXero` (`components/OnboardingSteps.tsx`)
and the handlers in `components/OnboardingApp.tsx` (`connectXero`, `disconnectXero`, the
return-path parsing).

## Connecting

*Connect to Xero* navigates the tab to Minty:
`{FLASK_BASE}/xero_connect?from=onboarding&entity_id=<id>&entity_name=<name>` — the
entity travels in the query so Minty can embed it in the OAuth `state` and bind the
tenant to **exactly this company** on the callback (`entity_id` is the exact match,
`entity_name` the fallback; neither would fall back to the person's latest in-progress
company). Before leaving, the app stashes its state in `sessionStorage` so the return
lands on the same step. Minty does the OAuth round-trip with its minimal scope set, stores
the token on the connecting person, starts the accounts/contacts sync and sends the
browser back to the wizard root with one of:

| Return | Meaning | What the step shows |
|---|---|---|
| `/?xero=connected&step=3&org=<tenant>` | connected; the tenant name | *Connected to <org>*, the Save & Next unlocks |
| `/?xero=mismatch&expected=<email>` | the person signed into Xero as somebody else | the mismatch notice with the expected email; the connection is not made |
| `/?xero=conflict&conflict_entity=<name>` | that Xero organisation is already connected to another company | the conflict notice naming the other company, which has to be disconnected first |

On every landing at step 4 or later the app re-reads `GET /state` and takes
`xero.connected` / `xero.org` from the database, so a reload after the round-trip is
consistent.

## Disconnecting

*Disconnect* posts `POST /api/onboarding/xero/disconnect` (proxied to Minty, which
revokes the connection at Xero and clears the token state); the company stays in
`onboarding` and is still resumable. Steps 6–8 need a connected organisation — their
endpoints (`account-codes`, `contacts`, `bill-codes`) answer 409 without one.

## In the browser tests

No test can walk login.xero.com, so `e2e/xeroFake.ts` fakes Xero **at the network layer**
with `page.route()`, and only the four things the wizard depends on: the navigation to
`/xero_connect` is answered with the redirect Minty would send; `/state` is fetched for
real and only its `xero` (and `modules`) overwritten; the four Xero-backed endpoints get
fixtures (`e2e/fixtures/xero.ts`); `payment-method` on All Set answers "no card, no
consent". The fake is stateful (`connected` flips on connect and disconnect) and keeps
every body the wizard posted so a spec can assert on it. `e2e/xero.spec.ts` covers the
three returns, disconnecting, and resuming past step 4 without a connection (sent back to
Connect); `walk.spec.ts` uses the fake to reach All Set. Everything not listed reaches the
real stack.
