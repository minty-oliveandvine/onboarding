'use client';

// Step content components. Each receives { state, set, next, back }.
import { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import Icon from './Icon';
import MintySelect from './MintySelect';
import MintyDatePicker from './MintyDatePicker';
import Confetti from './Confetti';
import { useToast } from './Toast';
import { fetchCountries, fetchCurrencies } from '@/lib/refData';
import { acceptAmountInput, formatAmount, toAmountEditString } from '@/lib/amount';

// --- Reusable bits ---
export function Switch({ on, onChange }) {
  return <button type="button" className={'switch' + (on ? ' on' : '')} onClick={() => onChange(!on)} aria-pressed={on} />;
}
export function ToggleRow({ title, sub, on, onChange }) {
  return (
    <div className="toggle-row">
      <div>
        <div className="t-label">{title}</div>
        {sub && <div className="t-sub">{sub}</div>}
      </div>
      <Switch on={on} onChange={onChange} />
    </div>
  );
}

// Shared "Save & Exit" control shown in every step's footer. Saves the current
// step's data best-effort (via the step's submit fn) then leaves to the entity
// list dashboard. The actual save+redirect lives in OnboardingApp's saveAndExit;
// here we just manage the local "Saving…" state. `submitFn` is optional — steps
// without a per-step save (Invite, Connect Xero) pass nothing and we exit after
// persisting via localStorage.
export function SaveExitLink({ saveAndExit, submitFn, disabled = false, className = 'btn-link-center', style }) {
  const [exiting, setExiting] = useState(false);
  const onClick = async () => {
    if (exiting || disabled) return;
    setExiting(true);
    try {
      await saveAndExit(submitFn);
    } catch {
      setExiting(false); // saveAndExit redirects on success, so we only land here on failure
    }
  };
  return (
    <button
      type="button"
      className={className}
      style={style}
      disabled={disabled || exiting}
      onClick={onClick}
    >
      {exiting ? 'Saving…' : 'Save & Exit'}
    </button>
  );
}

// --- Step 1: Create Entity ---
export function StepCreateEntity({ state, set, next, skip, submitEntity, saveAndExit }) {
  const s = state.entity;
  const upd = (k, v) => set({ entity: { ...s, [k]: v } });
  // Phone and email are optional — but if the user does type something, it must
  // still be valid (Module 1 create-entity: 8–11 digits; standard email shape).
  const emailOk = s.email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email);
  const phoneDigits = s.phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length === 0 || (phoneDigits.length >= 8 && phoneDigits.length <= 11);
  const canNext = s.name.trim().length > 0 && phoneOk && emailOk;
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  // Set when the backend rejects the name as already-taken, so we can flag the
  // Entity Name field and clear the flag as soon as the user edits the name.
  const [nameTaken, setNameTaken] = useState(false);
  // Country / currency options come from the backend registries
  // (country_info / currency_info): the dropdown shows the name but its
  // value — what gets stored and submitted — is the registry uuid, so the
  // created entity's country_id / currency_id FKs receive uuids.
  const [countryOptions, setCountryOptions] = useState([]);
  const [currencyOptions, setCurrencyOptions] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchCountries().then((list) => {
      if (!cancelled) {
        setCountryOptions(list.map((c) => ({ value: c.country_id, label: c.country_name_en })));
      }
    });
    fetchCurrencies().then((list) => {
      if (!cancelled) {
        setCurrencyOptions(list.map((c) => ({ value: c.currency_id, label: c.currency_name })));
      }
    });
    return () => { cancelled = true; };
  }, []);
  // Migrate legacy name values (the pre-registry defaults like 'Hong Kong' /
  // 'Hong Kong Dollar', or an old saved session) to their registry uuids once
  // the options are in, so submits always carry uuids.
  useEffect(() => {
    const byLabel = (opts, v) =>
      v && !opts.some((o) => o.value === v) ? opts.find((o) => o.label === v) : null;
    const country = byLabel(countryOptions, s.country);
    const currency = byLabel(currencyOptions, s.currency);
    if (country || currency) {
      set({
        entity: {
          ...s,
          ...(country ? { country: country.value } : {}),
          ...(currency ? { currency: currency.value } : {}),
        },
      });
    }
  }, [countryOptions, currencyOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = async () => {
    if (!canNext || saving) return;
    setNameTaken(false);
    if (typeof submitEntity === 'function') {
      setSaving(true);
      const result = await submitEntity();
      setSaving(false);
      if (!result?.ok) {
        // A duplicate name is announced by the inline field message, which points
        // at the field the user has to change. Raising the toast too would say the
        // same thing twice, so only non-duplicate failures get one.
        if (result?.duplicate) setNameTaken(true);
        else toast.error(result.error);
        return;
      }
    }
    next();
  };

  const backToEntityList = () => {
    const base = (process.env.NEXT_PUBLIC_MODULE1_API_URL || 'http://localhost:5001').replace(/\/$/, '');
    window.location.href = `${base}/entity`;
  };
  return (
    <>
      <div className="page-head">
        <img src="/assets/basic-info-cat.png" alt="" className="basic-info-cat" />
        <h2>Basic Information</h2>
        <p>Let&apos;s start by creating your first entity. It only takes a minute.</p>
      </div>
      <div className="form-stack">
        <div className={'field' + (nameTaken ? ' field-error' : '')}>
          <label>Entity Name</label>
          <input
            type="text"
            name="organization"
            autoComplete="organization"
            placeholder="Please enter your company name"
            value={s.name}
            aria-invalid={nameTaken}
            onChange={(e) => {
              // Editing the name clears the duplicate field flag so it doesn't
              // linger while the user types a new name. The toast dismisses
              // itself, so there's nothing to clear there.
              if (nameTaken) setNameTaken(false);
              upd('name', e.target.value);
            }}
          />
          {nameTaken && (
            <div className="field-required" role="alert">Oh, someone got there first! Do you have another name in mind?</div>
          )}
        </div>
        <div className="field">
          <label>Country</label>
          <MintySelect value={s.country} onChange={(v) => upd('country', v)} options={countryOptions} searchable />
        </div>
        <div className="field">
          <label>Currency</label>
          <MintySelect value={s.currency} onChange={(v) => upd('currency', v)} options={currencyOptions} searchable />
        </div>
        <div className="field">
          <label>Contact Phone <span className="field-optional">(optional)</span></label>
          <input type="tel" name="tel" autoComplete="tel" inputMode="numeric" maxLength={11} pattern="[0-9]{8,11}" title="Phone number must be 8-11 digits" placeholder="Please enter your contact phone number" value={s.phone} onChange={(e) => upd('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} />
        </div>
        <div className="field">
          <label>Business Email <span className="field-optional">(optional)</span></label>
          <input type="email" name="email" autoComplete="email" placeholder="Please enter your business email" value={s.email} onChange={(e) => upd('email', e.target.value)} />
        </div>
      </div>
      <div className="cta-stack">
        <button className="btn btn-primary btn-block btn-jelly" disabled={!canNext || saving} onClick={handleNext}>
          {saving ? 'Saving…' : 'Save & Next'}
        </button>
        <SaveExitLink saveAndExit={saveAndExit} submitFn={submitEntity} disabled={saving} />
        <button className="btn-link-center" onClick={backToEntityList}>Back to Entity List</button>
      </div>
    </>
  );
}

// --- Step 2: Select Module ---
export const MODULES = [
  { id: 'pettyCash', title: 'Petty Cash', desc: 'Track and reimburse small office expenses with receipt capture and instant approvals.', img: '/pettycash-icon.png', accent: '#f5b945', price: '280 HKD per Month' },
  { id: 'bills', title: 'Bill Payment', desc: 'Capture vendor bills, schedule payments, and reconcile with your accounting ledger.', img: '/payment-icon.png', accent: '#3aa6f5', price: '280 HKD per Month' },
];

function FreeTrialPill({ heading = false, ripple = false, label = 'Free Trial' }) {
  const [pos, setPos] = useState(null);
  const [mounted, setMounted] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    setMounted(true);
  }, []);
  const show = () => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: r.left + r.width / 2, top: r.top - 8 });
  };
  const hide = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    const onScroll = () => hide();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [pos]);
  return (
    <>
      <span
        ref={ref}
        className={'beta-pill free-trial-pill' + (ripple ? ' is-ripple' : '')}
        tabIndex="0"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => e.stopPropagation()}
        style={heading ? { fontSize: 12.5, padding: '4px 13px' } : undefined}
      >
        {label}
      </span>
      {mounted &&
        pos &&
        ReactDOM.createPortal(
          <div className="free-trial-tip-portal" style={{ left: pos.left, top: pos.top }}>
            <p>Free trial for 30 days, then HK $280 / month afterwards.</p>
          </div>,
          document.body
        )}
    </>
  );
}

