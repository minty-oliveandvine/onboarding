# Error copy

How a failure becomes something a user can read. The copy standard is shared
across Minty, billing-backend, billing-frontend and onboarding; the canonical
write-up lives in the Minty repo as `ERROR_MESSAGE_LEAKS.md`.

## The standard

> `I couldn't <do the specific thing>. <Short next step>?`

1. Under two sentences.
2. First person -- not `Error:`, not `Failed to`.
3. Name the specific thing. This app is good at that already -- keep it:
   `Oh, "Acme Ltd" is taken already! Do you have another name in mind?`
4. Warm close, no blame. Drop the apology when retrying won't help and state the
   requirement instead: `I'll need a starting balance here.`
5. No codes, stack text or HTTP statuses in the visible string.
6. Sentence case, no `Error:` prefix, no exclamation marks on failures.

House fallback: `Something went wrong on my end. Mind trying again?`

## The mechanism

This app talks to **two** backends: the Minty Flask app (`NEXT_PUBLIC_MODULE1_API_URL`)
for auth, legal and the Xero hand-off, and the extracted onboarding service
(`NEXT_PUBLIC_ONBOARDING_API_URL`) for `/api/onboarding/*`. Which one answers a given path
is decided in `lib/apiRoutes.js`. Both speak the same `{error}` shape, so the copy rules
below are unchanged -- and the onboarding service deliberately uses `error` rather than
Django's conventional `detail` for exactly that reason.

There is one wrapper (`lib/billing.js`) and ~26 hand-rolled `fetch` calls, so
`lib/errorCopy.js` is the shared seam instead:

```js
import { friendlyError } from '../lib/errorCopy';

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  return { ok: false, error: friendlyError(data, "I couldn't save that. Mind trying again?") };
}
```

- **`friendlyError(data, fallback)`** reads Flask's `{error}` or the auth
  endpoints' `{message}`, and hands it to `errorCopy`.
- **`errorCopy(message, fallback)`** returns the server's words only when they
  read as a sentence. It refuses network/parser text (`Failed to fetch`,
  `Unexpected token '<'`), bare machine codes (`invalid_state`), anything
  object-shaped (which used to render as `[object Object]` via `.toString()`),
  and anything over 200 characters.

Always pass the specific fallback **into** `friendlyError` rather than writing
`friendlyError(data, '') || "..."` -- the helper already falls back, so the
trailing `||` would be unreachable.

## Two habits worth keeping

- **Don't assert a cause you don't know.** The `catch` blocks used to say
  "My connection timed out" for every failure, including CORS rejections, DNS
  failures and malformed JSON. They are cause-neutral now.
- **Always give a fallback.** Two 429 handlers in `app/auth/confirm/page.tsx`
  did `if (data.message) setError(data.message)`, so a silent server response
  left the banner blank.

## Deliberate exception

`components/BuyNowSheet.jsx` shows Stripe.js `error.message` verbatim -- it is
the only account of what the card issuer said, and it is written for
cardholders. See the comment there.
