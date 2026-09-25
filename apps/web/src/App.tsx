import React, { useState, useEffect, useCallback } from 'react';
import { UserSession, ShiftDto } from '@pb/types';
import { apiRequest } from './api/client.js';
import { Navbar } from './components/Navbar.js';
import { RoleMessageNotice } from './components/RoleMessageNotice.js';
import { isAdminRole, isPageRestrictedForAdmin, isManagerRole, isPageAllowedForManager, isDataEntryOperatorRole, isPageAllowedForDataEntryOperator, isTallyOperatorRole, isPageAllowedForTallyOperator } from './config/roleAccess.js';
import { Sidebar } from './components/Sidebar.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { AddTransactionPage } from './pages/AddTransactionPage.js';
import { TransactionListPage } from './pages/TransactionListPage.js';
import { JantriPage } from './pages/JantriPage.js';
import { DeclarePage } from './pages/DeclarePage.js';
import { DuplicatePage } from './pages/DuplicatePage.js';
import { AuditPage } from './pages/AuditPage.js';
import { ShiftManagePage } from './pages/ShiftManagePage.js';
import { LedgersPage } from './pages/LedgersPage.js';
import { AccessBlockPage } from './pages/AccessBlockPage.js';
import { StaffPage } from './pages/StaffPage.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { StaffAssetsPage } from './pages/StaffAssetsPage.js';
import { VouchersPage } from './pages/VouchersPage.js';
import { JournalVoucherPage } from './pages/JournalVoucherPage.js';
import { LimitVoucherPage } from './pages/LimitVoucherPage.js';
import { KistVoucherPage } from './pages/KistVoucherPage.js';
import { VapsiVoucherPage } from './pages/VapsiVoucherPage.js';
import { HawaPattiVoucherPage } from './pages/HawaPattiVoucherPage.js';
import { VoucherAuditPage } from './pages/VoucherAuditPage.js';
import { DuplicateVoucherPage } from './pages/DuplicateVoucherPage.js';
import { DeclareTransactionListPage } from './pages/DeclareTransactionListPage.js';
import { DuplicateTransPage } from './pages/DuplicateTransPage.js';
import { TransactionAuditPage } from './pages/TransactionAuditPage.js';
import { DeclareTransPermissionPage } from './pages/DeclareTransPermissionPage.js';
import { DeclareJantriPage } from './pages/DeclareJantriPage.js';
import { CollectionPage } from './pages/CollectionPage.js';
import { DeclareCollectionPage } from './pages/DeclareCollectionPage.js';
import { LivePredictionPage } from './pages/LivePredictionPage.js';
import { DeclarePredictionPage } from './pages/DeclarePredictionPage.js';
import { TransactionAscPage } from './pages/TransactionAscPage.js';
import { DeclareTransAscPage } from './pages/DeclareTransAscPage.js';
import { CompanyCalculationPage } from './pages/CompanyCalculationPage.js';
import { DailyReportPage } from './pages/DailyReportPage.js';
import { AllShiftReportPage } from './pages/AllShiftReportPage.js';
import { SettlingReportPage } from './pages/SettlingReportPage.js';
import { TpcReportPage } from './pages/TpcReportPage.js';
import { ProfitLossReportPage } from './pages/ProfitLossReportPage.js';
import { LimitBalanceReportPage } from './pages/LimitBalanceReportPage.js';
import { AdminCashPage } from './pages/AdminCashPage.js';
import { TrialBalanceReportPage } from './pages/TrialBalanceReportPage.js';
import { OutstandingReportPage } from './pages/OutstandingReportPage.js';
import { HawaPattiRptPage } from './pages/HawaPattiRptPage.js';
import { VapsiReportPage } from './pages/VapsiReportPage.js';
import { CashReportPage } from './pages/CashReportPage.js';
import { VoucherListPage as VoucherListReportPage } from './pages/VoucherListPage.js';
import { SettlementPage } from './pages/SettlementPage.js';
import { SettlementAgentPage } from './pages/SettlementAgentPage.js';
import { HvsProcessPage } from './pages/HvsProcessPage.js';
import { OutstandingAgentGroupPage } from './pages/OutstandingAgentGroupPage.js';
import { ProductivityReportPage } from './pages/ProductivityReportPage.js';
import { ProductivityShiftPage } from './pages/ProductivityShiftPage.js';
import { ProductivityAuditPage } from './pages/ProductivityAuditPage.js';
import { TransBeforeAfterDeclarePage } from './pages/TransBeforeAfterDeclarePage.js';
import { PlBeforeAfterDeclarePage } from './pages/PlBeforeAfterDeclarePage.js';
import { TransAfterTimingPage } from './pages/TransAfterTimingPage.js';
import { MessageManagePage } from './pages/MessageManagePage.js';
import { FlashMessageManagePage } from './pages/FlashMessageManagePage.js';
import { StaffAttendancePage } from './pages/StaffAttendancePage.js';
import { PayrollAttendancePage } from './pages/PayrollAttendancePage.js';
import { SalaryRegisterPage } from './pages/SalaryRegisterPage.js';
import { LeaveManagePage } from './pages/LeaveManagePage.js';

