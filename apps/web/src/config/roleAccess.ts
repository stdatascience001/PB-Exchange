// Role-based nav visibility, derived from live pbmax1.com screenshots comparing a
// SUPER ADMIN session (full menu) against an ADMIN session (reduced menu). DEVELOPER is
// treated the same as SUPER ADMIN (full access) — consistent with the DEVELOPER/SUPER ADMIN
// pairing already used everywhere on the backend (see requireRoles(...) call sites).
// Any role other than ADMIN is left unrestricted here since no reference screenshots exist
// for them yet — this list must never grow beyond what a screenshot has actually shown.

// Page keys hidden from ADMIN's nav menus and blocked from direct navigation.
export const ADMIN_RESTRICTED_PAGES: string[] = [
  // Master menu (SUPER ADMIN also has Shift, Staff Salary/Assets, Access Block)
  'shifts',
  'staff-assets',
  'access-block',
  // Transactions menu
  'trans-permission',
  // Vouchers menu
  'voucher-audit',
  'duplicate-voucher',
  // Result menu
  'declare',
  'transaction-asc',
  'declare-prediction',
  'declare-trans-asc',
  'declare-jantri',
  'declare-collection',
  // Reports menu
  'settling-report',
  'profit-loss-report',
  'trial-balance-report',
  'cash-report',
  'voucher-list-report',
  // Track Reports menu
  'trans-before-after-declare',
  'pl-before-after-declare',
  'productivity-shift',
  'trans-after-timing',
];

// Top-level nav menus hidden entirely from ADMIN (Admin Reports and Track Reports stay,
// just with fewer items inside — handled via ADMIN_RESTRICTED_PAGES above).
export const ADMIN_RESTRICTED_TOP_MENUS: string[] = ['utilities', 'payroll'];

export function isAdminRole(roleName?: string | null): boolean {
  return roleName === 'ADMIN';
}

export function isPageRestrictedForAdmin(pageKey: string): boolean {
  return ADMIN_RESTRICTED_PAGES.includes(pageKey);
}

// MANAGER's live nav is almost entirely gone — only Dashboard and a 3-item Reports menu
// remain, so this is expressed as an allow-list rather than a restrict-list like ADMIN's
// above. The Reports order below is the exact order the live screenshot showed (not the
// standard Daily/All-Shift/... order), so it's kept as an explicit ordered list rather than
// a filter over the full Reports item array.
export const MANAGER_ALLOWED_TOP_MENUS: string[] = ['dashboard', 'reports'];

export const MANAGER_REPORTS_ITEMS: Array<{ label: string; page: string }> = [
  { label: 'OutStanding Report', page: 'outstanding-report' },
  { label: 'Daily Report', page: 'daily-report' },
  { label: 'All Shift Report', page: 'all-shift-report' },
];

export const MANAGER_ALLOWED_PAGES: string[] = ['dashboard', ...MANAGER_REPORTS_ITEMS.map((i) => i.page)];

export function isManagerRole(roleName?: string | null): boolean {
  return roleName === 'MANAGER';
}

export function isPageAllowedForManager(pageKey: string): boolean {
  return MANAGER_ALLOWED_PAGES.includes(pageKey);
}

// DATA ENTRY OPERATOR's live nav: only Dashboard + a Transactions menu.
export const DATA_ENTRY_OPERATOR_ALLOWED_TOP_MENUS: string[] = ['dashboard', 'transactions'];

// The Transactions menu holds exactly two items — "Transactions" and "Declare Transactions"
// — as the live reference's open dropdown shows for this role. (An earlier reading cut this
// down to a single "Add Entry" item; the dropdown screenshot rules that out.)
export const DATA_ENTRY_OPERATOR_TRANSACTIONS_PAGES: string[] = ['transaction-list', 'declare-transactions'];

// 'transaction-edit' is the page Live Transactions' Edit button opens (/transaction_edit/:shiftId/:txId);
// without it the role guard in App.tsx bounced that tab straight to the dashboard.
export const DATA_ENTRY_OPERATOR_ALLOWED_PAGES: string[] = ['dashboard', 'transaction-add', 'transaction-edit', ...DATA_ENTRY_OPERATOR_TRANSACTIONS_PAGES];

// Roles that only ever see their own entered data — the frontend mirror of the API's
// common/roles.ts. Used to drop the staff/status filters a DATA ENTRY OPERATOR's Live
// Transactions bar doesn't have on the live reference (SUPER ADMIN's does).
export function isOwnDataOnlyRole(roleName?: string | null): boolean {
  return isDataEntryOperatorRole(roleName);
}

export function isDataEntryOperatorRole(roleName?: string | null): boolean {
  return roleName === 'DATA ENTRY OPERATOR';
}

export function isPageAllowedForDataEntryOperator(pageKey: string): boolean {
  return DATA_ENTRY_OPERATOR_ALLOWED_PAGES.includes(pageKey);
}

// TALLY OPERATOR's live nav: Dashboard + a 3-item Transactions menu + a 1-item Reports menu.
export const TALLY_OPERATOR_ALLOWED_TOP_MENUS: string[] = ['dashboard', 'transactions', 'reports'];

export const TALLY_OPERATOR_TRANSACTIONS_PAGES: string[] = ['transaction-list', 'declare-transactions', 'declare-trans-audit'];

export const TALLY_OPERATOR_REPORTS_PAGES: string[] = ['daily-report'];

export const TALLY_OPERATOR_ALLOWED_PAGES: string[] = [
  'dashboard',
  ...TALLY_OPERATOR_TRANSACTIONS_PAGES,
  ...TALLY_OPERATOR_REPORTS_PAGES,
];

export function isTallyOperatorRole(roleName?: string | null): boolean {
  return roleName === 'TALLY OPERATOR';
}

export function isPageAllowedForTallyOperator(pageKey: string): boolean {
  return TALLY_OPERATOR_ALLOWED_PAGES.includes(pageKey);
}

// Roles that get the reduced dashboard (Staff Working panel container stays but always
// empty, no Declare Needed / Un-Verified Shifts) and the "Last Day X%" top-bar badge —
// evidenced for MANAGER, DATA ENTRY OPERATOR and TALLY OPERATOR so far; kept as an explicit
// list rather than "everyone except SUPER ADMIN/ADMIN" since no other role has a reference
// screenshot yet.
export function showsReducedDashboard(roleName?: string | null): boolean {
  return isManagerRole(roleName) || isDataEntryOperatorRole(roleName) || isTallyOperatorRole(roleName);
}
