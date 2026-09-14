// Presentational pieces shared by the petty-cash steps: the method list, the tick, the
// account-code card and the titled field section. Extracted verbatim from OnboardingSteps.
//
// AccountCodesCard is rendered by BOTH StepAccountCode and StepBills -- the two are close
// siblings differing mainly in which account set they pass in.

// --- Step 4: Petty Cash Settings ---

import { useState, useRef, useEffect, type DragEvent, type ReactNode, type Ref } from 'react';
import Icon from '../Icon';
import MintySelect, { type SelectOption } from '../MintySelect';
import { UUID_RE } from '../../lib/validation';
import type { CurrencyRow } from '../../lib/refData';
import type { ContactResult } from '../../lib/api';
import type { CodeSelection } from '../../lib/types';

export const CURRENCY_CODES: Record<string, string> = {
  'Hong Kong Dollar': 'HKD',
  'Singapore Dollar': 'SGD',
  'Australian Dollar': 'AUD',
  'New Zealand Dollar': 'NZD',
  'Pound Sterling': 'GBP',
  'US Dollar': 'USD',
  'Indian Rupee': 'INR',
};
// state.entity.currency holds a currency_info uuid (Step 1 dropdowns submit
// uuids); resolve it to the ISO code via the fetched registry. The name-based
// map remains as a fallback for sessions saved before the uuid switch. Never
// render a bare uuid — while the registry is still loading, show nothing.
export const currencyCode = (
  c: string | null | undefined,
  registry: readonly Pick<CurrencyRow, 'currency_id' | 'iso_code' | 'currency_name'>[] = [],
): string => {
  const row = registry.find((r) => r.currency_id === c);
  if (row) return row.iso_code || row.currency_name;
  if (UUID_RE.test(c || '')) return '';
  return CURRENCY_CODES[c || ''] || (c || '').split(' ')[0];
};

type MethodListProps = {
  title: string;
  methods: string[];
  placeholder?: string;
  onAdd: (name: string) => void;
  /** Receives a fresh array; the list never mutates the one it was given. */
  onChange: (methods: string[]) => void;
  autoFilled?: boolean;
};

export function MethodList({
  title,
  methods,
  placeholder = 'Enter method name',
  onAdd,
  onChange,
  autoFilled = false,
}: MethodListProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const remove = (i: number) => {
    const copy = methods.slice();
    copy.splice(i, 1);
    onChange(copy);
  };

  const onDragStart = (i: number) => (e: DragEvent) => {
    setDragIdx(i);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(i));
      } catch {}
    }
  };
  const onDragOver = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (overIdx !== i) setOverIdx(i);
  };
  const onDrop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const copy = methods.slice();
    const [moved] = copy.splice(dragIdx, 1);
    copy.splice(i, 0, moved);
    onChange(copy);
    setDragIdx(null);
    setOverIdx(null);
  };
  const onDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  const cancel = () => {
    setAdding(false);
    setName('');
  };
  const submit = () => {
    const v = name.trim();
    if (!v) return;
    onAdd(v);
    setName('');
    setAdding(false);
  };

  return (
    <div className="method-card open">
      <div className="method-head method-head-static">
        <span className="method-title">
          {title}
          {autoFilled && (
            <span className="method-sparkle" aria-hidden>
              <Icon.Sparkle />
            </span>
          )}
        </span>
      </div>
      <div className="method-body" style={{ display: 'block' }}>
        <ul className="method-list">
          {methods.map((m, i) => (
            <li
              className={
                'method-row' +
                (dragIdx === i ? ' is-dragging' : '') +
                (overIdx === i && dragIdx !== i ? ' is-drag-over' : '')
              }
              key={m + i}
              onDragOver={onDragOver(i)}
              onDrop={onDrop(i)}
              onDragLeave={() => {
                if (overIdx === i) setOverIdx(null);
              }}
            >
              <span className="method-name">{m}</span>
              <div className="method-actions">
                <button
                  type="button"
                  className="method-trash"
                  aria-label={'Delete ' + m}
                  onClick={() => remove(i)}
                >
                  <Icon.Trash />
                </button>
                <span
                  className="method-drag"
                  role="button"
                  aria-label={'Drag to reorder ' + m}
                  draggable
                  onDragStart={onDragStart(i)}
                  onDragEnd={onDragEnd}
                  title="Drag to reorder"
                >
                  <Icon.Grip />
                </span>
              </div>
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="method-add-form">
            <div className="method-add-field">
              <label>Name</label>
              <div className="field">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={placeholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                    if (e.key === 'Escape') cancel();
                  }}
                />
              </div>
            </div>
            <div className="method-add-actions">
              <button type="button" className="btn-cancel-outline" onClick={cancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-mint-pill"
                disabled={!name.trim()}
                onClick={submit}
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="method-add" onClick={() => setAdding(true)}>
            <Icon.Plus /> Add New Method
          </button>
        )}
      </div>
    </div>
  );
}

