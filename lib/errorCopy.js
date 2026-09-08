// Shared error copy for anything the user reads.
//
// This app has one wrapper (lib/billing.js) and ~26 hand-rolled fetch calls, so
// there is no single place a failure becomes a sentence. These two helpers are
// that place. They mirror the guards in the Minty and billing-frontend repos --
// see Minty/ERROR_MESSAGE_LEAKS.md for the copy standard.

// Shown when we have nothing specific to say. Cause-neutral on purpose: it
// fires for unknown reasons, so it must not assert one.
export const HOUSE_FALLBACK = "Something went wrong on my end. Mind trying again?";

// Shapes that mean the text is machinery, not a sentence: a serialised body,
// markup, a stack, or a bare machine code like `invalid_state`.
const RAW_ERROR_PATTERNS = [
  /failed to fetch/i,
  /networkerror/i,
  /load failed/i,
  /unexpected token/i,
  /unexpected end of/i,
  /is not a function/i,
  /is not defined/i,
  /cannot read/i,
  /^\w*error:/i,
  /\bhttp\b\s*\d{3}/i,
  /traceback/i,
  /\[object /i,
];

/**
 * Make one string fit to show, or fall back.
 *
 * Accepts whatever the server sent: a string, a list of messages, or an object
 * (which used to render as "[object Object]" via .toString()).
 */
export function errorCopy(message, fallback) {
  const safe = fallback || HOUSE_FALLBACK;
  if (message == null) return safe;
  if (Array.isArray(message)) {
    message = message
      .filter((x) => typeof x === "string" && x.trim())
      .join("; ");
  }
  if (typeof message !== "string") return safe;
  const text = message.trim();
  if (!text || text.length > 200) return safe;
  if (/^[a-z0-9_.:-]+$/.test(text)) return safe; // a bare code, not a sentence
  if (RAW_ERROR_PATTERNS.some((re) => re.test(text))) return safe;
  return text;
}

/**
 * Copy for a failed response, preferring the server's own words when they read
 * as a sentence. Flask sends `{error}`; the auth endpoints send `{message}`.
 */
export function friendlyError(data, fallback) {
  const sent = data && (data.error ?? data.message);
  return errorCopy(sent, fallback);
}
