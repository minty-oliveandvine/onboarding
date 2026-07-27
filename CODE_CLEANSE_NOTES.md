# Code Cleanse Notes

Branch: `code-cleanse` (off `Minty-Onboarding`, baseline commit `d9f8877`).
Started 2026-07-27. Resume-safe: this file records everything needed to pick the
work up in a fresh session.

The cleanse originally kept a `.cleanse-baseline/` folder of recorded gate
output. It was **deleted after the cleanse finished** (256 KB of scaffolding,
250 KB of which was a raw eslint JSON dump). Everything load-bearing from it is
inlined into this file — see "Pre-cleanse baseline (recorded before any
changes)" below.

**Status: ALL THREE SUBFOLDERS COMPLETE (`lib/`, `app/`, `components/`) and
COMMITTED as `ef213b3` on branch `code-cleanse`. Not pushed.**

Note: `ef213b3` is titled "/lib and /app code-cleasing" but actually contains
**all three** subfolders, `components/` included.

### Final result vs baseline

| gate | baseline | after |
|---|---|---|
| `next build` | passes | **passes** |
| routes | 7 | **6** (intentional: `/auth/verify` deleted) |
| eslint total | 46 (15 err, 31 warn) | **29 (15 err, 14 warn)** |
| eslint errors | 15 | **15 — unchanged, all pre-existing** |
| `no-undef` | 3 | **2** |

Source lines: **-484 / +136**. No test suite existed, so no test could regress;
every merge was instead proven with an SSR render-diff or a runtime
equivalence harness (details per subfolder below).

### Remaining optional work

1. **`restart` in `OnboardingApp`** — unwired feature logic, left in place
   pending your decision (see the `components/` section).
2. **`.otp-row-empty`** — class applied in `confirm/page.tsx` with no rule
   defined (see the `app/` section).
3. **Prettier** — still not configured; the "formatter" step was a no-op in all
   three subfolders. If ever added, run it as its own commit, and keep the two
   1.7k-line component files out of any commit carrying logic changes.
4. **The 15 pre-existing eslint errors** — untouched by design, separate work.

---

## Step 0 — Survey (done)

Pre-cleanse baseline detail is inlined below (the `.cleanse-baseline/` folder it
originally lived in has been deleted).

### The headline: this is a JS repo with no tests

The requested process assumed Python + pytest. This repo is **Next.js 16 /
React 19**. Consequences:

| requested | actual |
|---|---|
| run test suite, record failures | **no test suite exists** — no framework, no test files, no `test` script |
| `monkeypatch.setattr` / `patch("mod.Name")` grep | Python-only. JS analogue (`jest.mock`/`vi.mock`/sinon/proxyquire) = **zero hits**, since there are no tests |
| `ruff check --select F821` | no direct analogue; using `tsc --noEmit` + eslint `no-undef` |
| isort / black | **no Prettier configured**; no formatter step available |

So the "no test that passes today may start failing" rule has **no test suite to
enforce it**. I substituted the strongest gates available (below), but they are
genuinely weaker: they catch syntax/type/import/unused-symbol errors, **not
behavioral regressions**. This is the single most important constraint on how
aggressive this cleanse can safely be.

### Substitute gates — run after EVERY step

```
rm -rf .next && npx next build     # HARD gate: must stay green (baseline: PASSES)
npx eslint .                       # must not exceed baseline: 46 problems (15 err, 31 warn)
```

Diff on `(file, rule)` pairs and per-rule counts, not line numbers — those shift
as code is edited. The 46 pre-existing lint problems are **not** to be fixed
here (separate work).

Build route list is also part of the baseline — no route may appear or vanish.

#### Pre-cleanse baseline (recorded before any changes, commit `d9f8877`)

`next build`: **PASSES**, 7 routes — `/`, `/_not-found`, `/auth`,
`/auth/confirm`, `/auth/verify`, `/icon.png` (+ `(Static)` marker).

`npx eslint .`: **46 problems (15 errors, 31 warnings)**, by `(file, rule)`:

