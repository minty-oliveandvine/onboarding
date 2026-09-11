// Presentational pieces shared by the petty-cash steps: the method list, the tick, the
// account-code card and the titled field section. Extracted verbatim from OnboardingSteps.
//
// AccountCodesCard is rendered by BOTH StepAccountCode and StepBills -- the two are close
// siblings differing mainly in which account set they pass in.


// --- Step 4: Petty Cash Settings ---

import { useState, useRef, useEffect } from 'react';
import Icon from '../Icon';
import MintySelect from '../MintySelect';
import { UUID_RE } from '../../lib/validation';
export const CURRENCY_CODES = {
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
export const currencyCode = (c, registry = []) => {
  const row = registry.find((r) => r.currency_id === c);
  if (row) return row.iso_code || row.currency_name;
  if (UUID_RE.test(c || '')) return '';
  return CURRENCY_CODES[c] || (c || '').split(' ')[0];
};

export function MethodList({ title, methods, placeholder = 'Enter method name', onAdd, onChange, autoFilled = false }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const remove = (i) => {
    const copy = methods.slice();
    copy.splice(i, 1);
    onChange(copy);
  };

  const onDragStart = (i) => (e) => {
    setDragIdx(i);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(i));
      } catch {}
    }
  };
  const onDragOver = (i) => (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (overIdx !== i) setOverIdx(i);
  };
  const onDrop = (i) => (e) => {
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
              className={'method-row' + (dragIdx === i ? ' is-dragging' : '') + (overIdx === i && dragIdx !== i ? ' is-drag-over' : '')}
              key={m + i}
              onDragOver={onDragOver(i)}
              onDrop={onDrop(i)}
              onDragLeave={() => {
                if (overIdx === i) setOverIdx(null);
              }}
            >
              <span className="method-name">{m}</span>
              <div className="method-actions">
                <button type="button" className="method-trash" aria-label={'Delete ' + m} onClick={() => remove(i)}>
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
              <button type="button" className="btn-mint-pill" disabled={!name.trim()} onClick={submit}>
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

export function MintCheck({ checked, onChange, ariaLabel }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={ariaLabel} className={'mint-check' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
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
export function AccountCodesCard({
  codes,
  value,
  onChange,
  labels,
  header = null,
  searchLabels = true,
  labelAria = true,
  bodyStyle = { padding: 20 },
}) {
  const [q, setQ] = useState('');
  const sel = value.selected || {};
  const isAll = value.all !== false;
  const isOn = (code) => (isAll ? sel[code] !== false : sel[code] === true);
  const allOn = codes.length > 0 && codes.every((c) => isOn(c));
  const labelOf = (code) => (labels && labels[code]) || code;
  const toggle = (code) => {
    if (isAll) {
      const next = {};
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
      const off = {};
      codes.forEach((c) => {
        off[c] = false;
      });
      onChange({ all: false, selected: off });
    } else {
      onChange({ all: true, selected: {} });
    }
  };
  const searchTextOf = (code) => (searchLabels ? labelOf(code) : code);
  const filtered = codes.filter((c) => searchTextOf(c).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="method-card acc-card open">
      {header}
      <div className="method-body" style={bodyStyle}>
        <div className="acc-search">
          <input type="text" placeholder="Search account code" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="acc-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          {codes.length === 0 && <li className="acc-empty">Connect to Xero to load account codes</li>}
          {codes.length > 0 && filtered.length === 0 && <li className="acc-empty">No matching account code</li>}
        </ul>
      </div>
    </div>
  );
}

export function PCSection({ title, fields, cardRef }) {
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
