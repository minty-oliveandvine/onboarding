# Cleanse Baseline — recorded before any changes

Date: 2026-07-27
Branch: `code-cleanse` (created off `Minty-Onboarding`)
Commit at baseline: d9f8877

## Critical finding: there is NO test suite

This is a Next.js 16 / React 19 app, not a Python project. There is:

- **No test framework** — no jest, vitest, mocha, playwright, cypress, or
  @testing-library in `package.json` or `node_modules`.
- **No test files** — zero matches for `*.test.*`, `*.spec.*`, `__tests__/`.
- **No `test` script** in `package.json` (scripts are: dev, build, start, lint).

Therefore the requested "record failing tests, diff against baseline after every
step" gate **cannot be run as specified**. The substitute gates are below. They
are weaker than tests: they catch syntax errors, type errors, unresolved
imports, and unused/undefined symbols, but they do **not** catch behavioral
regressions. This materially limits how aggressive the cleanse can safely be.

Also note: the monkeypatch/`patch()` grep step is Python-specific and has no
direct equivalent. The JS analogue (module-level mocking via `jest.mock` /
`vi.mock`) has zero occurrences, since there are no tests at all. So there are
no load-bearing patched names constraining where code may move.

## Substitute gates (the "no regression" rule)

Rule from here on: **the build must stay green, and lint must not exceed the
recorded 46 messages.** Any new lint message or build failure = regression.

### Gate 1 — production build (HARD gate)

```
rm -rf .next && npx next build
```

Baseline: **PASSES**. Compiles, typechecks, and prerenders 7 routes.

Routes (`.cleanse-baseline/build-routes.txt`):

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /auth
├ ○ /auth/confirm
├ ○ /auth/verify
└ ○ /icon.png
```

The route list is part of the baseline — a cleanse must not add or drop routes.

### Gate 2 — ESLint (already red; must not get redder)

```
npx eslint .
```

Baseline: **46 problems (15 errors, 31 warnings)** — already failing, which is
fine and matches the "suite is already red" situation. These are pre-existing
and are **NOT** to be fixed as part of the cleanse; that is separate work.

Machine-diffable baseline: `.cleanse-baseline/eslint-baseline.tsv`
(`file<TAB>line<TAB>col<TAB>severity<TAB>rule`, sorted).
Raw JSON: `.cleanse-baseline/eslint-baseline.json`.

Note line/column numbers shift as code is edited, so diff on the
`(file, rule)` pair and the per-rule counts rather than exact lines.

By rule:

| count | rule |
|---|---|
| 13 | @typescript-eslint/no-unused-vars |
| 12 | @next/next/no-img-element |
| 11 | react-hooks/set-state-in-effect |
| 3 | @typescript-eslint/no-unused-expressions |
| 2 | react-hooks/refs |
| 2 | react-hooks/purity |
| 2 | @next/next/no-page-custom-font |
| 1 | jsx-a11y/role-supports-aria-props |

By file:

| count | file |
|---|---|
| 20 | components/OnboardingSteps.jsx |
| 7 | app/auth/page.tsx |
| 4 | components/OnboardingApp.jsx |
| 4 | components/MintySelect.jsx |
| 3 | components/Toast.jsx |
| 2 | components/Confetti.jsx |
| 2 | app/layout.tsx |
| 2 | app/auth/confirm/page.tsx |
| 1 | components/NavMenu.jsx |
| 1 | app/auth/verify/page.tsx |

The 13 `no-unused-vars` are the most likely dead-code leads.

### Gate 3 — undefined-name check (analogue of `ruff --select F821`)

JS has no exact F821. Closest equivalents, to run across the **whole** folder
after any change touching more than one subfolder:

```
npx tsc --noEmit                     # unresolved imports / type errors
npx eslint . --rule '{"no-undef":"error"}'
```

Caveat on `npx tsc --noEmit` standalone: it reads stale generated types in
`.next/` and reports phantom errors about a deleted `app/toast-preview` route.
`.next/` is gitignored generated output. Always `rm -rf .next` first, or rely on
the typecheck that runs inside `next build` (which is clean).

### Gate 4 — syntax validity after bulk edits

After any scripted/bulk edit, re-parse every modified file (the `next build`
compile step covers this, but for a fast local check use the eslint run, which
reports fatal parse errors as messages).

## Repo inventory

Total tracked source: **7,477 LOC** across 21 files.

| subfolder | files | code LOC | notes |
|---|---|---|---|
| `lib/` | 4 | 260 | smallest — start here |
| `app/` | 7 | 2,654 | 1,527 of which is `globals.css` |
| `components/` | 8 | 4,526 | largest; two 1.7k-line files |
| `docker/` | 4 | 0 | Dockerfile, compose, env example, README |
| `public/` | 9 | 0 | static assets only |

Per file:

```
    5  app/page.tsx
    7  lib/entityOptions.js
    7  postcss.config.mjs
   12  next.config.ts
   18  eslint.config.mjs
   34  app/layout.tsx
   39  lib/refData.js
   66  lib/pendingInvite.js
   72  components/Confetti.jsx
  136  components/Icon.jsx
  148  lib/amount.js
  164  components/MintyDatePicker.jsx
  176  components/Toast.jsx
  189  components/NavMenu.jsx
  198  app/auth/verify/page.tsx
  296  components/MintySelect.jsx
  428  app/auth/page.tsx
  462  app/auth/confirm/page.tsx
 1527  app/globals.css
 1723  components/OnboardingApp.jsx
 1770  components/OnboardingSteps.jsx
```

## Planned order (smallest subfolder first)

1. `lib/` (260 LOC, 4 files)
2. `app/` (2,654 LOC) — excluding `globals.css` from any reformat commit
3. `components/` (4,526 LOC) — the two 1.7k-line files are over the ~1000-line
   threshold, so no opinionated reformatter in the same commit as logic changes

Each subfolder: dead code → verify → duplication → verify → format → verify,
pausing for review between subfolders.

## Tooling notes

- Formatter: **no Prettier** is configured (not in deps, no `.prettierrc`).
  There is no `isort`/`black` analogue set up. So the third "formatter" step of
  each subfolder is a no-op unless you want Prettier introduced — that would be
  a large unrelated diff and I will not add it without you asking.
- `npm ci` was run to populate `node_modules` (it was absent). 6 npm audit
  vulnerabilities reported (1 low, 5 high) — pre-existing, not part of cleanse.
- `AGENTS.md` warns this Next.js version has breaking changes vs training data
  and requires reading `node_modules/next/dist/docs/` before writing code.
