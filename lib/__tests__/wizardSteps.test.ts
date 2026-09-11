// lib/wizardSteps -- the step table, which steps the chosen modules make active, and
// how far the saved data justifies resuming.
//
// `deriveResumeStep` is the reason this file is the most important in the suite: it
// decides where a cold resume LANDS. The frontend's ordering (1 Basic, 2 Module,
// 3 Invite, 4 Accounting) is not the backend's (modules -> Xero -> petty-cash ->
// bills/invite), and trusting the backend's index directly once sent users straight
// to "Connect to Accounting" past an incomplete step. Until now none of that had a
// single test.

import { describe, expect, it } from 'vitest';
import {
  STEPS,
  deriveResumeStep,
  getActiveStepIds,
  getDisplaySteps,
  initialState,
  isStepComplete,
} from '../wizardSteps';

// Both helpers are deliberately typed loosely. `lib/wizardSteps.js` is still
// untyped, so tsc infers `initialState()` as a closed object literal with
// `modules: never[]` and no `entity.id` -- shapes the wizard genuinely does produce
// at runtime but the inference cannot see. Part 2 replaces `Payload`/`State` here
// with the real `WizardState`, and these casts go away with it.
// `unknown` would block the nested reads these helpers exist to make
// (`over.entity`, `s.pettyCash.openingBalance`), so this is deliberately the
// loosest type in the suite -- and scoped to this one file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

/** A /state payload with the fields deriveResumeStep reads. */
function payload(over: Loose = {}): Loose {
  return {
    entity: { name: 'Acme Ltd', phone: '', email: '' },
    modules: [],
    invites: [],
    xero: { connected: false, org: '' },
    ...over,
  };
}

/** A wizard state that passes step 1, for the completion-gate cases. */
function state(over: Loose = {}): Loose {
  const base = initialState() as Loose;
  return {
    ...base,
    ...over,
    entity: { ...base.entity, name: 'Acme Ltd', ...(over.entity || {}) },
  };
}

describe('deriveResumeStep -- with a persisted savedStep', () => {
  it.each([1, 2, 3, 4])('honours a saved step of %i without needing Xero', (saved) => {
    expect(deriveResumeStep(payload(), saved)).toEqual({ step: saved, needsXero: false });
  });

  it.each([5, 6, 7, 8, 9])(
    'lands on saved step %i but flags needsXero when Xero is not connected',
    (saved) => {
      // The user KEEPS their place and is told why they must reconnect. An earlier
      // version silently forced them back to step 4, which lost their position with
      // no explanation.
      expect(deriveResumeStep(payload(), saved)).toEqual({ step: saved, needsXero: true });
    },
  );

  it.each([5, 6, 7, 8, 9])('does not flag needsXero for step %i when Xero IS connected', (saved) => {
    const s = payload({ xero: { connected: true, org: 'Acme' } });
    expect(deriveResumeStep(s, saved)).toEqual({ step: saved, needsXero: false });
  });

  it('accepts a numeric string, because the column round-trips through JSON', () => {
    expect(deriveResumeStep(payload(), '3')).toEqual({ step: 3, needsXero: false });
  });

  it('treats a missing xero key as not connected', () => {
    const { xero, ...withoutXero } = payload();
    expect(xero).toBeDefined(); // the key really was there to begin with
    expect(deriveResumeStep(withoutXero, 6)).toEqual({ step: 6, needsXero: true });
  });

  it.each([
    { saved: 0, why: 'below the range' },
    { saved: 10, why: 'above the range' },
    { saved: -1, why: 'negative' },
    { saved: null, why: 'never persisted' },
    { saved: undefined, why: 'absent' },
    { saved: '', why: 'empty string' },
    { saved: 'abc', why: 'not a number' },
    { saved: Number.NaN, why: 'NaN' },
    { saved: Number.POSITIVE_INFINITY, why: 'not finite' },
  ])('falls back to deriving when savedStep is $why', ({ saved }) => {
    // A session that predates the column, or one that never reached a Save.
    const s = payload({ entity: { name: 'Acme Ltd', phone: '', email: '' } });
    expect(deriveResumeStep(s, saved)).toEqual({ step: 1, needsXero: false });
  });
});

