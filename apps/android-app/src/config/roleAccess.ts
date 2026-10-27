// Role-based page visibility — the same rules as the website (apps/web/src/config/roleAccess.ts
// + the Navbar menu filter + App.tsx's page guard), so every role sees in the app exactly the
// pages its website menu shows. Keep the lists below in step with the website's file.
//   DEVELOPER / SUPER ADMIN / any other role: everything
//   ADMIN: everything except ADMIN_RESTRICTED_PAGES and the Utilities / Payroll menus
//   MANAGER, DATA ENTRY OPERATOR, TALLY OPERATOR: only their allow-lists
// The API keeps enforcing its own role checks; this only decides what the app shows.

export const ADMIN_RESTRICTED_PAGES: string[] = [
  'shifts', 'staff-assets', 'access-block',
  'trans-permission',
  'voucher-audit', 'duplicate-voucher',
  'declare', 'transaction-asc', 'declare-prediction', 'declare-trans-asc', 'declare-jantri', 'declare-collection',
  'settling-report', 'profit-loss-report', 'trial-balance-report', 'cash-report', 'voucher-list-report',
  'trans-before-after-declare', 'pl-before-after-declare', 'productivity-shift', 'trans-after-timing',
];
export const ADMIN_RESTRICTED_TOP_MENUS: string[] = ['utilities', 'payroll'];

export const MANAGER_ALLOWED_PAGES: string[] = ['dashboard', 'outstanding-report', 'daily-report', 'all-shift-report'];
export const DATA_ENTRY_OPERATOR_ALLOWED_PAGES: string[] = ['dashboard', 'transaction-add', 'transaction-edit', 'transaction-list', 'declare-transactions'];
export const TALLY_OPERATOR_ALLOWED_PAGES: string[] = ['dashboard', 'transaction-list', 'declare-transactions', 'declare-trans-audit', 'daily-report'];

// Website menu each page sits in (for ADMIN's hidden menus)
const PAGE_MENU: Record<string, string> = {
  'message-manage': 'utilities', 'flash-message-manage': 'utilities',
  'staff-attendance': 'payroll', 'payroll-attendance-manage': 'payroll', 'salary-register': 'payroll', 'leave-manage': 'payroll',
};

const norm = (role?: string | null) => String(role || '').toUpperCase().replace(/_/g, ' ').trim();

// Can this role open this website page? (menu filter + direct-navigation guard)
export function isPageVisible(role: string | null | undefined, page: string): boolean {
  switch (norm(role)) {
    case 'MANAGER': return MANAGER_ALLOWED_PAGES.includes(page);
    case 'DATA ENTRY OPERATOR': return DATA_ENTRY_OPERATOR_ALLOWED_PAGES.includes(page);
    case 'TALLY OPERATOR': return TALLY_OPERATOR_ALLOWED_PAGES.includes(page);
    case 'ADMIN': return !ADMIN_RESTRICTED_PAGES.includes(page) && !ADMIN_RESTRICTED_TOP_MENUS.includes(PAGE_MENU[page] || '');
    default: return true;
  }
}

// Roles whose website dashboard has an always-empty Staff Working panel
export function showsReducedDashboard(role?: string | null): boolean {
  return ['MANAGER', 'DATA ENTRY OPERATOR', 'TALLY OPERATOR'].includes(norm(role));
}

// App screen → the website page(s) it stands for (open when the role can open any of them).
// Screens not listed (Dashboard, Chat / messages, Profile) are open to every role.
const ROUTE_PAGES: Record<string, string[]> = {
  Ledgers: ['ledgers'], AddLedger: ['ledgers'], UpdateLedger: ['ledgers'],
  AgentGroups: ['agents'], UpdateAgentGroup: ['agents'],
  VoucherAudit: ['voucher-audit'],
  Staffs: ['staff'], AddStaff: ['staff'], UpdateStaff: ['staff'],
  Shifts: ['shifts'], AddShift: ['shifts'], UpdateShift: ['shifts'],
  Transactions: ['transaction-list', 'declare-transactions'],
  ShiftTransactions: ['transaction-list', 'declare-transactions'],
  Jantri: ['jantri', 'transaction-list', 'declare-transactions'],
  Prediction: ['live-prediction'],
  ResultReport: ['live-prediction'],
  DailyReport: ['daily-report'],
  AllShiftReport: ['all-shift-report'],
  ProfitLoss: ['profit-loss-report'], ProfitLossShift: ['profit-loss-report'],
  AdminCash: ['admin-cash'],
  Outstanding: ['outstanding-report'],
  AgentOutstanding: ['outstanding-agent-group'],
  VoucherReport: ['voucher-list-report'],
  CashAgentReport: ['cash-report'], CashReportDetails: ['cash-report'],
  PaidVapsi: ['vapsi-report'],
  PaidHp: ['hawapatti-rpt'],
  SalaryRegister: ['salary-register'],
  LimitBalance: ['limit-balance-report'],
  Productivity: ['productivity-report'],
};

const VOUCHER_PAGES: Record<string, string> = { JOURNAL: 'journal-voucher', LIMIT: 'limit-voucher' };

export function canOpenRoute(role: string | null | undefined, route: string, params?: { type?: string } | object): boolean {
  if (route === 'StaffWorking') return !showsReducedDashboard(role);
  if (route === 'Vouchers') {
    const type = (params as { type?: string } | undefined)?.type;
    const pages = type && VOUCHER_PAGES[type] ? [VOUCHER_PAGES[type]] : Object.values(VOUCHER_PAGES);
    return pages.some((p) => isPageVisible(role, p));
  }
  const pages = ROUTE_PAGES[route];
  return !pages || pages.some((p) => isPageVisible(role, p));
}

// Master / Report tab contents (also decide whether the tab itself shows)
export const MASTER_ROUTES: Array<{ route: string; params?: object }> = [
  { route: 'Ledgers' }, { route: 'AgentGroups' }, { route: 'Vouchers', params: { type: 'JOURNAL' } },
  { route: 'Vouchers', params: { type: 'LIMIT' } }, { route: 'VoucherAudit' }, { route: 'Staffs' }, { route: 'Shifts' },
];
export const REPORT_ROUTES: string[] = [
  'Prediction', 'DailyReport', 'AllShiftReport', 'ProfitLoss', 'AdminCash', 'Outstanding', 'AgentOutstanding',
  'VoucherReport', 'CashAgentReport', 'PaidVapsi', 'SalaryRegister', 'PaidHp', 'LimitBalance', 'Productivity',
  'ResultReport', 'StaffWorking',
];
export const hasMasterTab = (role?: string | null) => MASTER_ROUTES.some((r) => canOpenRoute(role, r.route, r.params));
export const hasReportTab = (role?: string | null) => REPORT_ROUTES.some((r) => canOpenRoute(role, r));
