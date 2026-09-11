// lib/date -- the month-abbreviation rule and the local-vs-UTC calendar day.
//
// `toIsoDate` was written out four separate times across three components before it
// was consolidated here (twice inside the same function, 71 lines apart), so the
// point of these tests is to pin the behaviour that consolidation settled on.

import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatToday, toIsoDate } from '../date';

/** Run `fn` as if the machine were in `tz`. Node re-reads process.env.TZ on change. */
function withTz(tz: string, fn: () => void) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    // Deleting rather than assigning undefined: `process.env.TZ = undefined` stores
    // the STRING "undefined", which Node then fails to parse and falls back to UTC --
    // so a restore bug here would silently move every later test's timezone.
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('formatDate', () => {
  const JUNE = new Date(2026, 5, 12);
  const SEPT = new Date(2026, 8, 12);
  const opts = { day: '2-digit', month: 'short', year: 'numeric' } as const;

  it('writes the flow shape: 12 JUN 2026', () => {
    expect(formatDate(JUNE, opts)).toBe('12 JUN 2026');
  });

  it('cuts September to three letters', () => {
    // The whole reason this function exists. en-GB `month: short` gives "Sept", so
    // an unpatched Intl call prints "12 AUG" beside "12 SEPT" and the column stops
    // lining up. Assert against Intl directly so the test fails if CLDR ever changes
    // in a way that makes the workaround unnecessary -- that is worth knowing.
    const raw = new Intl.DateTimeFormat('en-GB', opts).format(SEPT);
    expect(raw).toContain('Sept');
    expect(formatDate(SEPT, opts)).toBe('12 SEP 2026');
  });

  it('gives every month exactly three letters', () => {
    for (let m = 0; m < 12; m += 1) {
      const out = formatDate(new Date(2026, m, 1), opts);
      const month = out.split(' ')[1];
      expect(month, `month index ${m}`).toHaveLength(3);
    }
  });

  it('keeps the locale separators rather than slicing them away', () => {
    // Only the month part is cut. Slicing a literal part would eat the spaces.
    expect(formatDate(JUNE, opts).split(' ')).toHaveLength(3);
  });

  it('uppercases by default and honours upper: false', () => {
    expect(formatDate(JUNE, opts)).toBe('12 JUN 2026');
    expect(formatDate(JUNE, { ...opts, upper: false })).toBe('12 Jun 2026');
  });

  it('does not pass `upper` through to Intl', () => {
    // `upper` is destructured out before the rest is handed to Intl. If it leaked
    // through, Intl would throw on the unknown option.
    expect(() => formatDate(JUNE, { ...opts, upper: false })).not.toThrow();
  });
});

describe('formatToday', () => {
  it('formats the current date in the flow shape', () => {
    const now = new Date();
    expect(formatToday()).toBe(
      formatDate(now, { day: '2-digit', month: 'short', year: 'numeric' }),
    );
  });

  it('matches DD MMM YYYY', () => {
    expect(formatToday()).toMatch(/^\d{2} [A-Z]{3} \d{4}$/);
  });
});

describe('toIsoDate', () => {
  it('pads single-digit months and days', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('accepts a parseable string as well as a Date', () => {
    expect(toIsoDate('2026-06-12T10:00:00')).toBe('2026-06-12');
  });

  it('returns an empty string for an unparseable value', () => {
    // The wizard renders the result straight into a date input, so the failure mode
    // has to be an empty field rather than the literal text "Invalid Date".
    expect(toIsoDate('not a date')).toBe('');
    expect(toIsoDate(new Date('nonsense'))).toBe('');
  });

  it('handles a leap day', () => {
    expect(toIsoDate(new Date(2028, 1, 29))).toBe('2028-02-29');
  });

  describe('reads the calendar day LOCALLY, not in UTC', () => {
    // This is the bug the function exists to avoid, and it is invisible on a machine
    // running in UTC -- so both directions are forced here rather than trusting
    // whatever timezone the test happened to run in.
    afterEach(() => {
      expect(process.env.TZ === undefined || typeof process.env.TZ === 'string').toBe(true);
    });

    it('east of Greenwich: an early-morning date does not roll BACK a day', () => {
      withTz('Asia/Hong_Kong', () => {
        const d = new Date(2026, 5, 12, 0, 30); // 12 June, 00:30 local (= 11 June UTC)
        expect(d.toISOString().slice(0, 10)).toBe('2026-06-11'); // the wrong answer
        expect(toIsoDate(d)).toBe('2026-06-12'); // the right one
      });
    });

    it('west of Greenwich: a late-evening date does not roll FORWARD a day', () => {
      withTz('America/New_York', () => {
        const d = new Date(2026, 5, 12, 23, 30); // 12 June, 23:30 local (= 13 June UTC)
        expect(d.toISOString().slice(0, 10)).toBe('2026-06-13'); // the wrong answer
        expect(toIsoDate(d)).toBe('2026-06-12'); // the right one
      });
    });

    it('survives a DST spring-forward boundary', () => {
      withTz('America/New_York', () => {
        // 2026-03-08 is the US spring-forward date; 02:00 does not exist locally and
        // the Date constructor normalises it to 03:00. The calendar day is unchanged,
        // which is what the wizard cares about.
        expect(toIsoDate(new Date(2026, 2, 8, 2, 0))).toBe('2026-03-08');
        expect(toIsoDate(new Date(2026, 10, 1, 1, 30))).toBe('2026-11-01');
      });
    });
  });
});