describe('deriveResumeStep -- deriving with no persisted step', () => {
  const NONE = null;

  it('lands on 1 when nothing is saved', () => {
    expect(deriveResumeStep(payload({ entity: { name: '', phone: '', email: '' } }), NONE)).toEqual({
      step: 1,
      needsXero: false,
    });
  });

  it('lands on 1 when only basic info is saved', () => {
    expect(deriveResumeStep(payload(), NONE)).toEqual({ step: 1, needsXero: false });
  });

  it('lands on 2 when modules are chosen but nothing further', () => {
    const s = payload({ modules: ['pettyCash'] });
    expect(deriveResumeStep(s, NONE)).toEqual({ step: 2, needsXero: false });
  });

  it('lands on 3 when invites were actually added', () => {
    const s = payload({ modules: ['pettyCash'], invites: [{ email: 'a@b.co' }] });
    expect(deriveResumeStep(s, NONE)).toEqual({ step: 3, needsXero: false });
  });

  it('does NOT count an empty invite list as a saved step 3', () => {
    // isStepComplete always passes step 3 because inviting is optional. If the
    // derive used that, saving at Module Selection would skip the user onto Invite.
    const s = payload({ modules: ['pettyCash'], invites: [] });
    expect(deriveResumeStep(s, NONE).step).toBe(2);
  });

  it('skips past an empty invite to a connected Xero', () => {
    // The `continue` for id === 3. An optional step left empty must not end the
    // scan, or a user who connected Xero but invited nobody would resume on 2.
    const s = payload({
      modules: ['pettyCash'],
      invites: [],
      xero: { connected: true, org: 'Acme' },
    });
    expect(deriveResumeStep(s, NONE)).toEqual({ step: 4, needsXero: false });
  });

  it('stops at a required step that is not saved', () => {
    // Xero connected but no modules chosen: step 2 is required, so the scan breaks
    // there and the later connection does not pull the user forward.
    const s = payload({ modules: [], xero: { connected: true, org: 'Acme' } });
    expect(deriveResumeStep(s, NONE)).toEqual({ step: 1, needsXero: false });
  });

  it('never derives past 4, so it can never land past the Xero gate', () => {
    const s = payload({
      modules: ['pettyCash', 'bills'],
      invites: [{ email: 'a@b.co' }],
      xero: { connected: true, org: 'Acme' },
    });
    const { step, needsXero } = deriveResumeStep(s, NONE);
    expect(step).toBeLessThanOrEqual(4);
    // Nothing derived can be past the gate, so the flag is never raised here.
    expect(needsXero).toBe(false);
  });

  it('treats a non-array invites value as no invites', () => {
    const s = payload({ modules: ['pettyCash'], invites: null });
    expect(deriveResumeStep(s, NONE).step).toBe(2);
  });
});

