# Features — the onboarding wizard

`onboarding` is the Next.js wizard a person walks to create a company in Minty: nine
steps from the company name to a live company, entered with a token Minty minted. It
talks to two backends — `onboarding-backend` for `/api/onboarding/*` and Minty for
sign-in, legal text and the Xero connection — and never verifies anything itself.

| Feature | Document |
|---|---|
| Entering with Minty's token; the sign-in page (email OTP, Xero, invitations); the terms modal; which backend answers what | [authentication.md](authentication.md) — the system-wide picture is `Minty/docs/features/authentication.md` |
| The nine steps, saving and resuming, All Set finalizing on arrival, dark mode | [wizard.md](wizard.md) |
| Step 4 — connecting to Xero, the three returns, disconnecting, the network-layer fake in tests | [xero-step.md](xero-step.md) |
| User-facing error copy | [../ERROR_COPY.md](../ERROR_COPY.md) |

Running it and the two `NEXT_PUBLIC_*` variables: the repo `README.md` (port 3001). Tests:
`npm test` (Vitest) and `npm run test:e2e` (Playwright against a running stack —
`e2e/README.md`; 23 on 2026-09-18 against the deployed hosts, Xero faked at the browser).
The cleanse log is in `../code_cleanse/`.