| count | file | rule |
|---|---|---|
| 13 | components/OnboardingSteps.jsx | @typescript-eslint/no-unused-vars |
| 5 | components/OnboardingSteps.jsx | @next/next/no-img-element |
| 4 | app/auth/page.tsx | react-hooks/set-state-in-effect |
| 3 | app/auth/page.tsx | @next/next/no-img-element |
| 2 | components/Toast.jsx | react-hooks/refs |
| 2 | components/OnboardingSteps.jsx | react-hooks/set-state-in-effect |
| 2 | components/OnboardingApp.jsx | react-hooks/set-state-in-effect |
| 2 | components/MintySelect.jsx | @typescript-eslint/no-unused-expressions |
| 2 | components/Confetti.jsx | react-hooks/purity |
| 2 | app/layout.tsx | @next/next/no-page-custom-font |
| 2 | app/auth/confirm/page.tsx | @next/next/no-img-element |
| 1 | components/Toast.jsx | react-hooks/set-state-in-effect |
| 1 | components/OnboardingApp.jsx | @typescript-eslint/no-unused-expressions |
| 1 | components/OnboardingApp.jsx | @next/next/no-img-element |
| 1 | components/NavMenu.jsx | react-hooks/set-state-in-effect |
| 1 | components/MintySelect.jsx | react-hooks/set-state-in-effect |
| 1 | components/MintySelect.jsx | jsx-a11y/role-supports-aria-props |
| 1 | app/auth/verify/page.tsx | @next/next/no-img-element |

`no-undef` over `app components lib`: **3** (all pre-existing `React`-global
artifacts of forcing the rule on without TS/JSX globals).

To regenerate an equivalent machine-diffable baseline in a future session:

```
npx eslint . -f json > /tmp/base.json
node -e 'const j=require("/tmp/base.json");const r=[];for(const f of j)for(const m of f.messages)r.push([f.filePath.replace(process.cwd()+"/",""),m.ruleId].join("\t"));r.sort();console.log(r.join("\n"))'
```

### Inventory — 7,477 LOC, 21 source files

| subfolder | files | code LOC |
|---|---|---|
| `lib/` | 4 | 260 |
| `app/` | 7 | 2,654 (1,527 = `globals.css`) |
| `components/` | 8 | 4,526 |
| `docker/`, `public/` | — | no code |

Planned order, smallest first: **`lib/` → `app/` → `components/`**.
`OnboardingApp.jsx` (1,723) and `OnboardingSteps.jsx` (1,770) are over the
~1000-line threshold, so no opinionated reformat in the same commit as logic.

---

## Load-bearing-name survey (the `patch()` equivalent)

**Result: nothing constrains where code may move.** Verified zero occurrences of:

- `jest.mock` / `vi.mock` / `jest.spyOn` / `sinon` / `proxyquire` / `rewire`
- dynamic `require(` or `import(` — every import is static
- `globalThis.X =` / `window.X =` runtime monkeypatching

The import graph is small and entirely static:

```
app/layout.tsx      -> components/Toast (ToastProvider)
app/page.tsx        -> components/OnboardingApp
app/auth/page.tsx   -> lib/pendingInvite (save/read/clearPendingInvite)
OnboardingApp.jsx   -> ./Icon, ./NavMenu, @/lib/amount (toAmountString)
OnboardingSteps.jsx -> ./Icon, ./MintySelect, ./MintyDatePicker, ./Confetti,
                       ./Toast (useToast), @/lib/refData (fetchCountries,
                       fetchCurrencies), @/lib/amount (acceptAmountInput,
                       formatAmount, toAmountEditString)
```

Because there are no tests patching module attributes, moving a function
between modules cannot silently break interception. The real risk here is the
opposite one: **no test will tell us if a merge changes behavior.**

---

## Subfolder 1 — `lib/` — DONE (uncommitted)

