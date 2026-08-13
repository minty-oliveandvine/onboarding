/**
 * Date formatting for the onboarding flow — "12 JUN 2026".
 *
 * There is one reason this is not just `toLocaleDateString('en-GB', ...)`:
 *
 *     en-GB `month: 'short'` is NOT three letters. Eleven months abbreviate to three
 *     and September abbreviates to "Sept", so a flow that shows a trial ending in
 *     August and a renewal in September prints "12 AUG" beside "12 SEPT" and the
 *     column stops lining up. There is no Intl option that trims it: 'short' is
 *     whatever CLDR says it is, and 'narrow' collapses to a single ambiguous letter
 *     (both June and July are "J").
 *
 * So the parts are formatted by Intl — which keeps the day-first order and the locale's
 * own separators — and only the month token is cut to three. Switching locale to en-US
 * would also give "Sep", but it reorders the date to "Jun 12, 2026", which is not how
 * the rest of the flow reads.
 *
 * Uppercased so the month is unmistakably an abbreviation rather than a truncated word.
 */
const MONTH_LETTERS = 3;

export function formatDate(date, opts = {}) {
  return new Intl.DateTimeFormat('en-GB', opts)
    .formatToParts(date)
    .map((part) =>
      // Only the month is cut. A numeric day or year is already short, and slicing a
      // literal would eat the separators the locale put there.
      part.type === 'month' ? part.value.slice(0, MONTH_LETTERS) : part.value,
    )
    .join('')
    .toUpperCase();
}

/** Today, as the flow writes it: "12 JUN 2026". */
export function formatToday() {
  return formatDate(new Date(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
