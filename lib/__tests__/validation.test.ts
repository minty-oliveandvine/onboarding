// lib/validation -- the shallow shape checks the completion gate and the UI hints
// both read. They existed as separate copies before this module and could disagree
// about whether a form was valid, so what matters most here is that ONE rule answers
// both callers; the cases below pin what that rule accepts.

import { describe, expect, it } from 'vitest';
import { EMAIL_RE, UUID_RE, isEmail, isUuid } from '../validation';

describe('isEmail', () => {
  it.each([
    'a@b.co',
    'first.last@example.com',
    'a+b@sub.domain.museum',
    "o'brien@example.ie",
    'user_name@example.co.uk',
    'UPPER@EXAMPLE.COM',
  ])('accepts %s', (value) => {
    expect(isEmail(value)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['plainaddress', 'no @'],
    ['@example.com', 'nothing before the @'],
    ['user@', 'nothing after the @'],
    ['user@example', 'no dot in the domain'],
    ['user @example.com', 'a space'],
    ['a@b@c.com', 'two @'],
  ])('rejects %s (%s)', (value) => {
    expect(isEmail(value)).toBe(false);
  });

  it('trims before testing', () => {
    expect(isEmail('  a@b.co  ')).toBe(true);
  });

  it('treats null and undefined as empty rather than throwing', () => {
    // Called straight off an uncontrolled input's value in a few places, which can
    // be undefined on the first render.
    expect(isEmail(null)).toBe(false);
    expect(isEmail(undefined)).toBe(false);
  });

  it('is deliberately shallow -- it does not reject an unroutable domain', () => {
    // Documented behaviour, not an oversight: these addresses never authenticate
    // anybody, and a stricter parser rejects legitimate ones for no gain.
    expect(isEmail('a@b.c')).toBe(true);
  });

  it('is not sticky', () => {
    // A /g regex reused across calls carries lastIndex between them and returns
    // alternating answers for the same input. EMAIL_RE has no /g, and this is the
    // test that would notice if someone added one.
    expect(EMAIL_RE.global).toBe(false);
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b.co')).toBe(true);
  });
});

describe('isUuid', () => {
  it('accepts a canonical uuid in either case', () => {
    expect(isUuid('2749a5a2-5a9f-482a-97df-af2b6a5ac0e6')).toBe(true);
    expect(isUuid('2749A5A2-5A9F-482A-97DF-AF2B6A5AC0E6')).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['2749a5a2-5a9f-482a-97df', 'too short'],
    ['2749a5a25a9f482a97dfaf2b6a5ac0e6', 'no hyphens'],
    ['2749a5a2-5a9f-482a-97df-af2b6a5ac0e6x', 'trailing character'],
    ['g749a5a2-5a9f-482a-97df-af2b6a5ac0e6', 'non-hex digit'],
    ['Office Supplies', 'a display value'],
  ])('rejects %s (%s)', (value) => {
    expect(isUuid(value)).toBe(false);
  });

  it('does NOT trim', () => {
    // Unlike isEmail. A uuid comes from the database or from a select's value, never
    // from something a user typed, so padding means the caller has a bug worth seeing.
    expect(isUuid(' 2749a5a2-5a9f-482a-97df-af2b6a5ac0e6 ')).toBe(false);
  });

  it('is anchored at both ends and not sticky', () => {
    expect(UUID_RE.source.startsWith('^')).toBe(true);
    expect(UUID_RE.source.endsWith('$')).toBe(true);
    expect(UUID_RE.global).toBe(false);
  });

  it('treats null and undefined as not a uuid', () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
