// One conversion from the API's invitation shape to the wizard's own.
//
// The API says `first_name` / `last_name`; the invite cards read `first` / `last`. Before
// this file, the two places that received API rows handled that differently: the cold
// resume wrote the rows in UNCONVERTED (so a resumed wizard showed an email with no name),
// and the step-8 refetch converted them but ignored the API's names in favour of whatever
// had been typed this session -- which after a resume was nothing. One function, used by
// both, is what makes them agree.

import type { Invitation } from './api';
import type { InviteRow } from './types';

/**
 * An API invitation as the wizard holds it.
 *
 * `prior` is the row already in state for the same email, if any. The API's name wins
 * when it has one -- it is what was actually sent -- and the session's typed name is the
 * fallback for rows the backend stored without names.
 */
export function inviteRow(inv: Invitation, prior?: Partial<InviteRow>): InviteRow {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    first: inv.first_name || prior?.first || '',
    last: inv.last_name || prior?.last || '',
  };
}

/** Convert a list, matching each row to any prior row with the same email (case-insensitive). */
export function inviteRows(list: Invitation[], prior: InviteRow[] = []): InviteRow[] {
  const known: Record<string, InviteRow> = {};
  for (const x of prior) if (x.email) known[x.email.toLowerCase()] = x;
  return list.map((inv) => inviteRow(inv, known[(inv.email || '').toLowerCase()]));
}
