/**
 * Single source of truth for how amounts are shown and typed.
 *
 * Display: thousands grouped in 3s with commas, always exactly 2 decimals
 * (e.g. 12000 -> "12,000.00").
 *
 * Entry: while a field is focused the user sees plain digits; grouping is
 * applied on blur. Typing is capped at MAX_AMOUNT_INT_DIGITS digits before the
 * decimal point and 2 after it.
 *
 * Grouping and rounding are done with string operations rather than
 * parseFloat/toLocaleString, so a 12-digit amount keeps every digit instead of
 * drifting on the way through a float.
 */

/** Max digits allowed before the decimal point. Decimals are capped at 2. */
export const MAX_AMOUNT_INT_DIGITS = 11;

/** Max digits allowed after the decimal point. */
export const MAX_AMOUNT_DECIMALS = 2;

/** Strip grouping commas so only digits and at most one dot remain. */
export function cleanAmountString(raw) {
  return String(raw).trim().replace(/,/g, '');
}

/** Number of digits before the decimal point in a comma-free amount string. */
export function amountIntegerDigits(cleaned) {
  return (cleaned.split('.')[0] ?? '').length;
}

/** Insert a comma every 3 digits, right to left. "12345" -> "12,345". */
function groupThousands(intPart) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Normalize a typed amount to an exact decimal string with 2 decimal places,
 * e.g. "12,312,312.5" -> "12312312.50". Pure string work — never parseFloat —
 * so large values keep every digit. Extra decimals past the second are
 * truncated, not rounded ("9.999" -> "9.99"). Returns undefined when blank or
 * not a number.
 */
export function toAmountString(raw) {
  const cleaned = cleanAmountString(raw);
  if (!cleaned || cleaned === '.') return undefined;

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  if (!/^\d*\.?\d*$/.test(unsigned) || !/\d/.test(unsigned)) return undefined;

  const [intRaw = '', decRaw = ''] = unsigned.split('.');
  let intPart = intRaw.replace(/^0+(?=\d)/, '');
  if (intPart === '') intPart = '0';

  const dec = (decRaw + '00').slice(0, MAX_AMOUNT_DECIMALS);

  const sign = negative && /[1-9]/.test(intPart + dec) ? '-' : '';
  return `${sign}${intPart}.${dec}`;
}

/**
 * Format any amount for display: grouped to 3 digits, always 2 decimals.
 * Accepts a raw user string, an API decimal string, or a number.
 * Returns "" when there is no usable number.
 */
export function formatAmount(value) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'number' ? numberToPlainString(value) : value;
  const normalized = toAmountString(raw);
  if (normalized === undefined) return '';
  const [intPart, dec] = normalized.split('.');
  const negative = intPart.startsWith('-');
  const digits = negative ? intPart.slice(1) : intPart;
  return `${negative ? '-' : ''}${groupThousands(digits)}.${dec}`;
}

/** True when a typed amount is within the digit limits. */
export function isWithinAmountLimits(raw) {
  const cleaned = cleanAmountString(raw);
  const [intPart = '', dec = ''] = cleaned.replace(/^-/, '').split('.');
  return intPart.length <= MAX_AMOUNT_INT_DIGITS && dec.length <= MAX_AMOUNT_DECIMALS;
}

/**
 * Format an amount with its currency symbol, e.g. "HK$ 12,000.00".
 * Pass the symbol from currencyLabelForCode().
 */
export function formatMoney(value, currencyLabel) {
  const amount = formatAmount(value);
  if (!amount) return '';
  const symbol = String(currencyLabel ?? '').trim();
  return symbol ? `${symbol} ${amount}` : amount;
}

/**
 * Turn a number into a plain decimal string without exponent notation or
 * locale grouping, so it can go through the string formatters above. Used as
 * the bridge from computed numbers (totals, remainders) into display.
 *
 * Emits more decimals than we keep and lets toAmountString() do the truncating,
 * so numbers and strings truncate through the same code path. The intermediate
 * precision matters: a float sum like 0.1 + 0.2 is really 0.30000000000000004
 * and 3.00 - 1.00 can land on 1.9999999999999998, so truncating the raw float
 * would show 1.99. Rendering at 8dp first collapses that noise back to
 * 2.00000000, which then truncates cleanly.
 */
function numberToPlainString(n) {
  if (!Number.isFinite(n)) return '';
  return n.toFixed(8);
}

/**
 * Parse a displayed or typed amount back to a number, e.g. "12,000.00" -> 12000.
 * Returns null when the value is blank or not a number. Every amount that
 * crosses into arithmetic or into an API payload should go through this.
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = cleanAmountString(raw);
  if (!cleaned || cleaned === '.') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Gate a keystroke in an amount field. Returns the value to store, or null to
 * reject the edit and leave the field untouched.
 *
 * While typing, the value is kept as plain digits (no grouping); call
 * formatAmount() on blur to add the commas. Input past the digit limits is
 * silently refused rather than truncated, so the caret never jumps.
 */
export function acceptAmountInput(next) {
  const cleaned = cleanAmountString(next);
  if (cleaned === '') return '';
  if (!/^\d*\.?\d*$/.test(cleaned)) return null;
  const [intPart = '', dec = ''] = cleaned.split('.');
  if (intPart.length > MAX_AMOUNT_INT_DIGITS) return null;
  if (dec.length > MAX_AMOUNT_DECIMALS) return null;
  return cleaned;
}

/** Strip grouping so a formatted amount can be edited as plain digits on focus. */
export function toAmountEditString(raw) {
  if (raw === null || raw === undefined) return '';
  return cleanAmountString(raw);
}