export function MintCheck({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={'mint-check' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
    >
      {checked && <Icon.CheckSm />}
    </button>
  );
}

// Shared account-code picker for the Account Code and Bill steps.
//
// The two steps differ in three ways, each kept as a prop rather than
// normalized away, because each is observable behavior:
//   - `header`      Bill renders a title/subtitle block above the list.
//   - `searchLabels` Account matches the typed query against the full
//                    "CODE · Name" label; Bill matches the raw code only.
//   - `labelAria`   Account's checkbox aria-label is the full label; Bill's
//                    is the bare code.
// `bodyStyle` carries the two steps' differing padding/display.
type AccountCodesCardProps = {
  /** The codes, in display order. Labels come from `labels`. */
  codes: string[];
  /** May arrive with `all` or `selected` missing -- both are tolerated, see lib/types. */
  value: Partial<CodeSelection>;
  onChange: (next: CodeSelection) => void;
  labels?: Record<string, string>;
  header?: ReactNode;
  /** Account step searches the full label; Bill step searches the raw code only. */
  searchLabels?: boolean;
  /** Account step labels the checkbox with the full label; Bill step with the bare code. */
  labelAria?: boolean;
  bodyStyle?: React.CSSProperties;
};

export function AccountCodesCard({
  codes,
  value,
  onChange,
  labels,
  header = null,
  searchLabels = true,
  labelAria = true,
  bodyStyle = { padding: 20 },
}: AccountCodesCardProps) {
  const [q, setQ] = useState('');
  const sel: Record<string, boolean> = value.selected || {};
  const isAll = value.all !== false;
  const isOn = (code: string) => (isAll ? sel[code] !== false : sel[code] === true);
  const allOn = codes.length > 0 && codes.every((c) => isOn(c));
  const labelOf = (code: string) => (labels && labels[code]) || code;
  const toggle = (code: string) => {
    if (isAll) {
      const next: Record<string, boolean> = {};
      codes.forEach((c) => {
        next[c] = true;
      });
      next[code] = false;
      onChange({ all: false, selected: next });
      return;
    }
    const cur = isOn(code);
    onChange({ all: false, selected: { ...sel, [code]: !cur } });
  };
  const toggleAll = () => {
    if (allOn) {
      const off: Record<string, boolean> = {};
      codes.forEach((c) => {
        off[c] = false;
      });
      onChange({ all: false, selected: off });
    } else {
      onChange({ all: true, selected: {} });
    }
  };
  const searchTextOf = (code: string) => (searchLabels ? labelOf(code) : code);
  const filtered = codes.filter((c) =>
    searchTextOf(c).toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="method-card acc-card open">
      {header}
      <div className="method-body" style={bodyStyle}>
        <div className="acc-search">
          <input
            type="text"
            placeholder="Search account code"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="acc-search-icon">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </span>
        </div>
        <div className="acc-allrow">
          <span className="acc-all-label">{allOn ? 'Deselect all' : 'Select all'}</span>
          <MintCheck checked={allOn} onChange={toggleAll} ariaLabel="Select all" />
        </div>
        <ul className="acc-list">
          {filtered.map((code) => (
            <li className="acc-row" key={code}>
              <span className="acc-name">{labelOf(code)}</span>
              <MintCheck
                checked={isOn(code)}
                onChange={() => toggle(code)}
                ariaLabel={labelAria ? labelOf(code) : code}
              />
            </li>
          ))}
          {codes.length === 0 && (
            <li className="acc-empty">Connect to Xero to load account codes</li>
          )}
          {codes.length > 0 && filtered.length === 0 && (
            <li className="acc-empty">No matching account code</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** One dropdown row in a PCSection. */
export type PCField = {
  label: ReactNode;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  onAddNew?: ((name: string) => Promise<ContactResult>) | null;
  error?: boolean;
};

type PCSectionProps = {
  title: string;
  fields: PCField[];
  /** The step scrolls the card into view when validation fails. */
  cardRef?: Ref<HTMLDivElement>;
};

export function PCSection({ title, fields, cardRef }: PCSectionProps) {
  const cardHasError = fields.some((f) => f.error);
  return (
    <div className={'pc-card' + (cardHasError ? ' is-error' : '')} ref={cardRef}>
      <div className="pc-title">{title}</div>
      {fields.map((f, i) => (
        <div className={'pc-field' + (f.error ? ' field-error' : '')} key={i}>
          <div className="pc-sub">{f.label}</div>
          <MintySelect
            value={f.value}
            onChange={f.onChange}
            options={f.options}
            placeholder="Select an option"
            searchable
            clearable
            onCreate={f.onAddNew}
            createNoun="contact"
          />
          {f.error && <div className="field-required">I&apos;ll need this one to keep going.</div>}
        </div>
      ))}
    </div>
  );
}