const PATH_TO_PAGE: Record<string, string> = {
  '': 'dashboard',
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/shifts': 'shifts',
  '/shift': 'shifts',
  '/ledgers': 'ledgers',
  '/ledger': 'ledgers',
  '/staff': 'staff',
  '/staffs': 'staff',
  '/agents': 'agents',
  '/agent': 'agents',
  '/staff-assets': 'staff-assets',
  '/staff_assets': 'staff-assets',
  '/payroll_salary_assets': 'staff-assets',
  '/payroll-salary-assets': 'staff-assets',

  '/access-block': 'access-block',
  '/access_block': 'access-block',
  '/access_block_manage': 'access-block',
  '/access-block-manage': 'access-block',
  '/add-transaction': 'add-transaction',
  '/add_slip': 'add-transaction',
  '/transaction_add': 'transaction-add',
  '/transaction-add': 'transaction-add',
  '/transaction-list': 'transaction-list',
  '/transaction_list': 'transaction-list',
  '/transactions': 'transaction-list',
  '/declare_transaction_list': 'declare-transactions',
  '/declare-transaction-list': 'declare-transactions',
  '/declare-transactions': 'declare-transactions',
  '/rpt_trans_duplicate': 'duplicate-trans',
  '/rpt-trans-duplicate': 'duplicate-trans',
  '/duplicate-trans': 'duplicate-trans',
  '/duplicate_trans': 'duplicate-trans',
  '/transaction_audit': 'trans-audit',
  '/transaction-audit': 'trans-audit',
  '/trans_audit': 'trans-audit',
  '/trans-audit': 'trans-audit',
  '/declare_transaction_audit': 'declare-trans-audit',
  '/declare-transaction-audit': 'declare-trans-audit',
  '/declare_trans_audit': 'declare-trans-audit',
  '/declare-trans-audit': 'declare-trans-audit',
  '/trans_permission': 'trans-permission',
  '/trans-permission': 'trans-permission',
  '/declare_trans_permission': 'trans-permission',
  '/declare-trans-permission': 'trans-permission',
  '/jantri': 'jantri',
  '/declare': 'declare',
  '/duplicates': 'duplicates',
  '/audit': 'audit',
  '/vouchers': 'vouchers',
  '/vouchers_expenses': 'vouchers',
  '/journal_vouchers': 'journal-voucher',
  '/limit_vouchers': 'limit-voucher',
  '/kist_vouchers': 'kist-voucher',
  '/vapsi_vouchers': 'vapsi-voucher',
  '/hawa_patti_vouchers': 'hawa-patti-voucher',
  '/voucher_audit': 'voucher-audit',
  '/rpt_voucher_duplicate': 'duplicate-voucher',
  '/jantri_declare': 'declare-jantri',
  '/collection': 'collection',
  '/collection_declare': 'declare-collection',
  '/prediction': 'live-prediction',
  '/prediction_declare': 'declare-prediction',
  '/rpt_trans_asc': 'transaction-asc',
  '/rpt_trans_asc_declare': 'declare-trans-asc',
  '/rpt_comp_calculation': 'company-calculation',
  '/rpt_daily': 'daily-report',
  '/rpt_all_shift': 'all-shift-report',
  '/rpt_settling': 'settling-report',
  '/rpt_tpc': 'tpc-report',
  '/rpt_profit_loss': 'profit-loss-report',
  '/rpt_limit_balance': 'limit-balance-report',
  '/rpt_admin_cash': 'admin-cash',
  '/rpt_trial_balance': 'trial-balance-report',
  '/rpt_outstanding': 'outstanding-report',
  '/rpt_agent_outstanding': 'outstanding-report',
  '/rpt_hawapatti': 'hawapatti-rpt',
  '/rpt_vapsi': 'vapsi-report',
  '/rpt_cash': 'cash-report',
  '/rpt_voucher_list': 'voucher-list-report',
  '/rpt_settlement': 'settlement',
  '/process_hvs': 'hvs-process',
  '/rpt_settlement_agent_group': 'settlement-agent-group',
  '/rpt_agent_group_outstanding': 'outstanding-agent-group',
  '/rpt_productivity': 'productivity-report',
  '/trans_before_after_declare': 'trans-before-after-declare',
  '/pl_before_after_declare': 'pl-before-after-declare',
  '/rpt_productivity_trans_shiftwise': 'productivity-shift',
  '/rpt_productivity_trans_audit': 'productivity-audit',
  '/rpt_trans_after_timing': 'trans-after-timing',
  '/msg_manage': 'message-manage',
  '/flash_msg_manage': 'flash-message-manage',
  '/rpt_staff_attendance': 'staff-attendance',
  '/payroll_attendance': 'payroll-attendance-manage',
  '/payroll_salary_register': 'salary-register',
  '/payroll_leave': 'leave-manage',
};