export function StepSelectModule({ state, set, next, back, skip, submitModule, saveAndExit }) {
  const sel = state.modules.filter((id) => MODULES.some((m) => m.id === id));
  // Multi-select toggle: clicking a card adds or removes it from the
  // selection. Continue is gated on sel.length > 0 so users must pick at
  // least one — both can be picked together for a full setup.
  const pick = (id) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    set({ modules: next });
  };
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const handleNext = async () => {
    if (sel.length === 0 || saving) return;
    if (typeof submitModule === 'function') {
      setSaving(true);
      const result = await submitModule();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };

  return (
    <>
      <div className="page-head">
        <h2 className="module-title">
          Choose a module <FreeTrialPill heading ripple label="Beta Version" />
        </h2>
        <p>Pick the module you&apos;d like to start with. You can add more later from settings.</p>
      </div>
      <div className="module-grid module-grid-2">
        {MODULES.map((m) => {
          const I = m.icon ? Icon[m.icon] : null;
          const on = sel.includes(m.id);
          return (
            <div
              key={m.id}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              className={'module-pick' + (on ? ' selected' : '')}
              onClick={() => pick(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pick(m.id);
                }
              }}
            >
              <div className="mp-frame">
                <div className="mp-card">
                  <div className="mp-art" style={{ '--art-accent': m.accent }}>
                    {m.img ? <img src={m.img} alt={m.title} className="mp-img" /> : I ? <I width="72" height="72" /> : null}
                  </div>
                  <div className="mp-name" style={{ padding: '10px 12px 4px', margin: '-5px 0px 10px' }}>
                    {m.title}
                  </div>
                  <div className="mp-price">
                    <span className="mp-price-strike">{m.price}</span>
                    <FreeTrialPill />
                  </div>
                  <div className="mp-hover">
                    <div className="mp-title">{m.title}</div>
                    <div className="mp-desc">{m.desc}</div>
                  </div>
                </div>
              </div>
              <div className="mp-label">{m.title}</div>
              <div className="mp-circle" aria-hidden>
                {on && <Icon.CheckSm />}
              </div>
            </div>
          );
        })}
      </div>
      <p className="module-caption">
        *Each module is 280HKD /month subscription, free during the beta period.
      </p>
      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} submitFn={submitModule} disabled={saving} />
          <button className="btn btn-primary" disabled={sel.length === 0 || saving} onClick={handleNext}>
            {saving ? 'Saving…' : <>Save &amp; Next <Icon.Arrow /></>}
          </button>
          {sel.length === 0 && (
            <div className="step-reminder" role="note">
              <Icon.Info />
              Pick a module to continue with your registration.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// --- Step 3: Connect to Xero ---
export function StepConnectXero({ state, set, next, back, skip, connectXero, disconnectXero, xeroMismatch, clearXeroMismatch, xeroConflict, clearXeroConflict, saveAndExit }) {
  const connected = state.xero.connected;
  const lastConnected = state.xero.lastConnected || '07 May 2026';
  const xeroEntity = state.xero.org || state.entity.name || 'Olive & Vine Inc';
  const [disconnecting, setDisconnecting] = useState(false);
  const toast = useToast();

  // Wrong-account block from the OAuth round-trip: `xeroMismatch` holds the
  // email the user must log in with. This arrives via redirect (query param)
  // rather than a submit, so raise it from an effect — the toast is fire-and-
  // forget, so consume the mismatch immediately to stop it re-firing on every
  // re-render. This is the direct analogue of the Flask partial draining
  // get_flashed_messages() on page load.
  useEffect(() => {
    if (!xeroMismatch) return;
    toast.error(
      xeroMismatch === 'unknown'
        ? "Hmm, that's a different Xero account. Sign in with your onboarding email?"
        : `Hmm, that's a different Xero account. Sign in with ${xeroMismatch}?`
    );
    if (typeof clearXeroMismatch === 'function') clearXeroMismatch();
  }, [xeroMismatch, clearXeroMismatch, toast]);

  // One-org-one-entity block, same redirect-driven shape as the mismatch above:
  // raise it from an effect and consume it immediately. `xeroConflict` holds the
  // name of the entity already using the org, or 'unknown' when the backend
  // couldn't tell us — in that case the copy has to stay generic rather than
  // naming a placeholder entity.
  useEffect(() => {
    if (!xeroConflict) return;
    toast.error(
      xeroConflict === 'unknown'
        ? 'Oh, another entity got to this Xero org first! Disconnect it there, then come back?'
        : `Oh, “${xeroConflict}” is using this Xero org already! Disconnect it there, then come back?`
    );
    if (typeof clearXeroConflict === 'function') clearXeroConflict();
  }, [xeroConflict, clearXeroConflict, toast]);

  const handleDisconnect = async () => {
    if (disconnecting || typeof disconnectXero !== 'function') return;
    setDisconnecting(true);
    const result = await disconnectXero();
    setDisconnecting(false);
    if (!result?.ok) {
      toast.error(result.error);
    }
  };
  return (
    <>
      <div className="page-head" style={{ textAlign: 'center', maxWidth: 'none', marginBottom: 18 }}>
        <h2 style={{ fontSize: 30, display: 'inline-flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <img src="/xero-logo.webp" alt="Xero" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
          Xero Integration
          <span className="info-tip" tabIndex="0" aria-label="More info">
            <Icon.Info />
            <span className="info-tip-pop" role="tooltip">
              <p>
                Currently Minty can be used only by integrating to Xero. If you wish to be informed about our feature update, please{' '}
                <a href="#" className="pc-link">
                  register here
                </a>
                .
              </p>
            </span>
          </span>
        </h2>
      </div>

      <div className="notice notice-info">
        <div className="notice-icon">
          <Icon.Info />
        </div>
        <div className="notice-body">
          <div className="notice-title">Information</div>
          <p>You are advised to contact service team for proper setup and configuration of your Xero integration settings.</p>
        </div>
      </div>

      <div className={'card status-card' + (connected ? ' status-connected' : '')} style={{ marginTop: 16 }}>
        <div className="status-head">
          <div>
            <div className="card-title">Connection Status</div>
            {connected ? (
              <div className="status-meta">
                <div>
                  Last connected: <b>{lastConnected}</b>
                </div>
                <div>
                  Xero Entity: <b>{xeroEntity}</b>
                </div>
              </div>
            ) : (
              <div className="status-meta">
                <div>Not connected to Xero yet.</div>
              </div>
            )}
          </div>
          <span className={'pill-status ' + (connected ? 'ok' : 'off')}>{connected ? 'Connected' : 'Not connected'}</span>
        </div>
        {connected ? (
          <div
            className="btn btn-block"
            style={{
              marginTop: 16,
              background: 'var(--accent-soft)',
              color: 'var(--accent-ink)',
              border: '1px solid var(--accent)',
              cursor: 'default',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
            aria-disabled="true"
          >
            <Icon.Check /> Xero Connected
          </div>
        ) : null}
        {connected && (
          <>
            <button
              className="btn btn-ghost btn-block"
              style={{ marginTop: 10 }}
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : <><Icon.Link /> Disconnect from Xero</>}
            </button>
          </>
        )}
        {!connected && (
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 16 }}
            onClick={connectXero}
          >
            <Icon.Link /> Connect to Xero
          </button>
        )}
      </div>

      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} />
          <button className="btn btn-primary" onClick={next} disabled={!connected}>
            Save &amp; Next <Icon.Arrow />
          </button>
          {!connected && (
            <div className="step-reminder" role="note">
              <Icon.Info />
              Connect to Xero to continue.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// --- Step 4: Petty Cash Settings ---
const CURRENCY_CODES = {
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const currencyCode = (c, registry = []) => {
  const row = registry.find((r) => r.currency_id === c);
  if (row) return row.iso_code || row.currency_name;
  if (UUID_RE.test(c || '')) return '';
  return CURRENCY_CODES[c] || (c || '').split(' ')[0];
};

function MethodList({ title, methods, placeholder = 'Enter method name', onAdd, onChange, autoFilled = false }) {
  const [open, setOpen] = useState(true);
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
      } catch (_) {}
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

function MintCheck({ checked, onChange, ariaLabel }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={ariaLabel} className={'mint-check' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
      {checked && <Icon.CheckSm />}
    </button>
  );
}

function AccountCodesCard({ codes, value, onChange, labels }) {
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
  const filtered = codes.filter((c) => labelOf(c).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="method-card acc-card open">
      <div className="method-body" style={{ padding: 20 }}>
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
              <MintCheck checked={isOn(code)} onChange={() => toggle(code)} ariaLabel={labelOf(code)} />
            </li>
          ))}
          {codes.length === 0 && <li className="acc-empty">Connect to Xero to load account codes</li>}
          {codes.length > 0 && filtered.length === 0 && <li className="acc-empty">No matching account code</li>}
        </ul>
      </div>
    </div>
  );
}

function PCSection({ title, fields, cardRef }) {
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

export function StepSalesSetting({ state, set, next, back, skip, submitSalesMethods, submitOpeningBalance, fetchExistingSalesMethods, saveAndExit }) {
  // Save everything on this step: sales methods AND the opening balance/date.
  // submitOpeningBalance no-ops when the balance is empty, so a blank balance
  // never blocks Save & Next / Save & Exit — we persist whatever's filled in.
  // finishOnboarding re-submits the opening balance later; that's idempotent.
  const stepSubmit = async () => {
    const methodsResult = await submitSalesMethods();
    if (!methodsResult?.ok) return methodsResult;
    if (typeof submitOpeningBalance === 'function') {
      const balanceResult = await submitOpeningBalance();
      if (!balanceResult?.ok) return balanceResult;
    }
    return { ok: true };
  };
  const p = state.pettyCash;
  const upd = (k, v) => set({ pettyCash: { ...p, [k]: v } });
  const balanceRef = useRef(null);
  // Currency registry for the amount prefix — entity.currency is a uuid.
  const [currencyRegistry, setCurrencyRegistry] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchCurrencies().then((list) => { if (!cancelled) setCurrencyRegistry(list); });
    return () => { cancelled = true; };
  }, []);
  const [showBalanceError, setShowBalanceError] = useState(false);
  // While focused the field shows plain digits; commas and the trailing ".00"
  // are applied on blur (and on any value rehydrated from the backend).
  const [balanceFocused, setBalanceFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const balanceEmpty = p.openingBalance === undefined || p.openingBalance === null || String(p.openingBalance).trim() === '';

  // Server-authoritative "today" in Hong Kong time — caps the opening date so a
  // future date can't be selected. Falls back to an HK date derived in the
  // browser if the server call fails (the raw browser timezone isn't trusted).
  const dateRef = useRef(null);
  const [serverToday, setServerToday] = useState('');
  const [showDateError, setShowDateError] = useState(false);
  const hkTodayFallback = (() => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
    } catch {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  })();
  const openingMaxDate = serverToday || hkTodayFallback;
  const dateIsFuture = !!p.openingDate && p.openingDate > openingMaxDate;
  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_MODULE1_API_URL || 'http://localhost:5001').replace(/\/$/, '');
    let cancelled = false;
    fetch(`${base}/api/onboarding/server-time`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && d.today) setServerToday(d.today);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onBlocked = () => {
      setShowBalanceError(true);
      requestAnimationFrame(() => {
        if (balanceRef.current) {
          balanceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const input = balanceRef.current.querySelector('input');
          if (input) input.focus({ preventScroll: true });
        }
      });
    };
    window.addEventListener('onb-validation-blocked', onBlocked);
    return () => window.removeEventListener('onb-validation-blocked', onBlocked);
  }, []);

  const tryNext = async () => {
    if (balanceEmpty) {
      setShowBalanceError(true);
      requestAnimationFrame(() => {
        if (balanceRef.current) {
          balanceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const input = balanceRef.current.querySelector('input');
          if (input) input.focus({ preventScroll: true });
        }
      });
      return;
    }
    setShowBalanceError(false);
    if (dateIsFuture) {
      setShowDateError(true);
      requestAnimationFrame(() => {
        if (dateRef.current) dateRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setShowDateError(false);
    if (saving) return;
    // Save everything on this step (sales methods + opening balance/date).
    if (typeof submitSalesMethods === 'function') {
      setSaving(true);
      const result = await stepSubmit();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };
  const DEFAULT_ELECTRONIC = ['Visa', 'Alipay', 'WeChat Pay', 'Mastercard', 'UnionPay', 'Amex', 'Octopus'];
  const DEFAULT_DELIVERY = ['Foodpanda', 'Deliveroo', 'KeeTa'];
  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const isAutofilled = sameList(p.electronicMethods || [], DEFAULT_ELECTRONIC) && sameList(p.deliveryMethods || [], DEFAULT_DELIVERY);

  const [autoFilling, setAutoFilling] = useState(false);
  const resetDefaults = async () => {
    if (isAutofilled) {
      set({
        pettyCash: {
          ...p,
          electronicMethods: [],
          deliveryMethods: [],
        },
      });
      return;
    }
    if (autoFilling) return;
    setAutoFilling(true);
    let electronic = [...DEFAULT_ELECTRONIC];
    let delivery = [...DEFAULT_DELIVERY];
    if (typeof fetchExistingSalesMethods === 'function') {
      const existing = await fetchExistingSalesMethods();
      if (existing && Array.isArray(existing.electronic) && existing.electronic.length > 0) {
        electronic = existing.electronic;
      }
      if (existing && Array.isArray(existing.delivery) && existing.delivery.length > 0) {
        delivery = existing.delivery;
      }
    }
    set({
      pettyCash: {
        ...p,
        electronicMethods: electronic,
        deliveryMethods: delivery,
        expenseCodes: { all: true, selected: {} },
        openingDate: openingMaxDate || todayIso,
      },
    });
    setAutoFilling(false);
  };
  return (
    <>
      <div className="autofill-row">
        <button
          type="button"
          className={'autofill-btn' + (isAutofilled ? ' is-active' : '')}
          onClick={resetDefaults}
          aria-pressed={isAutofilled}
          aria-label={isAutofilled ? 'Clear auto-filled methods' : 'Auto fill default settings'}
        >
          <img src="/tab-logo-alt.png" alt="" className="autofill-logo" />
          <span className="autofill-label">{isAutofilled ? 'Revert' : 'Auto Fill'}</span>
          <span className="autofill-spark" aria-hidden>
            <Icon.Sparkle />
          </span>
        </button>
        <span className="autofill-hint">Don&apos;t know what to choose? Set as default settings.</span>
      </div>
      <div className="page-head pc-page-head" style={{ textAlign: 'left', marginBottom: 18 }}>
        <div className="pc-head-row">
          <h2 style={{ fontSize: 30 }}>Type of sales method of your company</h2>
        </div>
        <p style={{ marginTop: 6 }}>Add the payment and delivery channels you accept. You can always go back to settings to edit options</p>
      </div>

      <div className="pc-stack">
        <MethodList
          title="Electronic"
          placeholder="Enter payment method name"
          methods={p.electronicMethods || []}
          autoFilled={isAutofilled}
          onAdd={(name) => upd('electronicMethods', [...(p.electronicMethods || []), name])}
          onChange={(list) => upd('electronicMethods', list)}
        />

        <MethodList
          title="Delivery"
          placeholder="Enter delivery method name"
          methods={p.deliveryMethods || []}
          autoFilled={isAutofilled}
          onAdd={(name) => upd('deliveryMethods', [...(p.deliveryMethods || []), name])}
          onChange={(list) => upd('deliveryMethods', list)}
        />

        <div className="pc-section-head">
          <div className="pc-section-title">Petty Cash Opening Balance</div>
          <div className="pc-section-sub">Set the starting point so future movements reconcile correctly.</div>
        </div>
        <div className={'pc-card' + (showBalanceError && balanceEmpty ? ' is-error' : '')} ref={balanceRef}>
          <div className={'pc-field' + (showDateError && dateIsFuture ? ' field-error' : '')} ref={dateRef}>
            <div className="pc-sub">
              Choose the first date that you wish to use <span className="pc-hint">(prefilled with today&apos;s date — click to choose another)</span>
            </div>
            <MintyDatePicker
              value={p.openingDate || ''}
              onChange={(v) => {
                upd('openingDate', v);
                setShowDateError(false);
              }}
              placeholder="Select a date"
              maxDate={openingMaxDate}
            />
            {showDateError && dateIsFuture && <div className="field-required">That day hasn&apos;t happened yet! Pick an earlier one?</div>}
          </div>
          <div className={'pc-field' + (showBalanceError && balanceEmpty ? ' field-error' : '')}>
            <div className="pc-sub">Choose the beginning petty cash balance of the day</div>
            <div className="field">
              <div className="input-prefix">
                <div className="prefix">{currencyCode(state.entity.currency, currencyRegistry)}</div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={balanceFocused ? toAmountEditString(p.openingBalance) : formatAmount(p.openingBalance)}
                  onFocus={() => setBalanceFocused(true)}
                  onChange={(e) => {
                    const raw = acceptAmountInput(e.target.value);
                    if (raw === null) return; // past the digit limits — refuse the keystroke
                    upd('openingBalance', raw);
                    if (raw !== '') setShowBalanceError(false);
                  }}
                  onBlur={() => setBalanceFocused(false)}
                />
              </div>
            </div>
            {showBalanceError && balanceEmpty && <div className="field-required">I&apos;ll need a starting balance here.</div>}
          </div>
        </div>
      </div>

      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} submitFn={stepSubmit} disabled={saving} />
          <button className="btn btn-primary" onClick={tryNext} disabled={saving}>
            {saving ? 'Saving…' : <>Save &amp; Next <Icon.Arrow /></>}
          </button>
        </div>
      </div>
    </>
  );
}

export function StepAccountCode({ state, set, next, back, skip, accountOptions, submitAccountCodes, saveAndExit }) {
  const stepSubmit = submitAccountCodes;
  const p = state.pettyCash;
  const upd = (k, v) => set({ pettyCash: { ...p, [k]: v } });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [showErrors, setShowErrors] = useState(false);

  const pcAccountRef = useRef(null);
  const depositAccountRef = useRef(null);
  const directorCodeRef = useRef(null);
  const cashSalesCodeRef = useRef(null);
  const discrepancyCodeRef = useRef(null);

  const opts = accountOptions || {};
  const labelsOf = (list) => (list || []).map((o) => o.label);
  const bankLabels = labelsOf(opts.bank);
  // Hide each chosen bank from the other dropdown — they can't be the same.
  const pcBankOptions = bankLabels.filter((l) => l !== p.depositAccount);
  const depositBankOptions = bankLabels.filter((l) => l !== p.pcAccount);
  const directorLabels = labelsOf(opts.director);
  const cashSaleLabels = labelsOf(opts.cashSale);
  const discrepancyLabels = labelsOf(opts.discrepancy);
  const expenseCodes = (opts.expense || []).map((e) => e.code);
  const expenseLabels = Object.fromEntries(
    (opts.expense || []).map((e) => [e.code, e.name ? `${e.code} · ${e.name}` : e.code])
  );

  const missingFields = [
    { key: 'pcAccount', empty: !p.pcAccount, ref: pcAccountRef },
    { key: 'depositAccount', empty: !p.depositAccount, ref: depositAccountRef },
    { key: 'directorCode', empty: !p.directorCode, ref: directorCodeRef },
    { key: 'cashSalesCode', empty: !p.cashSalesCode, ref: cashSalesCodeRef },
    { key: 'discrepancyCode', empty: !p.discrepancyCode, ref: discrepancyCodeRef },
  ];

  const tryNext = async () => {
    if (saving) return;
    const firstMissing = missingFields.find((f) => f.empty);
    if (firstMissing) {
      setShowErrors(true);
      requestAnimationFrame(() => {
        const node = firstMissing.ref.current;
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setShowErrors(false);
    if (typeof submitAccountCodes === 'function') {
      setSaving(true);
      const result = await submitAccountCodes();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: 'left', marginBottom: 18 }}>
        <h2 style={{ fontSize: 30 }}>Account Code Setting</h2>
        <p style={{ marginTop: 6 }}>Map each cash flow to the right account in your ledger — these settings need manual input from you.</p>
      </div>

      <div className="pc-stack">
        <div className="pc-section-head" style={{ marginTop: 0, paddingTop: 0, border: 0 }}>
          <div className="pc-section-title">Petty Cash Account Codes</div>
          <div className="pc-section-sub">Only selected account code will appear when adding an expense in Petty Cash.</div>
        </div>
        <AccountCodesCard
          codes={expenseCodes}
          labels={expenseLabels}
          value={p.expenseCodes || { all: true, selected: {} }}
          onChange={(v) => upd('expenseCodes', v)}
        />

        <PCSection
          title="Petty Cash Account"
          cardRef={pcAccountRef}
          fields={[
            {
              label: (
                <>
                  Select Bank account in Xero that will record petty cash movement. You may need to first add a bank account in Xero.{' '}
                  <a
                    href="https://my.xero.com/"
                    className="pc-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    (Link)
                  </a>
                </>
              ),
              value: p.pcAccount || '',
              onChange: (v) => upd('pcAccount', v),
              options: pcBankOptions,
              error: showErrors && !p.pcAccount,
            },
          ]}
        />

        <PCSection
          title="Deposit Bank Account"
          cardRef={depositAccountRef}
          fields={[
            {
              label: 'Select bank account in Xero for actual bank that your company use to deposit and withdraw cash.',
              value: p.depositAccount || '',
              onChange: (v) => upd('depositAccount', v),
              options: depositBankOptions,
              error: showErrors && !p.depositAccount,
            },
          ]}
        />

        <PCSection
          title="Director Personal Account"
          cardRef={directorCodeRef}
          fields={[
            {
              label: 'Select account code for the Advance Payment from director',
              value: p.directorCode || '',
              onChange: (v) => upd('directorCode', v),
              options: directorLabels,
              error: showErrors && !p.directorCode,
            },
          ]}
        />

        <PCSection
          title="Cash Sales"
          cardRef={cashSalesCodeRef}
          fields={[
            {
              label: 'Select account code for cash sales',
              value: p.cashSalesCode || '',
              onChange: (v) => upd('cashSalesCode', v),
              options: cashSaleLabels,
              error: showErrors && !p.cashSalesCode,
            },
          ]}
        />

        <div className="pc-section-head">
          <div className="pc-section-title">
            Cash Discrepancy — Other Expense
            <span className="info-tip" tabIndex="0" aria-label="More info">
              <Icon.Info />
              <span className="info-tip-pop" role="tooltip">
                <p>Account code to record the outliers such as extra cash or lost cash.</p>
                <p>Extra cash may be due to tips from the customer.</p>
                <p>Lost cash may be due to lost receipts.</p>
              </span>
            </span>
          </div>
          <div className="pc-section-sub">Where to post unaccounted-for cash differences when reconciling petty cash.</div>
        </div>
        <PCSection
          title="Discrepancy — Other Expense"
          cardRef={discrepancyCodeRef}
          fields={[
            {
              label: 'Select account code to record Cash Discrepancy',
              value: p.discrepancyCode || '',
              onChange: (v) => upd('discrepancyCode', v),
              options: discrepancyLabels,
              error: showErrors && !p.discrepancyCode,
            },
          ]}
        />
      </div>

      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} submitFn={stepSubmit} disabled={saving} />
          <button className="btn btn-primary" onClick={tryNext} disabled={saving}>
            {saving ? 'Saving…' : <>Save &amp; Next <Icon.Arrow /></>}
          </button>
        </div>
      </div>
    </>
  );
}

export function StepOthers({ state, set, next, back, skip, accountOptions, submitContacts, createContact, saveAndExit, isLastContentStep }) {
  const stepSubmit = submitContacts;
  const p = state.pettyCash;
  const upd = (k, v) => set({ pettyCash: { ...p, [k]: v } });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [showErrors, setShowErrors] = useState(false);

  const directorContactRef = useRef(null);
  const cashSaleContactRef = useRef(null);
  const discrepancyContactRef = useRef(null);

  const contactLabels = ((accountOptions || {}).contacts || []).map((c) => c.label);

  const missingFields = [
    { key: 'directorContact', empty: !p.directorContact, ref: directorContactRef },
    { key: 'cashSaleContact', empty: !p.cashSaleContact, ref: cashSaleContactRef },
    { key: 'discrepancyContact', empty: !p.discrepancyContact, ref: discrepancyContactRef },
  ];

  const tryNext = async () => {
    if (saving) return;
    const firstMissing = missingFields.find((f) => f.empty);
    if (firstMissing) {
      setShowErrors(true);
      requestAnimationFrame(() => {
        const node = firstMissing.ref.current;
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setShowErrors(false);
    if (typeof submitContacts === 'function') {
      setSaving(true);
      const result = await submitContacts();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: 'left', marginBottom: 22 }}>
        <h2 style={{ fontSize: 30 }}>Contact Setup</h2>
        <p style={{ marginTop: 6 }}>Choose the Xero contacts used for the director&apos;s account, cash sales, and cash discrepancy.</p>
      </div>

      <div className="pc-stack">
        <PCSection
          title="Director&apos;s Contact"
          cardRef={directorContactRef}
          fields={[
            {
              label: 'Select Director or Responsible person',
              value: p.directorContact || '',
              onChange: (v) => upd('directorContact', v),
              options: contactLabels,
              error: showErrors && !p.directorContact,
              onAddNew: createContact,
            },
          ]}
        />

        <PCSection
          title="Cash Sales Contact"
          cardRef={cashSaleContactRef}
          fields={[
            {
              label: 'Select the Customer contact for cash sales',
              value: p.cashSaleContact || '',
              onChange: (v) => upd('cashSaleContact', v),
              options: contactLabels,
              error: showErrors && !p.cashSaleContact,
              onAddNew: createContact,
            },
          ]}
        />

        <PCSection
          title="Discrepancy Contact"
          cardRef={discrepancyContactRef}
          fields={[
            {
              label: 'Select the contact used to record cash discrepancies',
              value: p.discrepancyContact || '',
              onChange: (v) => upd('discrepancyContact', v),
              options: contactLabels,
              error: showErrors && !p.discrepancyContact,
              onAddNew: createContact,
            },
          ]}
        />
      </div>

      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} submitFn={stepSubmit} disabled={saving} />
          <button className="btn btn-primary" onClick={tryNext} disabled={saving}>
            {saving ? 'Saving…' : isLastContentStep ? 'Complete' : <>Save &amp; Next <Icon.Arrow /></>}
          </button>
        </div>
      </div>
    </>
  );
}

// --- Step 7: Bill Settings ---
function BillAccountCodesCard({ codes, value, onChange, labels }) {
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
    onChange({ all: false, selected: { ...sel, [code]: !isOn(code) } });
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
  const filtered = codes.filter((c) => c.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="method-card acc-card open">
      <div className="method-head method-head-static" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
        <div className="method-title">Bill Account Code</div>
        <div className="acc-sub">Only selected account code will appear when adding a bill in Bill.</div>
      </div>
      <div className="method-body" style={{ display: 'block' }}>
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
              <MintCheck checked={isOn(code)} onChange={() => toggle(code)} ariaLabel={code} />
            </li>
          ))}
          {codes.length === 0 && <li className="acc-empty">Connect to Xero to load account codes</li>}
          {codes.length > 0 && filtered.length === 0 && <li className="acc-empty">No matching account code</li>}
        </ul>
      </div>
    </div>
  );
}

export function StepBills({ state, set, next, back, skip, accountOptions, submitBills, saveAndExit, isLastContentStep }) {
  const stepSubmit = submitBills;
  const b = state.bills;
  const upd = (k, v) => set({ bills: { ...b, [k]: v } });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const billCodes = ((accountOptions || {}).bill || []).map((e) => e.code);
  const billLabels = Object.fromEntries(
    ((accountOptions || {}).bill || []).map((e) => [e.code, e.name ? `${e.code} · ${e.name}` : e.code])
  );

  const tryNext = async () => {
    if (saving) return;
    if (typeof submitBills === 'function') {
      setSaving(true);
      const result = await submitBills();
      setSaving(false);
      if (!result?.ok) {
        toast.error(result.error);
        return;
      }
    }
    next();
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: 'left', marginBottom: 18 }}>
        <h2 style={{ fontSize: 30 }}>Bill Settings</h2>
        <p style={{ marginTop: 6 }}>Choose account code for expenses that will incur with supporting documents.</p>
      </div>

      <div className="pc-stack">
        <BillAccountCodesCard
          codes={billCodes}
          labels={billLabels}
          value={b.billCodes || { all: true, selected: {} }}
          onChange={(v) => upd('billCodes', v)}
        />
      </div>

      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} submitFn={stepSubmit} disabled={saving} />
          <button className="btn btn-primary" onClick={tryNext} disabled={saving}>
            {saving ? 'Saving…' : isLastContentStep ? 'Complete' : <>Save &amp; Next <Icon.Arrow /></>}
          </button>
        </div>
      </div>
    </>
  );
}

