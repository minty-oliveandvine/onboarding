# Onboarding wizard

The nine-step wizard a new customer walks to create a company, pick modules, connect Xero and
start a trial. Next.js 16 (App Router, Turbopack) + React 19, on **port 3001**.

```bash
npm install
cp docker/.env.example .env.local   # then point the two base URLs at your backends
npm run dev                          # http://localhost:3001
```

## It talks to two backends

| Paths                                                                            | Service                                              | Base URL                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| `/api/onboarding/*`                                                              | the extracted onboarding service (Django, port 8001) | `NEXT_PUBLIC_ONBOARDING_API_URL` |
| `/auth/email/*`, `/legal/*`, `/xero_auth`, `/xero_connect`, `/logout`, `/entity` | Minty (Flask, port 5001)                             | `NEXT_PUBLIC_MODULE1_API_URL`    |

**Which service answers a path is decided in exactly one place — [`lib/apiRoutes.js`](lib/apiRoutes.js).**
Nothing else reads a base URL. Moving an endpoint between the two is adding or deleting one line
there; `urlFor(path)` is used for fetches and for navigations alike.

Set both vars explicitly in any deployed environment. `NEXT_PUBLIC_*` is resolved at build time
and an unset var silently falls back to `localhost` — a failure this app has shipped before, which
is why [`lib/flaskBase.js`](lib/flaskBase.js) carries a note about it.

There is no cookie involved: every call carries the onboarding JWT as a bearer token, so no
`credentials: 'include'`.

## Scripts

|                                   |                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                     | dev server on 3001                                                           |
| `npm run dev:clean`               | dev server with a cleared `.next` cache                                      |
| `npm run dev:poke`                | wake the dev server (`scripts/dev-poke.mjs`)                                 |
| `npm test`                        | unit + component tests (vitest, jsdom) — **the per-commit gate**             |
| `npm run test:watch`              | the same, in watch mode                                                      |
| `npm run test:e2e`                | end-to-end against a running stack — see [e2e/README.md](e2e/README.md)      |
| `npm run build`                   | production build (also type-checks)                                          |
| `npm run lint`                    | eslint — **0 errors** is the baseline now                                    |
| `npm run format` / `format:check` | prettier (single quotes, width 100)                                          |
| `npm run check:routes`            | just the routing tests — asserts every wizard path reaches the right service |

## Before changing anything

- **[`docs/features/README.md`](docs/features/README.md)** — one page per feature: the sign-in
  page and the launch token, the nine steps, the Xero step and its network-layer fake.
- **[`docs/code_cleanse/CODE_CLEANSE_NOTES.md`](docs/code_cleanse/CODE_CLEANSE_NOTES.md)** — records what was deliberately kept, and
  why. Several things that look like dead code are not.
- **[`docs/ERROR_COPY.md`](docs/ERROR_COPY.md)** — the user-facing error standard, shared across the Minty
  repos. A failure is a sentence, not a status.

## Testing

|                  |                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| unit + component | **vitest** + React Testing Library, jsdom. `lib/__tests__/`, `components/__tests__/`                      |
| end-to-end       | **Playwright**, `e2e/` — needs the whole stack up, so it is a pre-merge gate rather than a per-commit one |

`npm test` is the gate to run before every commit; it needs nothing running. `npm run
test:e2e` needs Next, Flask, the Django onboarding service and Postgres all up, and its
authenticated half needs three environment variables — [e2e/README.md](e2e/README.md) has
the details, including **the one sharp edge: a test must never land on step 9**, because
arriving at "All Set" finalizes the entity and opens trial subscriptions.

The whole app is TypeScript — `app/`, `components/`, `lib/` and the tests — at full
`strict`, with `allowJs` off. `npx tsc --noEmit` is a gate; keep it at zero. The shapes
the wizard holds live in [`lib/types.ts`](lib/types.ts) and the API contract in
[`lib/api.ts`](lib/api.ts) — add to those rather than inlining a type at a call site.

**There is no CI in this repo**, so "gate" means a command somebody runs.

`npm run build`, `npm run lint` (zero errors) and `npm run format:check` remain gates too.