describe('STEPS', () => {
  it('is 1..9 in order with no gaps', () => {
    expect(STEPS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('gives every step a label', () => {
    for (const s of STEPS) expect(s.label.trim()).not.toBe('');
  });
});

describe('getDisplaySteps', () => {
  it('shows only the four common steps and All Set when no module is chosen', () => {
    expect(getDisplaySteps([]).map((d) => d.tiny)).toEqual([
      'Basic',
      'Module',
      'Invite',
      'Accounting',
      'All Set',
    ]);
  });

  it('collapses Sales, Account Code and Others into one Petty Cash segment', () => {
    const petty = getDisplaySteps(['pettyCash']).find((d) => d.tiny === 'Petty Cash');
    expect(petty).toBeDefined();
    expect(petty?.ids).toEqual([5, 6, 7]);
    expect(petty?.label).toBe('Petty Cash Settings');
  });

  it('adds the Payment segment only for bills', () => {
    expect(getDisplaySteps(['bills']).map((d) => d.tiny)).toEqual([
      'Basic',
      'Module',
      'Invite',
      'Accounting',
      'Payment',
      'All Set',
    ]);
  });

  it('orders Petty Cash before Payment when both are chosen', () => {
    const tiny = getDisplaySteps(['bills', 'pettyCash']).map((d) => d.tiny);
    expect(tiny).toEqual(['Basic', 'Module', 'Invite', 'Accounting', 'Petty Cash', 'Payment', 'All Set']);
  });

  it('ignores the order the modules were selected in', () => {
    expect(getDisplaySteps(['pettyCash', 'bills'])).toEqual(getDisplaySteps(['bills', 'pettyCash']));
  });

  it('always ends on All Set', () => {
    for (const mods of [[], ['pettyCash'], ['bills'], ['pettyCash', 'bills']]) {
      const out = getDisplaySteps(mods);
      expect(out[out.length - 1].ids).toEqual([9]);
    }
  });

  it('covers every id exactly once, with no id repeated across segments', () => {
    const ids = getDisplaySteps(['pettyCash', 'bills']).flatMap((d) => d.ids);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getActiveStepIds', () => {
  it.each([
    [[], [1, 2, 3, 4, 9]],
    [['pettyCash'], [1, 2, 3, 4, 5, 6, 7, 9]],
    [['bills'], [1, 2, 3, 4, 8, 9]],
    [['pettyCash', 'bills'], [1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ])('for modules %j gives %j', (modules, expected) => {
    expect(getActiveStepIds(modules)).toEqual(expected);
  });

  it('agrees with getDisplaySteps for the same modules', () => {
    // The two are separate functions over the same rule, so they can drift apart.
    for (const mods of [[], ['pettyCash'], ['bills'], ['pettyCash', 'bills']]) {
      expect(getActiveStepIds(mods)).toEqual(getDisplaySteps(mods).flatMap((d) => d.ids));
    }
  });

  it('returns ascending ids', () => {
    const ids = getActiveStepIds(['pettyCash', 'bills']);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});

describe('initialState', () => {
  it('returns a fresh object each call, not a shared one', () => {
    // It is spread into React state, and a shared nested object would leak one
    // wizard's edits into the next.
    // `as Loose` only because initialState's empty arrays infer as never[]; the
    // push is a real mutation of the first object.
    const a = initialState() as Loose;
    const b = initialState() as Loose;
    expect(a).not.toBe(b);
    expect(a.pettyCash).not.toBe(b.pettyCash);
    a.modules.push('pettyCash');
    expect(b.modules).toEqual([]);
  });

  it('starts with no modules, no invites and no Xero', () => {
    const s = initialState();
    expect(s.modules).toEqual([]);
    expect(s.invites).toEqual([]);
    expect(s.xero.connected).toBe(false);
  });

  it("defaults the petty-cash opening date to today's LOCAL calendar day", () => {
    const d = new Date();
    const expected = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
    expect(initialState().pettyCash.openingDate).toBe(expected);
  });

  it('does NOT define entity.id or pettyCash.openingBalance', () => {
    // Both are read across OnboardingApp but are absent here -- they are filled in
    // later by the create call and by the Sales step. Pinned because the TypeScript
    // conversion has to type them as optional, and a future edit that "helpfully"
    // adds them to the initial state would change step 5's completion gate.
    // Read through an index rather than a dotted access: the fields are missing
    // from the INFERRED type too, which is the same fact the assertion makes at
    // runtime -- a dotted read would be a compile error rather than a test.
    const s = initialState() as Loose;
    expect(s.entity.id).toBeUndefined();
    expect(s.pettyCash.openingBalance).toBeUndefined();
    expect(Object.keys(s.entity)).not.toContain('id');
    expect(Object.keys(s.pettyCash)).not.toContain('openingBalance');
  });
});

describe('isStepComplete', () => {
  describe('step 1 -- basic information', () => {
    it('needs a name longer than one character', () => {
      expect(isStepComplete(1, state({ entity: { name: '' } }))).toBe(false);
      expect(isStepComplete(1, state({ entity: { name: 'A' } }))).toBe(false);
      expect(isStepComplete(1, state({ entity: { name: 'AB' } }))).toBe(true);
    });

    it('does not accept whitespace as a name', () => {
      expect(isStepComplete(1, state({ entity: { name: '   ' } }))).toBe(false);
    });

    it('treats an empty phone and email as acceptable', () => {
      expect(isStepComplete(1, state({ entity: { phone: '', email: '' } }))).toBe(true);
    });

    it('rejects a malformed email but accepts a valid one', () => {
      expect(isStepComplete(1, state({ entity: { email: 'nope' } }))).toBe(false);
      expect(isStepComplete(1, state({ entity: { email: 'a@b.co' } }))).toBe(true);
    });

    it('accepts an email padded with spaces', () => {
      expect(isStepComplete(1, state({ entity: { email: '  a@b.co  ' } }))).toBe(true);
    });

    it.each([
      ['1234567', false, '7 digits, too short'],
      ['12345678', true, '8 digits, the minimum'],
      ['12345678901', true, '11 digits, the maximum'],
      ['123456789012', false, '12 digits, too long'],
    ])('phone %s -> %s (%s)', (phone, expected) => {
      expect(isStepComplete(1, state({ entity: { phone } }))).toBe(expected);
    });

    it('counts digits only, ignoring formatting', () => {
      expect(isStepComplete(1, state({ entity: { phone: '+852 1234 5678' } }))).toBe(true);
      expect(isStepComplete(1, state({ entity: { phone: '(   ) - ' } }))).toBe(true); // no digits = empty
    });
  });

  it('step 2 needs at least one module', () => {
    expect(isStepComplete(2, state({ modules: [] }))).toBe(false);
    expect(isStepComplete(2, state({ modules: ['pettyCash'] }))).toBe(true);
  });

  it('step 3 always passes, because inviting is optional', () => {
    expect(isStepComplete(3, state({ invites: [] }))).toBe(true);
  });

  it('step 4 needs a live Xero connection', () => {
    expect(isStepComplete(4, state({ xero: { connected: false } }))).toBe(false);
    expect(isStepComplete(4, state({ xero: { connected: true } }))).toBe(true);
    expect(isStepComplete(4, state({ xero: undefined }))).toBe(false);
  });

  describe('step 5 -- the opening balance', () => {
    const withBalance = (openingBalance: unknown) =>
      state({ pettyCash: { ...initialState().pettyCash, openingBalance } });

    it('fails on a fresh wizard, because initialState has no openingBalance', () => {
      expect(isStepComplete(5, state())).toBe(false);
    });

    it.each([
      { value: undefined, expected: false, why: 'unset' },
      { value: null, expected: false, why: 'null' },
      { value: '', expected: false, why: 'an empty string' },
      { value: '   ', expected: false, why: 'whitespace' },
      { value: 0, expected: true, why: 'zero -- a real answer, not a missing one' },
      { value: '0', expected: true, why: 'zero as a string' },
      { value: 1500, expected: true, why: 'a number' },
      { value: '1500.50', expected: true, why: 'a decimal string' },
    ])('$why -> $expected', ({ value, expected }) => {
      expect(isStepComplete(5, withBalance(value))).toBe(expected);
    });

    it('is not fooled by a missing pettyCash object', () => {
      expect(isStepComplete(5, state({ pettyCash: undefined }))).toBe(false);
    });
  });

  it.each([6, 7, 8])('step %i always passes -- it has defaults for everything', (id) => {
    expect(isStepComplete(id, state())).toBe(true);
  });

  it.each([0, 9, 10, -1])('returns false for the out-of-flow id %i', (id) => {
    // 9 is "All Set", which is a destination rather than a step with a gate.
    expect(isStepComplete(id, state())).toBe(false);
  });
});