// --- Step 8: User Invite ---
const ROLES = ['Admin', 'Accountant', 'Shop Manager', 'Cashier'];

// Display label ↔ backend role value (matches Settings' _normalize_role_name).
const roleToValue = (label) => (label || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const roleLabel = (value) => (value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function StepInvite({ state, set, next, back, submitInvite, cancelInvite, saveAndExit }) {
  const list = state.invites.filter((x) => x.email && x.email.includes('@'));
  const [form, setForm] = useState({ first: '', last: '', email: '', role: '' });
  const notify = useToast();
  // Rows whose long name/email is expanded (wrapped) instead of truncated.
  const [expandedRows, setExpandedRows] = useState({});
  const toggleExpanded = (key) => setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  // Confirmation modal nudging the user to invite an accountant — the later
  // steps need expertise. Shown automatically on arrival at the Invite step
  // (right after Save & Next on Select Module) and again on "Skip for now".
  const [confirmSkip, setConfirmSkip] = useState(true);
  const [sending, setSending] = useState(false);
  // Portal the modal to <body> so its fixed overlay can't be clipped to a
  // transformed/overflow ancestor (which left the grey backdrop covering only
  // part of the page on desktop). Guarded for SSR — body isn't there yet.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const setF = (k, v) => setForm({ ...form, [k]: v });
  // Show the "invalid email" hint only once the user has interacted with the
  // field, so a pristine empty form doesn't start out shouting an error.
  const [emailTouched, setEmailTouched] = useState(false);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const emailInvalid = emailTouched && form.email.trim() !== '' && !emailOk;
  // Don't gate the button on email format — let the user click Send and get an
  // explicit toast explaining why, instead of a silently-disabled button.
  const canSend = form.first.trim() && form.last.trim() && form.email.trim() && form.role && !sending;

  const send = async () => {
    if (!canSend) return;
    if (!emailOk) {
      setEmailTouched(true);
      notify.error("Hmm, that doesn't look like an email. Try user@domain.com?");
      return;
    }
    setSending(true);
    const sentEmail = form.email.trim();
    const result = await submitInvite({
      email: sentEmail,
      role: roleToValue(form.role),
      first_name: form.first.trim(),
      last_name: form.last.trim(),
    });
    setSending(false);
    if (!result.ok) {
      notify.error(result.error);
      return;
    }
    // If the backend couldn't actually send the email (Brevo/SMTP failure →
    // email_sent: false), treat the invite as failed: surface an error and do
    // NOT add it to the pending list — the invitee received nothing. The form
    // is left filled so the user can retry without re-typing.
    if (result.emailSent === false) {
      notify.error(`That invite didn't reach ${sentEmail}! Want to try again?`);
      return;
    }
    const inv = result.invitation || {};
    const nextList = [
      ...list,
      { id: inv.id, first: form.first.trim(), last: form.last.trim(), email: inv.email || sentEmail, role: inv.role || roleToValue(form.role) },
    ];
    set({ invites: nextList });
    setForm({ first: '', last: '', email: '', role: '' });
    setEmailTouched(false);
    notify.success(`Invitation sent to ${sentEmail}.`);
  };

  const cancel = () => {
    setForm({ first: '', last: '', email: '', role: '' });
    setEmailTouched(false);
  };
  const removeRow = async (i) => {
    const target = list[i];
    if (target?.id) {
      const result = await cancelInvite(target.id);
      if (!result.ok) {
        notify.error(result.error);
        return;
      }
    }
    set({ invites: list.filter((_, idx) => idx !== i) });
  };

  return (
    <>
      <div className="page-head" style={{ textAlign: 'center', marginBottom: 18 }}>
        <h2 style={{ fontSize: 30 }}>User Invite</h2>
        <p style={{ marginTop: 6 }}>
          Heads up — users can be added or removed any time from <b>Settings → Users</b>.
        </p>
      </div>

      <div className="invite-grid">
        <div className="invite-card">
          <div className="invite-card-head">
            <div className="invite-card-title">Invite User</div>
            <button type="button" className="invite-close" onClick={cancel} aria-label="Clear">
              <Icon.Close />
            </button>
          </div>

          <div className="invite-field">
            <label>
              First Name<span className="req">*</span>
            </label>
            <div className="field">
              <input type="text" placeholder="Enter first name" value={form.first} onChange={(e) => setF('first', e.target.value)} />
            </div>
          </div>
          <div className="invite-field">
            <label>
              Last Name<span className="req">*</span>
            </label>
            <div className="field">
              <input type="text" placeholder="Enter last name" value={form.last} onChange={(e) => setF('last', e.target.value)} />
            </div>
          </div>
          <div className="invite-field">
            <label>
              Email Address<span className="req">*</span>
            </label>
            <div className={'field' + (emailInvalid ? ' field-error' : '')}>
              <input
                type="email"
                placeholder="Enter email address"
                value={form.email}
                onChange={(e) => setF('email', e.target.value)}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={emailInvalid}
              />
            </div>
          </div>
          <div className="invite-field">
            <label>
              Role<span className="req">*</span>
            </label>
            <MintySelect value={form.role} onChange={(v) => setF('role', v)} options={ROLES} placeholder="Select a role" />
          </div>

          <div className="invite-actions">
            <button type="button" className="btn btn-ghost btn-cancel" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!canSend} onClick={send}>
              {sending ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
        </div>

        {list.length > 0 && (
          <div className="invite-list">
            <div className="invite-list-title">Pending invitations · {list.length}</div>
            {list.map((u, i) => {
              const hasName = (u.first || u.last);
              const initials = hasName
                ? `${(u.first[0] || '').toUpperCase()}${(u.last[0] || '').toUpperCase()}`
                : (u.email[0] || '').toUpperCase();
              const rowKey = u.id || u.email || i;
              const expanded = !!expandedRows[rowKey];
              return (
                <div className="invite-row-card" key={rowKey}>
                  <div className="invite-avatar">{initials}</div>
                  <button
                    type="button"
                    className={'invite-meta' + (expanded ? ' is-expanded' : '')}
                    onClick={() => toggleExpanded(rowKey)}
                    title={expanded ? 'Click to collapse' : 'Click to show full address'}
                  >
                    <div className="invite-name">{hasName ? `${u.first} ${u.last}`.trim() : u.email}</div>
                    {hasName && <div className="invite-email">{u.email}</div>}
                  </button>
                  <span className="invite-role">{roleLabel(u.role)}</span>
                  <button type="button" className="icon-x" onClick={() => removeRow(i)} aria-label="Remove">
                    <Icon.Close />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="step-nav">
        <button className="btn btn-ghost" onClick={back}>
          <Icon.ArrowLeft /> Back
        </button>
        <div className="step-actions">
          <SaveExitLink saveAndExit={saveAndExit} />
          <button
            className="btn btn-primary"
            onClick={() => {
              // Both "Continue" (invites added) and "Add later" (no invites)
              // just advance — "Add later" means "keep going", so resume never
              // pins the user back to Invite.
              next();
            }}
          >
            {list.length > 0 ? 'Continue' : 'Add later'} <Icon.Arrow />
          </button>
        </div>
      </div>

      {confirmSkip && mounted && ReactDOM.createPortal(
        <div
          className="skip-modal-overlay"
          role="presentation"
          onClick={() => setConfirmSkip(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            background: 'rgba(15, 23, 27, 0.45)',
          }}
        >
          <div
            className="skip-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skip-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#f1f3f4',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.22)',
              padding: '26px 26px 22px',
              maxWidth: 440,
              width: '100%',
            }}
          >
            <p id="skip-modal-title" className="skip-modal-lead">
              The following setup steps require accounting expertise.
            </p>
            <p className="skip-modal-body">
              Xero recommends you invite your accountant or bookkeeper to assist you with these steps.
            </p>
            <p className="skip-modal-body" style={{ marginBottom: 32 }}>Do you want to invite users now?</p>
            <div
              className="skip-modal-actions"
              style={{ display: 'flex', justifyContent: 'center', gap: 10 }}
            >
              <button type="button" className="btn btn-primary" onClick={() => setConfirmSkip(false)}>
                Ok
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// --- Step 9: All Set ---
export function StepAllSet({ state, set, restart, finishOnboarding }) {
  const [finishing, setFinishing] = useState(false);
  const toast = useToast();

  const onContinue = async () => {
    if (finishing) return;
    if (typeof finishOnboarding !== 'function') return;
    setFinishing(true);
    const result = await finishOnboarding();
    if (!result?.ok) {
      toast.error(result.error);
      setFinishing(false);
    } else if (!result.redirect) {
      setFinishing(false);
    }
  };

  return (
    <>
      <Confetti count={42} />
      <div className="celebrate">
        <div className="check-circle">
          <Icon.CheckBig />
        </div>
        <h2 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>You&apos;re all set!</h2>
        <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: 15 }}>
          <b style={{ color: 'var(--ink)' }}>{state.entity.name || ''}</b> Your Minty Entity is set! You are now good to go.
        </p>
      </div>

      <div className="mascot-video-wrap">
        <img className="mascot-video" src="/all-set.png" alt="Minty mascot" />
      </div>

      <div className="conf-actions" style={{ flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-primary" onClick={onContinue} disabled={finishing}>
          {finishing ? 'Saving…' : <>Go to entity list <Icon.Arrow /></>}
        </button>
      </div>
    </>
  );
}