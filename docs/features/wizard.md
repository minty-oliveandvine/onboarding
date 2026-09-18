# The wizard — nine steps from a company name to a live company

`components/OnboardingApp.tsx` is the state machine (one `WizardState`, `lib/types.ts`;
`initialState()` and the step rules in `lib/wizardSteps.ts`), `components/OnboardingSteps.tsx`
the nine screens, `components/Stepper.tsx` the rail. Every write goes to
`/api/onboarding/*` through `lib/api.ts` with the launch token
(`onboarding-backend/docs/features/wizard-api.md` is the contract).

## The steps (`lib/wizardSteps.STEPS`)

| # | Screen | Component | Writes |
|---|---|---|---|
| 1 | Basic Information — name, country, currency, phone, email | `StepCreateEntity` | `POST /create` on the first advance, `PUT /entity/{id}` after |
| 2 | Select Module — Petty Cash, Payment Request; with subscriptions on, the price summary and the billing sheet (`BillingSheet.tsx`: card capture through Stripe, consent); while dark a plain pick | `StepSelectModule` | `POST /modules`, the `billing/*` routes when on |
| 3 | User Invite — invite colleagues with a role | `StepInvite` | `POST /invite`, `/invite/cancel` |
| 4 | Connect to Accounting System — Xero | `StepConnectXero` | Minty's `/xero_connect` ([xero-step.md](xero-step.md)) |
| 5 | Sales Setting — electronic and delivery methods, and the opening balance (the cash in the drawer on day one) | `StepSalesSetting` | `POST /sales-methods`, `POST /opening-balance` |
| 6 | Account Code Setting — the expense accounts and the petty-cash account mapping | `StepAccountCode` | `POST /account-codes` |
| 7 | Others — the three petty-cash contacts (director, cash sale, discrepancy; a new one can be created in Xero) | `StepOthers` | `POST /contacts`, `/contacts/create` |
| 8 | Payment Settings — the bills' account codes | `StepBills` | `POST /bill-codes` |
| 9 | All Set | `StepAllSet` | **`POST /finalize` on arrival** |

The rail groups 5–7 as *Petty Cash Settings* and shows 8 only when that module was
chosen (`getDisplaySteps`); `isStepComplete` decides the ticks. Each screen's chrome (the
Save & Next / Save & Exit buttons, the errors) is `components/steps/StepChrome.tsx`;
shared fields in `components/steps/pettyCashFields.tsx`, the pricing in
`components/steps/modulePricing.tsx`; selects and the date picker are the app's own
(`MintySelect`, `MintyDatePicker`).

## Saving and resuming

- Every advance and *Save & Exit* post `saved_step` (`POST /saved-step`), so a resume
  lands where the person left off; the app also mirrors state and the furthest step
  reached into `sessionStorage`.
- On launch with an `entity_id` (or after a reload) the app reads `GET /state` and
  **trusts the database**: the saved step is where it lands; the backend's
  `current_step` / `max_reached` only raise the ceiling of unlocked steps — the backend
  derives its number from a different ordering (modules → Xero → petty cash → bills)
  and using it as the landing step once jumped people straight to *Connect to
  Accounting*. Never make the two orderings one.
- `fresh=1` starts a brand-new company even when an unfinished one exists.

## All Set finalizes on arrival

Reaching step 9 runs `completeOnboarding()`: it submits the opening balance and posts
`/finalize`, which flips the company from `onboarding` to live, enables the chosen modules
and — only when subscriptions are on — starts the trials; the screen itself commits
nothing, and *Go to Minty* leaves. **Never navigate a test straight to step 9**
(`e2e/README.md`, `land()` in `e2e/onboardingApi.ts` refuses it); `walk.spec.ts` reaches it
by clicking *Complete* on step 8 against the disposable entity.

## Dark mode

`state.subscriptions_enabled` (from `/state`) drives step 2 and step 9: no plans, no
billing sheet, consent not required, the All Set wording states no trial.

## Copy and errors

`lib/errorCopy.ts` and `docs/ERROR_COPY.md`: the backends answer `{"error": "…"}` in the
words the wizard shows; the app never invents a message for a status it does not know.

## Tests

Unit (`npm test`): `lib/__tests__/wizardSteps.test.ts`, `validation.test.ts`, `invites.test.ts`,
`components/__tests__/Stepper.test.tsx`, `StepChrome.test.tsx`, `pettyCashFields.test.tsx`,
`MethodList.test.tsx`. Browser (`npm run test:e2e`): `e2e/stack.spec.ts` (the two backends
answer), `resume.spec.ts` (the database decides the landing step; `saved_step` and
`current_step` may disagree; an out-of-range step is refused), `xero.spec.ts`,
`walk.spec.ts` (the whole wizard to All Set, Xero faked) — 23 on 2026-09-18 against the
deployed hosts.