const PAGE_TO_PATH: Record<string, string> = {
  'dashboard': '/dashboard',
  'shifts': '/shifts',
  'ledgers': '/ledgers',
  'staff': '/staffs',
  'agents': '/agents',
  'staff-assets': '/staff-assets',
  'access-block': '/access-block',
  'add-transaction': '/add-transaction',
  'transaction-add': '/transaction_add',
  'transaction-list': '/transaction_list',
  'declare-transactions': '/declare_transaction_list',
  'trans-permission': '/trans_permission',
  'duplicate-trans': '/rpt_trans_duplicate',
  'trans-audit': '/transaction_audit',
  'declare-trans-audit': '/declare_transaction_audit',
  'jantri': '/jantri',
  'declare': '/declare',
  'duplicates': '/duplicates',
  'audit': '/audit',
  'vouchers': '/vouchers',
  'journal-voucher': '/journal_vouchers',
  'limit-voucher': '/limit_vouchers',
  'kist-voucher': '/kist_vouchers',
  'vapsi-voucher': '/vapsi_vouchers',
  'hawa-patti-voucher': '/hawa_patti_vouchers',
  'voucher-audit': '/voucher_audit',
  'duplicate-voucher': '/rpt_voucher_duplicate',
  'declare-jantri': '/jantri_declare',
  'collection': '/collection',
  'declare-collection': '/collection_declare',
  'live-prediction': '/prediction',
  'declare-prediction': '/prediction_declare',
  'transaction-asc': '/rpt_trans_asc',
  'declare-trans-asc': '/rpt_trans_asc_declare',
  'company-calculation': '/rpt_comp_calculation',
  'daily-report': '/rpt_daily',
  'all-shift-report': '/rpt_all_shift',
  'settling-report': '/rpt_settling',
  'tpc-report': '/rpt_tpc',
  'profit-loss-report': '/rpt_profit_loss',
  'limit-balance-report': '/rpt_limit_balance',
  'admin-cash': '/rpt_admin_cash',
  'trial-balance-report': '/rpt_trial_balance',
  'outstanding-report': '/rpt_agent_outstanding',
  'hawapatti-rpt': '/rpt_hawapatti',
  'vapsi-report': '/rpt_vapsi',
  'cash-report': '/rpt_cash',
  'voucher-list-report': '/rpt_voucher_list',
  'settlement': '/rpt_settlement',
  'hvs-process': '/process_hvs',
  'settlement-agent-group': '/rpt_settlement_agent_group',
  'outstanding-agent-group': '/rpt_agent_group_outstanding',
  'productivity-report': '/rpt_productivity',
  'trans-before-after-declare': '/trans_before_after_declare',
  'pl-before-after-declare': '/pl_before_after_declare',
  'productivity-shift': '/rpt_productivity_trans_shiftwise',
  'productivity-audit': '/rpt_productivity_trans_audit',
  'trans-after-timing': '/rpt_trans_after_timing',
  'message-manage': '/msg_manage',
  'flash-message-manage': '/flash_msg_manage',
  'staff-attendance': '/rpt_staff_attendance',
  'payroll-attendance-manage': '/payroll_attendance',
  'salary-register': '/payroll_salary_register',
  'leave-manage': '/payroll_leave',
};

