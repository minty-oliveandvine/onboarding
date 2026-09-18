# Authentication — the onboarding app's half

The wizard has two ways of being entered, and both end with a Minty-minted JWT in the
URL. Nothing is verified here: every call carries the token to a backend that checks it
(`onboarding-backend/docs/features/authentication.md`), and the sign-in screens are thin
clients of Minty's own endpoints (`Minty/docs/features/authentication.md`).

## 1. Launched from Minty

Minty's *Create company* (and *resume*) send the browser to `/?token=<jwt>[&entity_id=…]
[&entity_name=…][&fresh=1]` — the 60-minute `scope: "onboarding"` token
(`components/OnboardingApp.tsx` reads `token`, `entity_id`, `entity_name`, `fresh` from
the query). The app keeps the token in memory and, with the state and the step reached,
in `sessionStorage` (survives a reload, not a new tab) — the **database is the source of
truth** for resume; the browser copy is a cache (`GET /api/onboarding/state`).

## 2. The sign-in page (`/auth`, `app/auth/page.tsx`; `/auth/confirm`)

For people who arrive by link — an invitation, or self-serve sign-up (`?mode=signup`).
Two paths, both Minty's:

- **Email OTP** — `POST {FLASK_BASE}/auth/email/check` (login mode refuses an unknown
  address before a code is sent), `POST …/request-code`, then `/auth/confirm` posts the
  code to `POST …/verify-code` (with the invite token and the terms agreement when there
  is one); a new address completes sign-up with `POST …/auth/email/complete`. Because the
  verify happens **cross-origin**, Minty answers with a `redirect_url` — a signed hand-off
  (`GET /auth/email/handoff`) — and the page follows it, so the session cookie is set on
  Minty's origin before the wizard is launched. The code is valid 60 s, five wrong tries lock the
  address for 15 minutes — the page shows Minty's wording for both.
- **Sign in with Xero** — `window.location = {FLASK_BASE}/xero_auth[?invite=…]`; Xero
  redirects to the bare `/auth` (its registered redirect URI), so the invite token and
  email are stashed in `sessionStorage` before the hop and recovered after
  (`lib/pendingInvite.ts`); the URL always wins when it carries them.
  `?error=wrong_account` is Minty bouncing a person who signed into Xero as somebody else.

The **terms modal** (`components/TermsModal.tsx`) shows the current Terms fetched from
Minty (`GET /legal/current`, `GET /legal/content/terms`) on sign-up and the agreement rides
along with the verify call, so the consent is recorded with the version that was shown
(`signup_otp` / `signup_invite`).

Self-serve sign-up collects first and last name up front (the user row requires them).

## Where the calls go

`lib/flaskBase.ts`: `NEXT_PUBLIC_MODULE1_API_URL` — Minty; `lib/apiRoutes.ts`:
`NEXT_PUBLIC_ONBOARDING_API_URL` — onboarding-backend, for the paths listed in
`DJANGO_PATHS`; everything else (`/auth/email/*`, `/legal/*`, `/xero_auth`,
`/xero_connect`, `/logout`, `/entity`) is Minty. Both are inlined at build time — an unset
value silently means `localhost` and breaks the OTP and Xero calls in a deployment.

## Tests

`e2e/resume.spec.ts` (a valid launch token opens the wizard, the token is stripped from
the address bar, a forged / expired / wrong-scope token is refused), `e2e/stack.spec.ts`;
the suite mints its own tokens with the shared `SECRET_KEY` (`e2e/README.md`).
Unit tests (`npm test`, Vitest): `lib/__tests__/apiRoutes.test.ts` (which service answers
each path), `invites.test.ts`, `validation.test.ts`, `wizardSteps.test.ts`, `date.test.ts`.
