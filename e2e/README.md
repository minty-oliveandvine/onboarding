# End-to-end tests

```bash
npm run test:e2e
```

These run a real browser against a **stack that is already running**. They start nothing:
booting four services from a test runner would turn "Flask isn't up" into a failed
assertion instead of a readable message. Each spec checks what it needs is reachable and
**skips with a reason** when it is not, so an unconfigured run reads as _not run here_,
never as _passed_.

## What has to be up

| Service                 | Port | Repo                        |
| ----------------------- | ---- | --------------------------- |
| Next (the wizard)       | 3001 | this one — `npm run dev`    |
| Flask (Minty)           | 5001 | `C:\dev\Minty`              |
| Onboarding API (Django) | 8001 | `C:\dev\onboarding-backend` |
| PostgreSQL              | 5432 | —                           |

Override any of them with `E2E_BASE_URL`, `E2E_FLASK_URL`, `E2E_ONBOARDING_API_URL`.

## The authenticated specs

`stack.spec.ts` needs no login. `resume.spec.ts`, `xero.spec.ts` and `walk.spec.ts` do,
and they skip entirely unless all three of these are set:

| Variable         | What                                                        |
| ---------------- | ----------------------------------------------------------- |
| `E2E_JWT_SECRET` | the `SECRET_KEY` shared by Minty and the onboarding service |
| `E2E_USER_ID`    | a user who is an approved member of the entity below        |
| `E2E_ENTITY_ID`  | **a disposable entity — the specs WRITE to it, and `walk.spec.ts` FINALIZES it** |

Never commit these. Export them for the run:

```bash
export E2E_JWT_SECRET='<the shared SECRET_KEY from Minty/.env>'
export E2E_USER_ID='68bfc5d3-43d0-4026-b236-0fbc16f21bf9'
export E2E_ENTITY_ID='ee72f706-49f2-4690-83d6-e5f8d284ba2c'
npm run test:e2e
```

### Why the tests mint their own token

In production the wizard is entered from Minty with `?token=<jwt>`, minted after the user
signs in through the email OTP flow. A test cannot walk that flow — it ends at a real
inbox. But the token is an ordinary HS256 JWT over the secret both services already
share, so a test holding that secret can mint an equivalent one. **Nothing is bypassed:**
the Django service verifies this token exactly as it verifies Flask's — signature,
expiry, scope, and that the user exists. `resume.spec.ts` proves that, by asserting a
forged, expired or wrong-scope token is refused.

### The dedicated test entity

`ee72f706-49f2-4690-83d6-e5f8d284ba2c` — _"E2E Test Entity (do not use)"_, status
`onboarding`, saved step 2, with `68bfc5d3…` as an approved admin. It exists so runs
never touch an entity anyone cares about. To recreate it:

```sql
INSERT INTO pettycashv3.entities (id, name, country_code, currency_id, status, onboarding_saved_step)
VALUES (gen_random_uuid()::text, 'E2E Test Entity (do not use)', 'HK',
        'fc848405-ffc2-4722-a309-b4b6828c4233', 'onboarding', 2);
INSERT INTO pettycashv3.user_entity (user_id, entity_id, role, approved)
VALUES ('<your dev user id>', '<the id above>', 'admin', TRUE);
```

## NEVER LET A TEST NAVIGATE TO STEP 9

This is the sharpest edge in the whole suite, and it cost a dev entity to find.

Step 9 is "All Set", and **arriving there runs `completeOnboarding`** —
`OnboardingApp.tsx` notes that the screen itself "commits nothing" precisely because
arrival already did. That call submits the opening balance and POSTs `/finalize`, which
flips the entity to `active` and opens a trial subscription **per enabled module**.

An early version of `resume.spec.ts` landed on whatever step the row happened to hold.
The entity it pointed at was sitting on 9, so the test finalized it and created two trial
rows before asserting anything.

`land()` (in `onboardingApi.ts`) now **pins `saved_step` through the API before every
navigation** and throws if asked for step 9. Do not add a navigation that skips it.

The one spec that does reach All Set is `walk.spec.ts`, and it gets there the way a user
does: by clicking "Complete" on step 8. It calls `resetEntity()` before and after, and it
only makes sense against the disposable entity above.

## Xero is faked at the browser

Step 4 is a real OAuth round-trip through Flask to login.xero.com. No test can walk that,
so `xero.spec.ts` and `walk.spec.ts` install `xeroFake.ts`, a set of `page.route()`
handlers that answer the few things the wizard actually depends on. Nothing in the app is
changed or flagged; the fake sits in the browser's network layer.

What the wizard depends on is small, which is what makes the fake trustworthy — the
contract is one redirect out, three query parameters back, and one boolean:

| Request | Real or faked | What the fake does |
|---|---|---|
| navigation to Flask `/xero_connect` | **faked** | 302 straight back to `/?xero=connected&step=3&org=…` (or `mismatch` / `conflict`), exactly what Flask sends after Xero's callback |
| `GET /api/onboarding/state` | real, **patched** | the real response with only `xero` and `modules` overwritten, so `saved_step`, the entity fields and the CORS headers are the service's own |
| `GET/POST account-codes`, `POST contacts`, `contacts/create`, `GET/POST bill-codes` | **faked** | fixtures from `fixtures/xero.ts`; POST bodies are recorded so specs assert what the wizard sent |
| `POST xero/disconnect` (from the page) | **faked** | flips the fake to disconnected |
| `GET payment-method` | **faked** | "no card, no consent" — keeps All Set off Stripe |
| everything else: token auth, `saved-step`, `sales-methods`, `opening-balance`, `invite`, `finalize` | **real** | — |

`modules` is forced to both, so steps 5–8 render regardless of what `entity_function_map`
holds for the test entity.

The fake is stateful like the real thing: `connected` starts false, flips on a successful
`/xero_connect`, and flips back on disconnect. That is what lets the "resumed past step 4
without a connection" prompt be tested.

### Resetting the entity after a walk

`resetEntity()` puts the row back with two calls a test is already allowed to make:

1. `POST /api/onboarding/xero/disconnect` — the only token-authenticated endpoint that
   writes `entities.status`. For an entity with no Xero connector Flask skips the remote
   revoke and just sets `status = 'onboarding'` and nulls `xero_org_id`. It needs
   `XERO_SETTINGS_UPDATE`, which the admin seeded above holds.
2. `POST /api/onboarding/saved-step` with the value stashed before the walk.

What a walk leaves behind, on purpose: the entity's sales methods
(`entity_sale_setting`) and a draft opening balance (`report`), both reconciled by the
next run. And, **only if the test entity has modules enabled in `entity_function_map`**,
the `entity_module_subscription` trial rows the first finalize inserts — later finalizes
skip modules that already have one. The seed above enables none, so a freshly created
test entity accumulates nothing. If yours does, clear them by hand:

```sql
DELETE FROM pettycashv3.entity_module_subscription WHERE entity_id = '<the id>';
```

## What this layer deliberately does not cover

**Xero itself.** The fake proves the wizard handles every outcome Flask can send back; it
proves nothing about Flask's OAuth handling or Xero's API. Those live in Minty's own tests.

**The email OTP sign-in**, for the same reason as the real OAuth — it ends at an inbox.

## Failures

Traces and screenshots are kept only for failures, under `test-results/`:

```bash
npx playwright show-trace test-results/<the-failing-test>/trace.zip
```
