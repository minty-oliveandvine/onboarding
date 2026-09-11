// The two spellings of a module, and the map between them.
//
// The backend speaks CODES (`PETTY_CASH`, `BILL`) — they are `entity_function.function_code`
// values and appear in every `/api/onboarding/*` payload. The frontend speaks IDS
// (`pettyCash`, `bills`) because that is what the module-picker state and the display-step
// grouping key on.
//
// This lived in three places: two byte-identical code→id maps under different names in two
// components, plus the inverse declared INSIDE a component body, so it was rebuilt on every
// render. One of them even carried a comment referring to another 1,100 lines away.
//
// Derive the inverse rather than writing it twice — that is what guarantees they agree.

/** Backend `function_code` -> frontend module id. */
export const MODULE_ID_BY_CODE = Object.freeze({ PETTY_CASH: 'pettyCash', BILL: 'bills' });

/** Frontend module id -> backend `function_code`. Derived, never hand-written. */
export const MODULE_CODE_BY_ID = Object.freeze(
  Object.fromEntries(Object.entries(MODULE_ID_BY_CODE).map(([code, id]) => [id, code])),
);
