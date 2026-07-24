'use client';

// Canonical flash toast — ONE source of truth for user-facing messages.
//
// Ported from the Flask/Jinja `flash_messages.html` partial so both repos show
// the same thing: a fixed pill (5px border, fully rounded) that slides in from
// off-screen top-right and auto-dismisses after 4 seconds. Four tones, each
// swapping border / background / title / message colour and the icon.
//
// The interface is `toast.error(message)` (and .success/.warning/.info). One
// call per message you want shown. In the Flask app the equivalent channel was
// draining `get_flashed_messages()` on page load; here it's the `{ ok, error }`
// result objects that OnboardingApp's submit functions already return.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Each tone swaps four colours plus the icon. Values match the Flask template.
const TONES = {
  success: { border: '#a9d7cb', bg: '#f1fffc', title: '#017155', sub: '#92c6b9', label: 'Success' },
  error: { border: '#ffcccc', bg: '#fff1f1', title: '#F03D3D', sub: '#f57e7e', label: 'Error' },
  warning: { border: '#fee0aa', bg: '#fffaf1', title: '#DA8700', sub: '#e8b765', label: 'Warning' },
  info: { border: '#a9d3ff', bg: '#f1f8ff', title: '#006FE6', sub: '#5ba2ee', label: 'Information' },
};

const DISMISS_MS = 4000;

// The four PNGs in the Flask app are inline SVG here: no assets to keep in sync,
// no broken-image state, and the swap is synchronous — which is why this port
// doesn't need the original's `icon.decode()` guard. That guard existed because
// swapping an <img src> lets the *previous* tone's icon paint for one frame
// (a green checkmark flashing on an error toast). React re-renders the whole
// node, so there is no stale frame to guard against.
function ToastIcon({ tone }) {
  const c = TONES[tone].title;
  const common = {
    width: 36,
    height: 44,
    viewBox: '0 0 36 44',
    fill: 'none',
    'aria-hidden': 'true',
    className: 'shrink-0',
  };
  const ring = <circle cx="18" cy="22" r="11" fill={c} />;
  if (tone === 'success') {
    return (
      <svg {...common}>
        {ring}
        <path d="M13 22.2l3.4 3.4L23 18.8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === 'error') {
    return (
      <svg {...common}>
        {ring}
        <path d="M14.2 18.2l7.6 7.6M21.8 18.2l-7.6 7.6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === 'warning') {
    return (
      <svg {...common}>
        <path d="M16.3 12.6a2 2 0 013.4 0l9.1 15.8a2 2 0 01-1.7 3H8.9a2 2 0 01-1.7-3l9.1-15.8z" fill={c} />
        <path d="M18 18.4v5.2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="18" cy="27.4" r="1.4" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      {ring}
      <path d="M18 21v5.4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="18" cy="17.4" r="1.4" fill="#fff" />
    </svg>
  );
}

const ToastContext = createContext(null);

// Rendered once, at the app root. Holds the single visible toast; a new call
// replaces whatever is showing rather than stacking.
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { id, message, tone }
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => setMounted(true), []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setVisible(false);
  }, []);

  const show = useCallback((message, tone = 'success') => {
    if (!message) return;
    // Auto-dismiss is scoped to THIS invocation. The Flask version's comment is
    // worth keeping in mind: an earlier iteration swept every `.toast` in the
    // DOM on a timer, which killed unrelated client-side validation toasts.
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ id: Date.now(), message, tone: TONES[tone] ? tone : 'success' });
    setVisible(true);
    timerRef.current = setTimeout(() => setVisible(false), DISMISS_MS);
  }, []);

  useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);

  const api = useRef(null);
  if (!api.current) {
    api.current = {
      show,
      hide,
      success: (m) => show(m || 'Success', 'success'),
      error: (m) => show(m || 'Error', 'error'),
      warning: (m) => show(m || 'Warning', 'warning'),
      info: (m) => show(m || 'Information', 'info'),
    };
  }

  const tone = TONES[toast?.tone || 'success'];

  const node = (
    <div
      className="pointer-events-none fixed right-4 z-[400] transition-transform duration-500 ease-in-out"
      style={{
        top: 24,
        // Parked fully off-screen (plus the 1.5rem gutter) until shown.
        transform: visible ? 'translateX(0)' : 'translateX(calc(100% + 1.5rem))',
      }}
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="pointer-events-auto border-[5px] rounded-full flex justify-between items-center gap-3 w-[420px] max-w-[calc(100vw-2rem)] min-h-[64px] py-[6px] pl-[8px] pr-[20px] relative"
        style={{ borderColor: tone.border, backgroundColor: tone.bg }}
        role={toast?.tone === 'error' ? 'alert' : 'status'}
      >
        <ToastIcon tone={toast?.tone || 'success'} />
        <div className="flex-1 min-w-0 text-[14px] flex flex-col items-start justify-center leading-snug">
          <p className="font-[500] whitespace-nowrap" style={{ color: tone.title }}>
            {tone.label}
          </p>
          <p className="font-[400] break-words w-full" style={{ color: tone.sub }}>
            {toast?.message || ''}
          </p>
        </div>
        <button type="button" className="shrink-0 cursor-pointer" onClick={hide} aria-label="Dismiss">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
            className="w-[14px] h-[14px] text-gray-500"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      {mounted && createPortal(node, document.body)}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}