export interface RouteInfo {
  page: string;
  param?: string;
  param2?: string;
}

export const getRouteInfo = (): RouteInfo => {
  if (typeof window === 'undefined') return { page: 'dashboard' };
  const pathname = window.location.pathname.toLowerCase().replace(/\/$/, '');

  // Match /transaction_edit/:shiftId/:txId or /transaction-edit/:shiftId/:txId — the "Edit"
  // action from Transaction List opens the same slip-entry UI as Add, pre-loaded for editing.
  const txEditMatch = pathname.match(/^\/transaction[-_]edit\/([^\/]+)\/([^\/]+)$/);
  if (txEditMatch) {
    return { page: 'transaction-edit', param: txEditMatch[1], param2: txEditMatch[2] };
  }

  // Match /transaction_add/:id or /transaction-add/:id
  const txAddMatch = pathname.match(/^\/transaction[-_]add(?:\/([^\/]+))?$/);
  if (txAddMatch) {
    return { page: 'transaction-add', param: txAddMatch[1] };
  }

  return { page: PATH_TO_PAGE[pathname] || 'dashboard' };
};

const getPageFromPath = (): string => {
  return getRouteInfo().page;
};

export const App: React.FC = () => {
  const [user, setUser] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem('pb_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [routeInfo, setRouteInfo] = useState<RouteInfo>(getRouteInfo);
  const currentPage = routeInfo.page;
  const [shifts, setShifts] = useState<ShiftDto[]>([]);
  const [activeShift, setActiveShift] = useState<ShiftDto | null>(null);

  const navigateTo = useCallback((page: string, param?: string) => {
    setRouteInfo({ page, param });
    let targetPath = PAGE_TO_PATH[page] || '/dashboard';
    if (page === 'transaction-add') {
      targetPath = param ? `/transaction_add/${param}` : '/transaction_add';
    }
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ page, param }, '', targetPath);
    }
  }, []);

  // Blocks direct navigation (URL bar, back/forward, leftover state) to a page ADMIN's nav
  // menu doesn't expose — same restricted-page list the Navbar filters its dropdowns with,
  // so menu visibility and actual access always agree.
  useEffect(() => {
    if (!user) return;
    if (isAdminRole(user.roleName) && isPageRestrictedForAdmin(currentPage)) {
      navigateTo('dashboard');
    } else if (isManagerRole(user.roleName) && !isPageAllowedForManager(currentPage)) {
      navigateTo('dashboard');
    } else if (isDataEntryOperatorRole(user.roleName) && !isPageAllowedForDataEntryOperator(currentPage)) {
      navigateTo('dashboard');
    } else if (isTallyOperatorRole(user.roleName) && !isPageAllowedForTallyOperator(currentPage)) {
      navigateTo('dashboard');
    }
  }, [user, currentPage, navigateTo]);

  // Listen for browser Back / Forward buttons & sync initial URL
  useEffect(() => {
    const handlePopState = () => {
      const info = getRouteInfo();
      setRouteInfo(info);
    };

    window.addEventListener('popstate', handlePopState);

    const currentPath = window.location.pathname;
    const initialRoute = getRouteInfo();
    let targetPath = PAGE_TO_PATH[initialRoute.page] || '/dashboard';
    if (initialRoute.page === 'transaction-add') {
      targetPath = initialRoute.param ? `/transaction_add/${initialRoute.param}` : '/transaction_add';
    }
    if (currentPath === '' || currentPath === '/') {
      window.history.replaceState({ page: initialRoute.page, param: initialRoute.param }, '', targetPath);
    }

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const fetchShifts = async () => {
    try {
      const res = await apiRequest<ShiftDto[]>('/shifts');
      setShifts(res.data);
      if (!activeShift && res.data.length > 0) {
        setActiveShift(res.data[0]);
      } else if (activeShift) {
        const updated = res.data.find(s => s.id === activeShift.id);
        if (updated) setActiveShift(updated);
      }
    } catch (err) {
      console.warn('Failed to load shifts:', err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchShifts();
      const interval = setInterval(fetchShifts, 30000); // 30s poll

      // Send live staff heartbeat to maintain working status
      const sendHeartbeat = () => {
        apiRequest('/staff/heartbeat', { method: 'POST' }).catch(() => {});
      };
      sendHeartbeat();
      const heartbeatInterval = setInterval(sendHeartbeat, 60000); // 60s heartbeat

      return () => {
        clearInterval(interval);
        clearInterval(heartbeatInterval);
      };
    }
  }, [user]);

  // An SSE-based real-time channel was tried here (Redis Pub/Sub -> EventSource), but was
  // reverted along with the same addition on the Dashboard: EventSource holds a persistent
  // connection, and Chrome caps concurrent connections per origin at 6 — shared across every
  // open tab, not per tab. With several "PB Exchange" tabs open at once (common in this app's
  // own multi-window workflows), the extra persistent connections exhausted that shared
  // budget and started silently queueing regular fetch() calls (including the polls above),
  // breaking data on refresh. The backend Pub/Sub + /shifts/stream endpoint are left in
  // place, unused, for a future retry behind a single shared connection instead of
  // one-per-page.

  // Global Keyboard Shortcuts (F1 -> Add Slip)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        navigateTo('add-transaction');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateTo]);

  const handleLogout = () => {
    localStorage.removeItem('pb_token');
    localStorage.removeItem('pb_user');
    setUser(null);
    navigateTo('dashboard');
  };

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(u) => {
          setUser(u);
          const targetPage = getPageFromPath();
          navigateTo(targetPage);
        }}
      />
    );
  }

  const isMasterOrDashboard = [
    'dashboard',
    'shifts',
    'ledgers',
    'staff',
    'agents',
    'staff-assets',
    'access-block',
    'transaction-list',
    'declare-transactions',
    'trans-permission',
    'duplicate-trans',
    'trans-audit',
    'declare-trans-audit',
    'vouchers',
    'journal-voucher',
    'limit-voucher',
    'kist-voucher',
    'vapsi-voucher',
    'hawa-patti-voucher',
    'voucher-audit',
    'duplicate-voucher',
    'jantri',
    'declare-jantri',
    'collection',
    'declare-collection',
    'live-prediction',
    'declare-prediction',
    'transaction-asc',
    'declare-trans-asc',
    'company-calculation',
    'daily-report',
    'all-shift-report',
    'settling-report',
    'tpc-report',
    'profit-loss-report',
    'limit-balance-report',
    'admin-cash',
    'trial-balance-report',
    'outstanding-report',
    'hawapatti-rpt',
    'vapsi-report',
    'cash-report',
    'voucher-list-report',
    'settlement',
    'hvs-process',
    'settlement-agent-group',
    'outstanding-agent-group',
    'productivity-report',
    'trans-before-after-declare',
    'pl-before-after-declare',
    'productivity-shift',
    'productivity-audit',
    'trans-after-timing',
    'message-manage',
    'flash-message-manage',
    'staff-attendance',
    'payroll-attendance-manage',
    'salary-register',
    'leave-manage',
  ].includes(currentPage);

  if (currentPage === 'transaction-add') {
    return (
      <AddTransactionPage
        shifts={shifts}
        activeShift={activeShift}
        onSelectShift={(s) => setActiveShift(s)}
        onNavigate={navigateTo}
        transactionId={routeInfo.param}
        user={user}
      />
    );
  }

  if (currentPage === 'transaction-edit') {
    return (
      <AddTransactionPage
        shifts={shifts}
        activeShift={activeShift}
        onSelectShift={(s) => setActiveShift(s)}
        onNavigate={navigateTo}
        editShiftId={routeInfo.param}
        editTransactionId={routeInfo.param2}
        user={user}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#eaedf2] text-slate-900 flex flex-col">
      <Navbar
        user={user}
        shifts={shifts}
        onLogout={handleLogout}
        activeShift={activeShift}
        onSelectShift={(s) => setActiveShift(s)}
        currentPage={currentPage}
        onNavigate={navigateTo}
      />
      <RoleMessageNotice user={user} />

      <div className="flex-1 flex overflow-hidden">
        {!isMasterOrDashboard && (
          <Sidebar
            currentPage={currentPage}
            onNavigate={navigateTo}
            userRole={user.roleName}
          />
        )}

        <main className={`flex-1 overflow-y-auto custom-scrollbar ${isMasterOrDashboard ? 'bg-[#eaedf2]' : 'bg-[#080d1a] text-slate-100'}`}>
          {currentPage === 'dashboard' && (
            <DashboardPage
              shifts={shifts}
              user={user}
              onNavigate={navigateTo}
              onSelectShift={(s) => setActiveShift(s)}
            />
          )}

          {currentPage === 'add-transaction' && (
            <AddTransactionPage
              shifts={shifts}
              activeShift={activeShift}
              onSelectShift={(s) => setActiveShift(s)}
              onNavigate={navigateTo}
            />
          )}

          {currentPage === 'transaction-list' && (
            <TransactionListPage
              shifts={shifts}
              user={user}
              onNavigate={navigateTo}
            />
          )}

          {currentPage === 'declare-transactions' && (
            <DeclareTransactionListPage
              shifts={shifts}
              user={user}
              onNavigate={navigateTo}
            />
          )}

          {currentPage === 'trans-permission' && (
            <DeclareTransPermissionPage
              shifts={shifts}
              user={user}
            />
          )}

          {currentPage === 'duplicate-trans' && (
            <DuplicateTransPage
              shifts={shifts}
              user={user}
            />
          )}

          {currentPage === 'trans-audit' && (
            <TransactionAuditPage
              shifts={shifts}
              user={user}
              onNavigate={navigateTo}
              isDeclareMode={false}
            />
          )}

          {currentPage === 'declare-trans-audit' && (
            <TransactionAuditPage
              shifts={shifts}
              user={user}
              onNavigate={navigateTo}
              isDeclareMode={true}
            />
          )}

          {currentPage === 'jantri' && (
            <JantriPage
              shifts={shifts}
              activeShift={activeShift}
              onSelectShift={(s) => setActiveShift(s)}
            />
          )}

          {currentPage === 'declare-jantri' && (
            <DeclareJantriPage
              shifts={shifts}
              activeShift={activeShift}
              onSelectShift={(s) => setActiveShift(s)}
            />
          )}

          {currentPage === 'collection' && (
            <CollectionPage shifts={shifts} activeShift={activeShift} />
          )}

          {currentPage === 'declare-collection' && (
            <DeclareCollectionPage shifts={shifts} activeShift={activeShift} />
          )}

          {currentPage === 'live-prediction' && (
            <LivePredictionPage shifts={shifts} user={user} onNavigate={navigateTo} />
          )}

          {currentPage === 'declare-prediction' && (
            <DeclarePredictionPage shifts={shifts} user={user} onNavigate={navigateTo} />
          )}

          {currentPage === 'transaction-asc' && (
            <TransactionAscPage shifts={shifts} />
          )}

          {currentPage === 'declare-trans-asc' && (
            <DeclareTransAscPage shifts={shifts} />
          )}

          {currentPage === 'company-calculation' && (
            <CompanyCalculationPage
              shifts={shifts}
              activeShift={activeShift}
              onSelectShift={(s) => setActiveShift(s)}
              onNavigate={navigateTo}
            />
          )}

          {currentPage === 'daily-report' && <DailyReportPage shifts={shifts} onNavigate={navigateTo} />}
          {currentPage === 'all-shift-report' && <AllShiftReportPage onNavigate={navigateTo} />}
          {currentPage === 'settling-report' && <SettlingReportPage onNavigate={navigateTo} />}
          {currentPage === 'tpc-report' && <TpcReportPage shifts={shifts} />}
          {currentPage === 'profit-loss-report' && <ProfitLossReportPage />}
          {currentPage === 'limit-balance-report' && <LimitBalanceReportPage />}
          {currentPage === 'admin-cash' && <AdminCashPage />}
          {currentPage === 'trial-balance-report' && <TrialBalanceReportPage />}
          {currentPage === 'outstanding-report' && <OutstandingReportPage />}
          {currentPage === 'hawapatti-rpt' && <HawaPattiRptPage />}
          {currentPage === 'vapsi-report' && <VapsiReportPage />}
          {currentPage === 'cash-report' && <CashReportPage />}
          {currentPage === 'voucher-list-report' && <VoucherListReportPage />}
          {currentPage === 'settlement' && <SettlementPage onNavigate={navigateTo} />}
          {currentPage === 'hvs-process' && <HvsProcessPage onNavigate={navigateTo} />}
          {currentPage === 'settlement-agent-group' && <SettlementAgentPage onNavigate={navigateTo} />}
          {currentPage === 'outstanding-agent-group' && <OutstandingAgentGroupPage />}
          {currentPage === 'productivity-report' && <ProductivityReportPage shifts={shifts} onNavigate={navigateTo} />}
          {currentPage === 'productivity-shift' && <ProductivityShiftPage onNavigate={navigateTo} />}
          {currentPage === 'productivity-audit' && <ProductivityAuditPage shifts={shifts} onNavigate={navigateTo} />}
          {currentPage === 'trans-before-after-declare' && <TransBeforeAfterDeclarePage shifts={shifts} onNavigate={navigateTo} />}
          {currentPage === 'pl-before-after-declare' && <PlBeforeAfterDeclarePage shifts={shifts} />}
          {currentPage === 'trans-after-timing' && <TransAfterTimingPage />}
          {currentPage === 'message-manage' && <MessageManagePage />}
          {currentPage === 'flash-message-manage' && <FlashMessageManagePage />}
          {currentPage === 'staff-attendance' && <StaffAttendancePage />}
          {currentPage === 'payroll-attendance-manage' && <PayrollAttendancePage />}
          {currentPage === 'salary-register' && <SalaryRegisterPage />}
          {currentPage === 'leave-manage' && <LeaveManagePage />}

          {currentPage === 'declare' && (
            <DeclarePage
              shifts={shifts}
              user={user}
              onRefreshShifts={fetchShifts}
            />
          )}

          {currentPage === 'duplicates' && (
            <DuplicatePage />
          )}

          {currentPage === 'audit' && (
            <AuditPage />
          )}

          {currentPage === 'shifts' && (
            <ShiftManagePage
              shifts={shifts}
              onRefreshShifts={fetchShifts}
              user={user}
            />
          )}

          {currentPage === 'ledgers' && (
            <LedgersPage />
          )}

          {currentPage === 'access-block' && (
            <AccessBlockPage />
          )}

          {currentPage === 'staff' && (
            <StaffPage user={user} />
          )}

          {currentPage === 'agents' && (
            <AgentsPage />
          )}

          {currentPage === 'staff-assets' && (
            <StaffAssetsPage />
          )}

          {currentPage === 'vouchers' && (
            <VouchersPage shifts={shifts} />
          )}

          {currentPage === 'journal-voucher' && (
            <JournalVoucherPage />
          )}

          {currentPage === 'limit-voucher' && (
            <LimitVoucherPage />
          )}

          {currentPage === 'kist-voucher' && (
            <KistVoucherPage />
          )}

          {currentPage === 'vapsi-voucher' && (
            <VapsiVoucherPage />
          )}

          {currentPage === 'hawa-patti-voucher' && (
            <HawaPattiVoucherPage />
          )}

          {currentPage === 'voucher-audit' && (
            <VoucherAuditPage onNavigate={navigateTo} />
          )}

          {currentPage === 'duplicate-voucher' && (
            <DuplicateVoucherPage />
          )}
        </main>
      </div>
    </div>
  );
};
