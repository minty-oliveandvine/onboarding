// components/steps/pettyCashFields -- the pieces shared by the petty-cash steps.
//
// AccountCodesCard carries the only genuinely tricky state in the file, and it is a
// TRI-STATE pretending to be a boolean map:
//
//     { all: true,  selected: {} }            everything is on
//     { all: true,  selected: { x: false } }  everything EXCEPT x
//     { all: false, selected: { x: true } }   only x
//
// So `selected` means the opposite thing depending on `all`, and a code absent from
// `selected` is ON under all:true and OFF under all:false. It is rendered by BOTH
// StepAccountCode and StepBills, which differ only in the three props kept for that
// purpose -- each of those differences is observable, which is why they were not
// normalised away.

import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountCodesCard,
  CURRENCY_CODES,
  MintCheck,
  PCSection,
  currencyCode,
} from '../steps/pettyCashFields';

const CODES = ['6420', '6500', '7010'];
const LABELS = {
  6420: '6420 · Office Supplies',
  6500: '6500 · Travel',
  7010: '7010 · Bank Fees',
};

describe('currencyCode', () => {
  it('resolves a currency uuid through the fetched registry', () => {
    const registry = [{ currency_id: 'c-1', iso_code: 'HKD', currency_name: 'Hong Kong Dollar' }];
    expect(currencyCode('c-1', registry)).toBe('HKD');
  });

  it('falls back to the registry name when the row has no iso code', () => {
    const registry = [{ currency_id: 'c-1', iso_code: '', currency_name: 'Hong Kong Dollar' }];
    expect(currencyCode('c-1', registry)).toBe('Hong Kong Dollar');
  });

  it('renders NOTHING for an unresolved uuid rather than the bare uuid', () => {
    // While the registry is still loading. Showing the uuid would put a raw
    // database id in front of the user.
    expect(currencyCode('2749a5a2-5a9f-482a-97df-af2b6a5ac0e6', [])).toBe('');
  });

  it('still maps a currency NAME, for sessions saved before the uuid switch', () => {
    expect(currencyCode('Hong Kong Dollar', [])).toBe('HKD');
    expect(currencyCode('US Dollar', [])).toBe('USD');
  });

  it('falls back to the first word for an unknown name', () => {
    expect(currencyCode('Japanese Yen', [])).toBe('Japanese');
  });

  it('handles null and undefined without throwing', () => {
    expect(currencyCode(null, [])).toBe('');
    expect(currencyCode(undefined, [])).toBe('');
  });

  it('defaults the registry, so it can be called before the fetch resolves', () => {
    expect(currencyCode('Hong Kong Dollar')).toBe('HKD');
  });

  it('maps every name in CURRENCY_CODES to a three-letter code', () => {
    for (const [name, code] of Object.entries(CURRENCY_CODES)) {
      expect(code).toHaveLength(3);
      expect(currencyCode(name, [])).toBe(code);
    }
  });
});

