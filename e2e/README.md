# End-to-end tests

```bash
npm run test:e2e
```

These run a real browser against a **stack that is already running**. They start nothing:
booting four services from a test runner would turn "Flask isn't up" into a failed
assertion instead of a readable message. Each spec checks what it needs is reachable and
**skips with a reason** when it is not, so an unconfigured run reads as *not run here*,
never as *passed*.

## What has to be up

| Service | Port | Repo |
|---|---|---|
| Next (the wizard) | 3001 | this one — `npm run dev` |
| Flask (Minty) | 5001 | `C:\dev\Minty` |
| Onboarding API (Django) | 8001 | `C:\dev\onboarding-backend` |
| PostgreSQL | 5432 | — |

Override any of them with `E2E_BASE_URL`, `E2E_FLASK_URL`, `E2E_ONBOARDING_API_URL`.

## The authenticated specs

`stack.spec.ts` needs no login. `resume.spec.ts` does, and it skips entirely unless all
three of these are set:

| Variable | What |
|---|---|
| `E2E_JWT_SECRET` | the `SECRET_KEY` shared by Minty and the onboarding service |
| `E2E_USER_ID` | a user who is an approved member of the entity below |
| `E2E_ENTITY_ID` | **a disposable entity — the specs WRITE to it** |

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

`ee72f706-49f2-4690-83d6-e5f8d284ba2c` — *"E2E Test Entity (do not use)"*, status
`onboarding`, saved step 2, with `68bfc5d3…` as an approved admin. It exists so runs
never touch an entity anyone cares about. To recreate it:

```sql
INSERT INTO pettycashv2.entities (id, name, country_code, currency_id, status, onboarding_saved_step)
VALUES (gen_random_uuid()::text, 'E2E Test Entity (do not use)', 'HK',
        'fc848405-ffc2-4722-a309-b4b6828c4233', 'onboarding', 2);
INSERT INTO pettycashv2.user_entity (user_id, entity_id, role, approved)
VALUES ('<your dev user id>', '<the id above>', 'admin', TRUE);
```

## NEVER LET A TEST LAND ON STEP 9

This is the sharpest edge in the whole suite, and it cost a dev entity to find.

Step 9 is "All Set", and **arriving there runs `completeOnboarding`** —
`OnboardingApp.jsx:1204` notes that the screen itself "commits nothing" precisely because
arrival already did. That call submits the opening balance and POSTs `/finalize`, which
flips the entity to `active` and opens a trial subscription **per module**.

An early version of `resume.spec.ts` landed on whatever step the row happened to hold.
The entity it pointed at was sitting on 9, so the test finalized it and created two trial
rows before asserting anything.

`land()` now **pins `saved_step` through the API before every navigation** and throws if
asked for step 9. Do not add a navigation that skips it.

## What this layer deliberately does not cover

**The full nine-step walk to finalize.** Step 4 is a live Xero OAuth round-trip against
Xero's own servers. There is no test-account path through it, and faking the callback
would only test the fake — so the wizard cannot be driven past step 4 by a test. Steps
5–9 are covered by the unit and component suites instead, and the gap is real: no
automated test walks a company all the way through.

**The email OTP sign-in**, for the same reason — it ends at an inbox.

## Failures

Traces and screenshots are kept only for failures, under `test-results/`:

```bash
npx playwright show-trace test-results/<the-failing-test>/trace.zip
```
