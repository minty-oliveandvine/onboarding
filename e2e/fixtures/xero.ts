// What the faked Xero "knows": the org name reported back from the OAuth round-trip
// and the account/contact lists the petty cash and payment steps load.
//
// Typed against the wizard's own response types so a change to lib/api.ts that the
// steps depend on breaks this file at compile time rather than silently rendering an
// empty dropdown.
//
// `mapping_defaults` deliberately leaves `discrepancy` out and `contact_defaults` is
// complete. The wizard pre-fills every dropdown it has a default for, so the walk gets
// one field it must fill by hand -- which is what exercises the select and the
// step's required-field error. Everything else pre-filled keeps the walk short.

import type { AccountCodesResponse, BillCodesResponse } from '../../lib/api';

export const FAKE_ORG = 'E2E Fake Org';

/** Ids the walk asserts the wizard sends back on step 6 and 7. */
export const IDS = {
  pettyCashBank: 'bank-petty',
  depositBank: 'bank-deposit',
  director: 'acc-director',
  cashSale: 'acc-cash-sale',
  discrepancy: 'acc-discrepancy',
  directorContact: 'contact-director',
  cashSaleContact: 'contact-cash-sale',
  discrepancyContact: 'contact-discrepancy',
} as const;

export const LABELS = {
  pettyCashBank: 'Petty Cash Bank',
  depositBank: 'Deposit Bank',
  director: '880 · Director Loan',
  cashSale: '200 · Cash Sales',
  discrepancy: '499 · Cash Discrepancy',
  directorContact: 'Director (E2E)',
  cashSaleContact: 'Cash Sales (E2E)',
  discrepancyContact: 'Discrepancy (E2E)',
} as const;

export const accountCodes: AccountCodesResponse = {
  connected: true,
  bank_accounts: [
    { id: IDS.pettyCashBank, label: LABELS.pettyCashBank },
    { id: IDS.depositBank, label: LABELS.depositBank },
  ],
  director_accounts: [{ id: IDS.director, label: LABELS.director }],
  cash_sale_accounts: [{ id: IDS.cashSale, label: LABELS.cashSale }],
  discrepancy_accounts: [{ id: IDS.discrepancy, label: LABELS.discrepancy }],
  expense_codes: [
    { code: '400', name: 'Advertising' },
    { code: '404', name: 'Bank Fees' },
    { code: '420', name: 'Entertainment' },
  ],
  contacts: [
    { id: IDS.directorContact, label: LABELS.directorContact },
    { id: IDS.cashSaleContact, label: LABELS.cashSaleContact },
    { id: IDS.discrepancyContact, label: LABELS.discrepancyContact },
  ],
  mapping_defaults: {
    pettycash: IDS.pettyCashBank,
    deposit: IDS.depositBank,
    director: IDS.director,
    cash_sale: IDS.cashSale,
    // no `discrepancy` -- see the module header
  },
  contact_defaults: {
    director: IDS.directorContact,
    cash_sale: IDS.cashSaleContact,
    discrepancy: IDS.discrepancyContact,
  },
  default_all: true,
  selected_codes: [],
};

export const billCodes: BillCodesResponse = {
  connected: true,
  bill_codes: [
    { code: '300', name: 'Purchases' },
    { code: '310', name: 'Cost of Goods Sold' },
    { code: '469', name: 'Rent' },
  ],
  default_all: true,
  selected_codes: [],
};