Net: **-49 lines** (69 deleted, 20 added), 4 files -> 3.
Read `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
first per AGENTS.md; confirmed nothing in the v16 caching/async-API breaking
changes applies here — `refData.js` is consumed only from a `'use client'`
component, so it is browser-side `fetch` with a plain module-level promise
cache, untouched by Next 16 server-caching changes.

### Step 1 — dead code -> VERIFIED

- **Deleted `lib/entityOptions.js`** (whole file, 7 LOC). Approved by you.
- **Deleted 4 declaration-only exports from `lib/amount.js`**: `parseAmount`,
  `formatMoney`, `isWithinAmountLimits`, `amountIntegerDigits`. Approved by you.
  Re-censused the survivors afterwards — `MAX_AMOUNT_INT_DIGITS`,
  `MAX_AMOUNT_DECIMALS` and `cleanAmountString` all still have real internal
  users, so nothing became newly-dead as a knock-on. `amount.js` 149 -> 112 LOC.

Verify: build green, 7/7 routes, lint **46 == baseline 46, IDENTICAL**.

### Step 2 — duplication -> VERIFIED

**Extracted `cachedListFetch(key)` in `lib/refData.js`**; `fetchCountries` and
`fetchCurrencies` are now one-line applications of it.

Proof they were safe to merge (your "never merge functions that only look
similar" rule):

1. **Textual proof.** Normalized the two bodies by mapping the domain nouns
   (`countries`/`country` and `currencies`/`currency` -> the same token) and
   diffed. Result: **byte-identical**. No hidden behavioral difference.
2. **Runtime proof.** Ran an old-vs-new equivalence harness over 7 scenarios
   x both functions: happy path, `res.ok === false`, key missing from payload,
   payload key not an array, null payload, network reject, `json()` throws.
   Compared return value, the **second** call's value (cache semantics), and
   the exact URLs requested. **All equivalent**, including the subtle
   retry-after-failure behavior (failures null the cache, so a failed list
   re-fetches on next call: `calls=2`; successes memoize: `calls=1`).
3. **Cache independence** explicitly tested — each fetcher closes over its own
   `promise` slot, so a countries failure does not evict currencies. A single
   shared cache would have been a real behavior change; it was avoided.

One judgement call worth flagging: the original had the endpoint path and the
JSON response key as two independent strings that happened to coincide
(`/api/onboarding/countries` -> `data.countries`). I collapsed them into one
`key` parameter. That is safe today for both call sites, but if the backend
ever exposes a registry whose path and payload key differ, `cachedListFetch`
will need the two split back into separate arguments.

No user-facing strings or log messages exist in this file, so the
byte-for-byte-preservation rule had nothing to bite on.

Verify: build green, 7/7 routes, lint **46 == baseline 46, IDENTICAL**.
Undefined-name check (`no-undef` across `app components lib`): 3 hits, but
**stash-tested against the pristine baseline, which also has exactly 3** —
they are pre-existing `React`-global artifacts of forcing the rule on without
TS/JSX globals, not caused by this work.
Both modified files re-parsed with `node --input-type=module`: **valid**.

### Step 3 — formatter -> N/A

No Prettier configured, no formatter step available. No-op, as flagged.

---

## Subfolder 2 — `app/` — DONE (uncommitted)

Net: **-245 lines of app code**, +34 in two new shared modules.

### Step 1 — dead code -> VERIFIED

- **Deleted `app/auth/verify/` (whole route, 198 LOC).** You confirmed
  mid-session that its hardcoded OTP (`INITIAL_CODE = ["4","8","2","9","1","0"]`)
  is superseded by the real OTP logic in `/auth/confirm`. Independently
  verified before deleting: **nothing anywhere links to `/auth/verify`**; the
  live flow is `/auth` -> `router.push("/auth/confirm")`; the only inbound
  reference to `/auth/confirm` from `verify/page.tsx` was the dead page linking
  onward. Its "Verify Now" button navigated without validating anything.
- **Deleted 2 dead CSS rules** from `confirm/page.tsx`: `.confirm-status-time`
  and `.confirm-expired`. Both defined in the page's `<style>` block with zero
  `className` uses anywhere in the repo.

**This is the one baseline change in the whole cleanse: the build now has 6
routes, not 7 — `/auth/verify` is intentionally gone.** Every other route is
unchanged. Recorded here so a future session doesn't read it as a regression.

Verify: build green, 6/6 routes. Lint 46 -> 45, the single reduction being the
deleted file's own `no-img-element` warning.

### Step 2 — duplication -> VERIFIED

**a. `components/AuthTopbar.jsx` (new).** The bare Minty topbar was inlined
**five** byte-identical times (proven with an indent-normalized diff of all
five): twice in `auth/page.tsx` (content + `AuthFallback`), twice in
`confirm/page.tsx` (content + `ConfirmFallback`), once in the now-deleted
`verify/page.tsx`. Both trivial `*Fallback` wrapper components collapsed into
`<Suspense fallback={<AuthTopbar />}>`. The comment explaining *why* the
Suspense boundary exists was preserved, moved onto `AuthPage`.

**b. `lib/flaskBase.js` (new).** `FLASK_BASE` was declared identically in
`auth/page.tsx` and `confirm/page.tsx` — the **code was byte-identical**; only
the explanatory comment prose differed between the two. Merged both comments'
information into one so no rationale was lost.

Proof of no behavior change:

1. **Rendered-HTML equivalence.** Built the pre-change tree (via `git stash`)
   and the post-change tree, then diffed the prerendered `<body>` markup of
   `/auth` and `/auth/confirm`, scripts stripped. **Both BYTE-IDENTICAL.**
   This is the strongest evidence available without tests, and it directly
   discharges the "preserve user-facing strings byte-for-byte" rule.
2. **Env-var inlining survives the module move.** This was the real risk:
   `process.env.NEXT_PUBLIC_*` is inlined by Next at build time, so moving the
   constant across a module boundary could have silently broken it. Tested all
   three branches of the fallback chain by building with different env:
   `NEXT_PUBLIC_MODULE1_API_URL` set -> value inlined into 3 client chunks;
   only legacy `NEXT_PUBLIC_API_URL` set -> inlined; neither set ->
   `localhost:5001` inlined. Also confirmed **no literal
   `process.env.NEXT_PUBLIC_MODULE1_API_URL` survives in the bundle**, i.e. it
   is genuinely inlined rather than deferred to a runtime lookup.

Verify: build green, 6/6 routes. Lint **46 -> 42, no new problems**. One new
`(file, rule)` pair appears — `components/AuthTopbar.jsx no-img-element` — and
it is purely a **relocation**: 5 `<img>` warnings across three files became 1
in the shared component (`no-img-element` total 12 -> 8). No new *kind* of
problem anywhere.
Cross-subfolder undefined-name check (`no-undef` over `app components lib`):
**3 -> 2** (the deleted page held one). `tsc --noEmit`: no source-level errors.
All modified/created files parse cleanly.

### Step 3 — formatter -> N/A (no Prettier)

### Deliberately left alone in `app/`

- **`app/globals.css` (1,527 LOC)** — untouched. Over the ~1000-line threshold,
  and CSS dead-rule analysis needs whole-app class usage proof I haven't done.
- **`.otp-row-empty`** — applied in `confirm/page.tsx` JSX but has **no rule
  defined** anywhere. Left in place: removing a class that renders is a visual
  judgement call, not dead code. Worth a look — it may be a styling hook or a
  leftover from the deleted verify page.
- **The `.otp-cell` / `.auth-notice` CSS that was duplicated between `confirm`
  and the deleted `verify` page** — the duplication resolved itself when
  `verify` was deleted. Note `.otp-cell` differed between them (`height: 48px`
  vs `56px`), so they were **not** safe to merge; deletion was the right call.
- **`app/layout.tsx`, `app/page.tsx`** — 34 and 5 LOC, nothing to cleanse.
- **The 4 `react-hooks/set-state-in-effect` errors in `auth/page.tsx`** —
  pre-existing, and the effects they flag implement deliberate
  recovered-value syncing with an explanatory comment. Out of scope.

### Cross-cutting finding for the `components/` pass

`OnboardingApp.jsx:1595` renders a **sixth** variant of the topbar block: same
brand markup, but with a real `<h1>Getting Started</h1>` and an avatar button
in `.right`. It was deliberately **not** merged into `AuthTopbar` — that would
mean pushing title/children/right-slot props through, and it belongs to the
`components/` pass, not this one. Flagging so it isn't missed.

---

## Subfolder 3 — `components/` — DONE (uncommitted)

Net: **-92 lines** across `OnboardingSteps.jsx` and `OnboardingApp.jsx`.
No opinionated reformatter was run on either 1.7k-line file, per the rule about
burying logic diffs.

### Step 1 — dead code -> VERIFIED

- **All 13 `no-unused-vars` warnings cleared** (13 -> 0). These were unused
  destructured props (`skip` on 7 Step components, `set` on 2, `restart` on 1),
  plus dead `const [open, setOpen] = useState(true)` local state in
  `MethodList`, plus an unused `catch (_)` binding.
  Safe because every Step component is rendered as `<StepX {...stepProps} />`
  from a single spread object — dropping a name from the destructuring pattern
  changes nothing at the call site. `StepInvite` already omitted `skip`, so this
  is the file's own established pattern. Verified `"method-card open"` was a CSS
  class string, not a use of the `open` variable.
- **Removed `skip` from `OnboardingApp`** entirely (definition + `stepProps`).
  Its own comment read *"Dev-only skip: advances without validation (will be
  removed at the end)"*, and after the prop cleanup it had zero consumers.

Verify: build green, 6/6 routes, lint 46 -> 29, no new problems.

### Step 2 — duplication -> VERIFIED

**a. Merged `BillAccountCodesCard` into `AccountCodesCard`** (-65 lines).
A 62-line and a 65-line component with the same signature. The diff showed
**three real behavioral differences**, so per your rule they were preserved as
parameters rather than picking a winner:

| | Account | Bill | prop |
|---|---|---|---|
| search matches against | full `"CODE · Name"` label | raw code only | `searchLabels` |
| checkbox aria-label | full label | bare code | `labelAria` |
| header block | none | title + subtitle | `header` |
| body style | `{padding: 20}` | `{display: 'block'}` | `bodyStyle` |

The search difference is **genuinely observable**: both call sites pass a real
`labels` map built as `` `${code} · ${name}` ``, so `labelOf(c) !== c` in
practice. Typing a name matches in Account but not in Bill. Not cosmetic.
One difference that *was* safe to normalize: Bill wrote
`!isOn(code)` inline where Account used `const cur = isOn(code); !cur`.
`isOn` is pure and called once either way — identical semantics.

**b. Extracted `StepNav`** (-4 duplicated footers). The Back / Save & Exit /
Save & Next footer appeared 4x identically except for an `isLastContentStep`
ternary. Unified on the ternary form: the two steps that don't pass the prop get
`undefined`, which falls through to `"Save & Next"` — exactly what they rendered
before. `StepSelectModule`'s footer was deliberately **left alone**: different
disabled logic (`sel.length === 0 || saving`), different handler, and an extra
sibling hint node, so sharing would parameterize more than it saves.

Proof for both merges — **SSR render-diff harnesses** (`react-dom/server`),
rendering the verbatim pre-merge implementations against the new shared ones and
comparing output strings:

- Card: 6 states x 2 variants (all-selected, none, partial, all-explicit-true,
  empty codes, no-labels-prop). **All 12 render-identical.**
- StepNav: 8 combinations (`saving` x `isLastContentStep` ∈ {true,false,
  undefined}), covering the undefined fall-through that makes the unification
  safe. **All 8 render-identical.**

This directly discharges the byte-for-byte rule for the shared strings
("Saving…", "Complete", "Save & Next", "Select all"/"Deselect all",
"Connect to Xero to load account codes", "No matching account code",
"Bill Account Code", and the Bill subtitle).

Verify after each merge: build green, 6/6 routes, brace/paren balance 0,
`tsc` parse check clean on the scripted-edit file, lint 46 -> 29 with no new
problems, `no-undef` 3 -> 2.

### Step 3 — formatter -> N/A (no Prettier)

### Deliberately left alone in `components/`

- **`restart` in `OnboardingApp`** — now has zero consumers after `StepAllSet`
  stopped destructuring it, but it is **not** dev scaffolding like `skip` was:
  it is working feature logic (`setState(initialState()); setCurrent(1);
  setMaxReached(1)`) for a "start over" affordance that is simply not wired to
  any button. **This looks like an unfinished feature, not dead code, so I
  stopped rather than deleting it.** It is still passed through `stepProps`.
  Your call: delete it, or wire up a restart button on the All Set step?
- **`StepSelectModule`'s footer** — see above, genuinely different.
- **The 11 `react-hooks/set-state-in-effect` errors, 2 `react-hooks/refs`,
  2 `react-hooks/purity`, 3 `no-unused-expressions`** — all pre-existing
  baseline lint, explicitly out of scope.
- **The 8 remaining `no-img-element` warnings** — converting `<img>` to
  `next/image` is a behavior change (layout, loading), not a cleanse.
- **The two 1.7k-line files were not reformatted**, only edited in place.

---

## Original survey findings for `lib/` (now actioned)

### 1. `lib/entityOptions.js` — dead file, but ASKING FIRST

7 LOC, exports `COUNTRY_OPTIONS` (~250 countries) and `CURRENCY_OPTIONS`
(~180 currencies). **Zero references anywhere** in the repo (verified across all
tracked file types, not just JS).

I am **not** deleting it unsupervised, because it doesn't look like leftover
scaffolding — it looks like a deliberate offline fallback that was never wired
up. Its header says the lists are "generated from the same sources as Module 1
create-entity (pycountry / iso4217)". Meanwhile `lib/refData.js` fetches the
same two concepts over HTTP from `NEXT_PUBLIC_MODULE1_API_URL`, and on fetch
failure **returns `[]`** — i.e. the country/currency dropdowns silently go empty
if the Module 1 backend is down.

So this is plausibly either (a) genuinely abandoned, or (b) an intended
fallback whose wiring was lost. That's a product call, not a cleanse call.
**Question for you below.**

### 2. `lib/amount.js` — 4 genuinely-unused exports

Usage census (`in=` uses inside `amount.js` including the declaration line,
`out=` uses elsewhere in the app):

| export | in | out | verdict |
|---|---|---|---|
| `toAmountString` | 3 | 2 | used |
| `formatAmount` | 3 | 2 | used |
| `acceptAmountInput` | 1 | 2 | used externally only |
| `toAmountEditString` | 1 | 2 | used externally only |
| `cleanAmountString` | 6 | 0 | internal helper, keep (exported API surface) |
| `MAX_AMOUNT_INT_DIGITS` | 4 | 0 | internal, keep |
| `MAX_AMOUNT_DECIMALS` | 4 | 0 | internal, keep |
| `amountIntegerDigits` | 1 | 0 | **DEAD** — declaration only |
| `isWithinAmountLimits` | 1 | 0 | **DEAD** — declaration only |
| `formatMoney` | 1 | 0 | **DEAD** — declaration only |
| `parseAmount` | 1 | 0 | **DEAD** — declaration only |

Caveat worth your judgement: `amount.js` reads as a deliberate "single source of
truth" utility module with a full documented API. `parseAmount`'s docstring says
"Every amount that crosses into arithmetic or into an API payload should go
through this" — that it's unused may be a **bug (the rule isn't being followed)
rather than dead code**. Per your rules I stopped rather than deleting.
**Question for you below.**

### 3. `lib/refData.js` — real, safe duplication

`fetchCountries` and `fetchCurrencies` are structurally identical: module-level
promise cache, fetch, `res.ok ? res.json() : null`, array-guard on a named key,
`.catch` that nulls the cache and returns `[]`. They differ only in:

- endpoint path: `/api/onboarding/countries` vs `/currencies`
- response key: `data?.countries` vs `data?.currencies`
- which module-level cache variable they memoize into

This is the one clean extract-a-parent candidate in `lib/`: a
`cachedListFetch(path, key)` factory, with the two exports as thin wrappers.
No user-facing strings, no log lines, no behavioral difference to preserve —
the only subtlety is keeping each cache **independent** (a shared cache would
be a behavior change).

`lib/pendingInvite.js` — reviewed, no duplication, all 3 exports used by
`app/auth/page.tsx`. **Leaving alone.**

---

## Deliberately left alone (and why)

- **The 46 pre-existing lint problems** — you said pre-existing failures are
  separate work. Untouched.
- **`.next/`** — gitignored build output. Note `npx tsc --noEmit` on its own
  reports phantom errors from stale `.next` types about a deleted
  `app/toast-preview` route; `rm -rf .next` first or trust `next build`.
- **Introducing Prettier** — would be a large unrelated diff. Not adding a
  formatter without you asking, which makes the "formatter" third step of each
  subfolder a no-op.
- **6 npm audit vulnerabilities** (1 low, 5 high) — pre-existing, out of scope.

## Lessons / gotchas for a resumed session

- `npm ci` was needed — `node_modules` was absent.
- Don't trust a `git grep -o ... | wc -l` census loop; it under-reported to zero
  here. Verify with `grep -rn` before concluding something is unused.
- Multi-line `import { a, b } from "..."` statements defeat single-line import
  regexes — `lib/pendingInvite.js` looked unused until checked per-symbol.