describe('MintCheck', () => {
  it('exposes itself as a checkbox with its state', () => {
    render(<MintCheck checked={false} onChange={vi.fn()} ariaLabel="Office Supplies" />);
    const box = screen.getByRole('checkbox', { name: 'Office Supplies' });
    expect(box).toHaveAttribute('aria-checked', 'false');
  });

  it('reports the INVERSE of its current state when clicked', () => {
    const onChange = vi.fn();
    const { rerender } = render(<MintCheck checked={false} onChange={onChange} ariaLabel="a" />);
    screen.getByRole('checkbox').click();
    expect(onChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    rerender(<MintCheck checked onChange={onChange} ariaLabel="a" />);
    screen.getByRole('checkbox').click();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('carries the `on` class only when checked', () => {
    const { container, rerender } = render(<MintCheck checked={false} onChange={vi.fn()} ariaLabel="a" />);
    expect(container.querySelector('.mint-check')).not.toHaveClass('on');
    rerender(<MintCheck checked onChange={vi.fn()} ariaLabel="a" />);
    expect(container.querySelector('.mint-check')).toHaveClass('on');
  });
});

describe('AccountCodesCard', () => {
  function setup(props = {}) {
    const onChange = vi.fn();
    const utils = render(
      <AccountCodesCard
        codes={CODES}
        value={{ all: true, selected: {} }}
        labels={LABELS}
        onChange={onChange}
        {...props}
      />,
    );
    const rowChecks = () =>
      Array.from(utils.container.querySelectorAll('.acc-row')).map(
        (li) => within(li as HTMLElement).getByRole('checkbox'),
      );
    const selectAll = () => screen.getByRole('checkbox', { name: 'Select all' });
    return { onChange, rowChecks, selectAll, ...utils };
  }

  describe('reading the tri-state', () => {
    it('shows every code on for { all: true, selected: {} }', () => {
      const { rowChecks } = setup();
      for (const box of rowChecks()) expect(box).toHaveAttribute('aria-checked', 'true');
    });

    it('treats a MISSING all as on, not off', () => {
      // `all !== false`, so undefined means on. A `!!value.all` test here would
      // render a fully-populated card as entirely deselected.
      const { rowChecks } = setup({ value: { selected: {} } });
      for (const box of rowChecks()) expect(box).toHaveAttribute('aria-checked', 'true');
    });

    it('reads selected as EXCLUSIONS under all:true', () => {
      const { rowChecks } = setup({ value: { all: true, selected: { 6500: false } } });
      expect(rowChecks().map((b) => b.getAttribute('aria-checked'))).toEqual([
        'true',
        'false',
        'true',
      ]);
    });

    it('reads selected as INCLUSIONS under all:false', () => {
      const { rowChecks } = setup({ value: { all: false, selected: { 6500: true } } });
      expect(rowChecks().map((b) => b.getAttribute('aria-checked'))).toEqual([
        'false',
        'true',
        'false',
      ]);
    });

    it('tolerates a missing selected object', () => {
      const { rowChecks } = setup({ value: { all: false } });
      for (const box of rowChecks()) expect(box).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('toggling one code', () => {
    it('converts all:true into an explicit map when the first code is turned off', () => {
      // The important half: it does NOT emit { all: true, selected: { x: false } }.
      // It materialises every code so later toggles read as plain inclusions.
      const { rowChecks, onChange } = setup();
      rowChecks()[1].click();
      expect(onChange).toHaveBeenCalledWith({
        all: false,
        selected: { 6420: true, 6500: false, 7010: true },
      });
    });

    it('flips a single entry once the map is explicit', () => {
      const { rowChecks, onChange } = setup({
        value: { all: false, selected: { 6420: true, 6500: false, 7010: true } },
      });
      rowChecks()[1].click();
      expect(onChange).toHaveBeenCalledWith({
        all: false,
        selected: { 6420: true, 6500: true, 7010: true },
      });
    });

    it('turns a code back off without disturbing the others', () => {
      const { rowChecks, onChange } = setup({
        value: { all: false, selected: { 6420: true, 6500: true, 7010: false } },
      });
      rowChecks()[0].click();
      expect(onChange).toHaveBeenCalledWith({
        all: false,
        selected: { 6420: false, 6500: true, 7010: false },
      });
    });
  });

  describe('select all', () => {
    it('reads as checked when every code is on', () => {
      const { selectAll } = setup();
      expect(selectAll()).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('Deselect all')).toBeInTheDocument();
    });

    it('collapses back to the compact { all: true, selected: {} } form', () => {
      const { selectAll, onChange } = setup({
        value: { all: false, selected: { 6420: true, 6500: false, 7010: true } },
      });
      selectAll().click();
      // Not an explicit map of trues -- the compact form, so a code added later in
      // Xero is included rather than silently excluded.
      expect(onChange).toHaveBeenCalledWith({ all: true, selected: {} });
    });

    it('deselects everything explicitly', () => {
      const { selectAll, onChange } = setup();
      selectAll().click();
      expect(onChange).toHaveBeenCalledWith({
        all: false,
        selected: { 6420: false, 6500: false, 7010: false },
      });
    });

    it('reads as unchecked when a single code is off', () => {
      const { selectAll } = setup({ value: { all: true, selected: { 6500: false } } });
      expect(selectAll()).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText('Select all')).toBeInTheDocument();
    });

    it('is NOT checked when there are no codes at all', () => {
      // `codes.length > 0 &&` -- an empty every() is vacuously true, which would
      // otherwise show "Deselect all" over an empty list.
      const { selectAll } = setup({ codes: [] });
      expect(selectAll()).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('search', () => {
    it('matches against the full label when searchLabels is on (the Account step)', async () => {
      const { container } = setup();
      await userEvent.type(screen.getByPlaceholderText('Search account code'), 'office');
      expect(container.querySelectorAll('.acc-row')).toHaveLength(1);
      expect(screen.getByText('6420 · Office Supplies')).toBeInTheDocument();
    });

    it('matches the raw code only when searchLabels is off (the Bill step)', async () => {
      const { container } = setup({ searchLabels: false });
      await userEvent.type(screen.getByPlaceholderText('Search account code'), 'office');
      // The label still READS "6420 · Office Supplies", but the Bill step does not
      // search it -- that difference is the whole point of the prop.
      expect(container.querySelectorAll('.acc-row')).toHaveLength(0);
      await userEvent.clear(screen.getByPlaceholderText('Search account code'));
      await userEvent.type(screen.getByPlaceholderText('Search account code'), '6420');
      expect(container.querySelectorAll('.acc-row')).toHaveLength(1);
    });

    it('ignores case and surrounding whitespace', async () => {
      const { container } = setup();
      await userEvent.type(screen.getByPlaceholderText('Search account code'), '  TRAVEL  ');
      expect(container.querySelectorAll('.acc-row')).toHaveLength(1);
    });

    it('says no match rather than going blank', async () => {
      setup();
      await userEvent.type(screen.getByPlaceholderText('Search account code'), 'zzz');
      expect(screen.getByText('No matching account code')).toBeInTheDocument();
    });

    it('distinguishes an empty search result from having no codes', () => {
      setup({ codes: [] });
      // Different sentence, different cause: nothing loaded vs nothing matched.
      expect(screen.getByText('Connect to Xero to load account codes')).toBeInTheDocument();
      expect(screen.queryByText('No matching account code')).toBeNull();
    });
  });

  describe('the two callers differences', () => {
    it('labels the checkbox with the full label for the Account step', () => {
      setup();
      expect(screen.getByRole('checkbox', { name: '6420 · Office Supplies' })).toBeInTheDocument();
    });

    it('labels it with the bare code for the Bill step', () => {
      setup({ labelAria: false });
      expect(screen.getByRole('checkbox', { name: '6420' })).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: '6420 · Office Supplies' })).toBeNull();
    });

    it('renders the Bill step header above the list', () => {
      setup({ header: <div className="hdr">Bill accounts</div> });
      expect(screen.getByText('Bill accounts')).toBeInTheDocument();
    });

    it('renders no header by default', () => {
      const { container } = setup();
      expect(container.querySelector('.hdr')).toBeNull();
    });

    it('applies the caller bodyStyle', () => {
      const { container } = setup({ bodyStyle: { padding: 0, display: 'flex' } });
      const body = container.querySelector('.method-body') as HTMLElement;
      expect(body.style.padding).toBe('0px');
      expect(body.style.display).toBe('flex');
    });
  });

  it('falls back to the code when no label exists for it', () => {
    setup({ labels: { 6420: '6420 · Office Supplies' } });
    expect(screen.getByText('6500')).toBeInTheDocument();
  });

  it('falls back to the code when labels is omitted entirely', () => {
    setup({ labels: undefined });
    for (const code of CODES) expect(screen.getByText(code)).toBeInTheDocument();
  });
});

describe('PCSection', () => {
  // All eight call sites in OnboardingSteps pass a cardRef -- the step scrolls the
  // card into view when validation fails -- so the tests supply one too.
  const ref = () => createRef<HTMLDivElement>();
  const field = (over = {}) => ({
    label: 'Director',
    value: '',
    options: [{ id: 'a', label: 'Alice' }],
    onChange: vi.fn(),
    onAddNew: vi.fn(),
    ...over,
  });

  it('renders the title and one row per field', () => {
    const { container } = render(
      <PCSection title="Contacts" cardRef={ref()} fields={[field(), field({ label: 'Cash Sale' })]} />,
    );
    expect(screen.getByText('Contacts')).toBeInTheDocument();
    expect(container.querySelectorAll('.pc-field')).toHaveLength(2);
    expect(screen.getByText('Director')).toBeInTheDocument();
    expect(screen.getByText('Cash Sale')).toBeInTheDocument();
  });

  it('marks the whole card in error when ANY field is', () => {
    const { container } = render(
      <PCSection title="Contacts" cardRef={ref()} fields={[field(), field({ error: true })]} />,
    );
    expect(container.querySelector('.pc-card')).toHaveClass('is-error');
    expect(container.querySelectorAll('.pc-field.field-error')).toHaveLength(1);
  });

  it('leaves a clean card unmarked', () => {
    const { container } = render(<PCSection title="Contacts" cardRef={ref()} fields={[field(), field()]} />);
    expect(container.querySelector('.pc-card')).not.toHaveClass('is-error');
    expect(container.querySelector('.field-required')).toBeNull();
  });

  it('shows the error sentence on the field that has the error', () => {
    render(<PCSection title="Contacts" cardRef={ref()} fields={[field({ error: true })]} />);
    expect(screen.getByText(/keep going/)).toBeInTheDocument();
  });

  it('renders nothing but the title for an empty field list', () => {
    const { container } = render(<PCSection title="Contacts" cardRef={ref()} fields={[]} />);
    expect(container.querySelectorAll('.pc-field')).toHaveLength(0);
    expect(container.querySelector('.pc-card')).not.toHaveClass('is-error');
  });
});
