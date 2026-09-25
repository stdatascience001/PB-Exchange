import React, { useState, useRef, useEffect } from 'react';
import { UserSession, ShiftDto } from '@pb/types';
import { ChevronDown, LogOut, User, Lock, X, Eye, EyeOff } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import {
  isAdminRole, ADMIN_RESTRICTED_PAGES, ADMIN_RESTRICTED_TOP_MENUS,
  isManagerRole, MANAGER_ALLOWED_TOP_MENUS, MANAGER_REPORTS_ITEMS,
  isDataEntryOperatorRole, DATA_ENTRY_OPERATOR_ALLOWED_TOP_MENUS, DATA_ENTRY_OPERATOR_TRANSACTIONS_PAGES,
  isTallyOperatorRole, TALLY_OPERATOR_ALLOWED_TOP_MENUS, TALLY_OPERATOR_TRANSACTIONS_PAGES, TALLY_OPERATOR_REPORTS_PAGES,
  showsReducedDashboard,
} from '../config/roleAccess.js';

interface NavbarProps {
  user: UserSession | null;
  shifts: ShiftDto[];
  onLogout: () => void;
  activeShift: ShiftDto | null;
  onSelectShift: (shift: ShiftDto) => void;
  currentPage: string;
  onNavigate: (page: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  shifts,
  onLogout,
  currentPage,
  onNavigate,
}) => {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<any>(null);

  // "Last Day X%" badge — shown for MANAGER and DATA ENTRY OPERATOR per the live reference.
  // Fetched here (rather than lifted from DashboardPage, which polls the same endpoint
  // separately) so this stays self-contained and never touches DashboardPage's own
  // fetch/render logic.
  const isManager = isManagerRole(user?.roleName);
  const isDataEntryOperator = isDataEntryOperatorRole(user?.roleName);
  const isTallyOperator = isTallyOperatorRole(user?.roleName);
  const showLastDayBadge = showsReducedDashboard(user?.roleName);
  const [lastDayPercent, setLastDayPercent] = useState<number | null>(null);

  useEffect(() => {
    if (!showLastDayBadge) return;
    let cancelled = false;
    const fetchLastDay = async () => {
      try {
        const res = await apiRequest<{ lastDayDeclaredPercent?: number }>('/dashboard/metrics');
        if (!cancelled && res.data && typeof res.data.lastDayDeclaredPercent === 'number') {
          setLastDayPercent(res.data.lastDayDeclaredPercent);
        }
      } catch {
        // ignore — badge just stays hidden if this fails
      }
    };
    fetchLastDay();
    const interval = setInterval(fetchLastDay, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showLastDayBadge]);

  // Change Password Modal State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword) {
      setPasswordError('Please enter your current password');
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      setPasswordError('New password must be at least 4 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirm password do not match');
      return;
    }

    setPasswordLoading(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      setPasswordSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess('');
      }, 1200);
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleMenuEnter = (menuId: string) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenDropdown(menuId);
  };

  const handleMenuLeave = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      setOpenDropdown(null);
    }, 250); // 250ms safe hover buffer
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        setOpenDropdown(null);
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  };

  const navMenus = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      onClick: () => onNavigate('dashboard'),
    },
    {
      id: 'master',
      label: 'Master',
      items: [
        { label: 'Shift', page: 'shifts' },
        { label: 'Ledgers', page: 'ledgers' },
        { label: 'Staffs', page: 'staff' },
        { label: 'Agents', page: 'agents' },
        { label: 'Staff Salary/Assets', page: 'staff-assets' },
        { label: 'Access Block', page: 'access-block' },
      ],
    },
    {
      id: 'transactions',
      label: 'Transactions',
      items: [
        { label: 'Transactions', page: 'transaction-list' },
        { label: 'Declare Transactions', page: 'declare-transactions' },
        { label: 'Duplicate Trans', page: 'duplicate-trans' },
        { label: 'Trans-Audit', page: 'trans-audit' },
        { label: 'Declare Trans-Audit', page: 'declare-trans-audit' },
        { label: 'Declare Trans Permission', page: 'trans-permission' },
      ],
    },
    {
      id: 'vouchers',
      label: 'Vouchers',
      items: [
        { label: 'Journal Voucher', page: 'journal-voucher' },
        { label: 'Limit Voucher', page: 'limit-voucher' },
        { label: 'Kist Voucher', page: 'kist-voucher' },
        { label: 'Voucher Audit', page: 'voucher-audit' },
        { label: 'Duplicate Voucher', page: 'duplicate-voucher' },
      ],
    },
    {
      id: 'result',
      label: 'Result',
      items: [
        { label: 'Declare Shift Result', page: 'declare' },
        { label: 'Jantri', page: 'jantri' },
        { label: 'Collection', page: 'collection' },
        { label: 'Live Prediction', page: 'live-prediction' },
        { label: 'Transaction ASC', page: 'transaction-asc' },
        { label: 'Declare Prediction', page: 'declare-prediction' },
        { label: 'Declare Trans ASC', page: 'declare-trans-asc' },
        { label: 'Declare Jantri', page: 'declare-jantri' },
        { label: 'Declare Collection', page: 'declare-collection' },
        { label: 'Company Calculation', page: 'company-calculation' },
      ],
    },
    {
      id: 'reports',
      label: 'Reports',
      items: [
        { label: 'Daily Report', page: 'daily-report' },
        { label: 'All Shift Report', page: 'all-shift-report' },
        { label: 'Settling Report', page: 'settling-report' },
        { label: 'TPC Report', page: 'tpc-report' },
        { label: 'Profit & Loss Report', page: 'profit-loss-report' },
        { label: 'Limit & Balance Report', page: 'limit-balance-report' },
        { label: 'Admin Cash', page: 'admin-cash' },
        { label: 'Trail Balance Report', page: 'trial-balance-report' },
        { label: 'OutStanding Report', page: 'outstanding-report' },
        { label: 'HawaPatti Rpt', page: 'hawapatti-rpt' },
        { label: 'Vapsi Report', page: 'vapsi-report' },
        { label: 'Cash Report', page: 'cash-report' },
        { label: 'Voucher List', page: 'voucher-list-report' },
      ],
    },
    {
      id: 'admin_reports',
      label: 'Admin Reports',
      items: [
        { label: 'Vapsi Voucher', page: 'vapsi-voucher' },
        { label: 'Hawa Patti Voucher', page: 'hawa-patti-voucher' },
        { label: 'Settlement', page: 'settlement' },
        { label: 'HVS Process', page: 'hvs-process' },
        { label: 'Settlement Agent', page: 'settlement-agent-group' },
        { label: 'OutStanding Agent-Group', page: 'outstanding-agent-group' },
      ],
    },
    {
      id: 'track_reports',
      label: 'Track Reports',
      items: [
        { label: 'Productivity Report', page: 'productivity-report' },
        { label: 'Trans Before-After Declare', page: 'trans-before-after-declare' },
        { label: 'P&L Before-After Declare', page: 'pl-before-after-declare' },
        { label: 'Productivity Shift', page: 'productivity-shift' },
        { label: 'Productivity Audit', page: 'productivity-audit' },
        { label: 'Trans After Timing', page: 'trans-after-timing' },
      ],
    },
    {
      id: 'utilities',
      label: 'Utilities',
      items: [
        { label: 'Message', page: 'message-manage' },
        { label: 'Flash Message', page: 'flash-message-manage' },
        { label: 'Declare Transactions', page: 'declare-transactions' },
      ],
    },
    {
      id: 'payroll',
      label: 'Payroll',
      items: [
        { label: 'Staff Attendance', page: 'staff-attendance' },
        { label: 'Payroll Attendance', page: 'payroll-attendance-manage' },
        { label: 'Salary Register', page: 'salary-register' },
        { label: 'Leave Manage', page: 'leave-manage' },
      ],
    },

  ];

  // ADMIN sees a reduced set of menus/items, matching the live pbmax1.com ADMIN session
  // exactly (see roleAccess.ts). SUPER ADMIN/DEVELOPER and every other role see everything,
  // unchanged from before this filter was added.
  const isAdmin = isAdminRole(user?.roleName);
  // MANAGER, DATA ENTRY OPERATOR and TALLY OPERATOR are even more reduced — only Dashboard +
  // one or two small menus each. MANAGER's Reports order below is the exact order the live
  // screenshot showed (not the standard Reports item order).
  const visibleMenus = navMenus
    .filter((menu) => {
      if (isManager) return MANAGER_ALLOWED_TOP_MENUS.includes(menu.id);
      if (isDataEntryOperator) return DATA_ENTRY_OPERATOR_ALLOWED_TOP_MENUS.includes(menu.id);
      if (isTallyOperator) return TALLY_OPERATOR_ALLOWED_TOP_MENUS.includes(menu.id);
      return !isAdmin || !ADMIN_RESTRICTED_TOP_MENUS.includes(menu.id);
    })
    .map((menu) => {
      if (isManager && menu.id === 'reports') return { ...menu, items: MANAGER_REPORTS_ITEMS };
      if (isDataEntryOperator && menu.id === 'transactions' && menu.items) {
        return { ...menu, items: menu.items.filter((item) => DATA_ENTRY_OPERATOR_TRANSACTIONS_PAGES.includes(item.page)) };
      }
      if (isTallyOperator && menu.id === 'transactions' && menu.items) {
        return { ...menu, items: menu.items.filter((item) => TALLY_OPERATOR_TRANSACTIONS_PAGES.includes(item.page)) };
      }
      if (isTallyOperator && menu.id === 'reports' && menu.items) {
        return { ...menu, items: menu.items.filter((item) => TALLY_OPERATOR_REPORTS_PAGES.includes(item.page)) };
      }
      if (!isAdmin || !menu.items) return menu;
      return { ...menu, items: menu.items.filter((item) => !ADMIN_RESTRICTED_PAGES.includes(item.page)) };
    });

  return (
    <header ref={navRef} className="bg-[#1b2b48] text-white select-none sticky top-0 z-50 shadow-md">
      {/* Top Header Row */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-[#253759]">
        {/* Brand Logo */}
        <div
          onClick={() => onNavigate('dashboard')}
          className="cursor-pointer font-extrabold text-2xl tracking-tight text-white flex items-center gap-2"
        >
          <span>Punjab King</span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3.5">
          {/* Fullscreen [ ] Button */}
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="px-2.5 py-0.5 bg-[#e77c56] hover:bg-[#d86d47] text-white font-mono font-bold text-xs rounded transition-colors shadow-sm"
          >
            [ ]
          </button>

          {/* "Last Day X%" badge — MANAGER only, see roleAccess.ts for the source metric */}
          {showLastDayBadge && lastDayPercent !== null && (
            <span
              className="px-4 py-1 text-white text-xs font-bold rounded-full shadow-sm tracking-wide"
              style={{
                backgroundImage: 'repeating-linear-gradient(45deg, #2563eb, #2563eb 8px, #1d4ed8 8px, #1d4ed8 16px)',
              }}
            >
              LAST DAY {lastDayPercent}%
            </span>
          )}

          {/* Role Badge: SUPER ADMIN */}
          <span className="px-3.5 py-1 bg-[#e77c56] text-white text-xs font-bold rounded-full uppercase tracking-wide shadow-sm">
            {user?.roleName ? user.roleName.replace('_', ' ') : 'SUPER ADMIN'}
          </span>

          {/* Username & Avatar with Notification Red Dot */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2.5 focus:outline-none"
            >
              <span className="font-semibold text-xs tracking-wider text-slate-100 uppercase">
                {user?.username ? user.username.toUpperCase() : 'KARAN999'}
              </span>

              {/* Avatar Circle with Initial and Red Dot */}
              <div className="relative">
                <div className="h-8 w-8 rounded-full bg-white text-[#1b2b48] font-bold text-sm flex items-center justify-center shadow-sm">
                  {user?.username ? user.username[0].toUpperCase() : 'D'}
                </div>
                {/* Red Status / Notification Dot */}
                <span className="absolute -top-0.5 -right-0.5 h-3 w-3 bg-red-500 border-2 border-[#1b2b48] rounded-full"></span>
              </div>
            </button>

            {/* User Dropdown matching Image 1 & Image 2 */}
            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white text-slate-800 rounded-md shadow-2xl border border-slate-200 py-3 z-50 text-xs animate-in fade-in duration-100">
                {/* Username Header matching Image */}
                <div className="px-4 pb-3 border-b border-slate-100 text-center">
                  <div className="font-bold text-slate-900 text-sm tracking-wide">
                    {user?.username ? user.username.toUpperCase() : 'KARAN999'}
                  </div>
                  <div className="text-[11px] text-slate-400 font-medium tracking-wide mt-0.5">
                    {user?.username ? user.username.toUpperCase() : 'KARAN999'}
                  </div>
                </div>

                <div className="pt-2 space-y-1">
                  {/* Change Password option matching Image 1 & 2 */}
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      setPasswordError('');
                      setPasswordSuccess('');
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                      setShowPasswordModal(true);
                    }}
                    className="w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-100 hover:text-slate-900 flex items-center gap-3 font-semibold transition-colors"
                  >
                    <Lock className="h-4 w-4 text-slate-600" />
                    <span>Change Password</span>
                  </button>

                  {/* Sign Out option matching Image 1 & 2 */}
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full px-4 py-2 text-left text-slate-700 hover:bg-red-50 hover:text-red-600 flex items-center gap-3 font-semibold transition-colors"
                  >
                    <LogOut className="h-4 w-4 text-slate-600" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Second Row: Horizontal Navigation Menu */}
      <nav className="flex items-center px-4 py-1 bg-[#1a2844] overflow-visible text-xs font-medium relative z-40">
        {visibleMenus.map((menu) => {
          if (!menu.items) {
            const isActive = currentPage === menu.id;
            return (
              <button
                key={menu.id}
                onClick={menu.onClick}
                className={`px-3.5 py-1.5 rounded transition-all shrink-0 font-semibold ${isActive
                  ? 'border border-red-500/80 text-white bg-red-500/10'
                  : 'text-slate-200 hover:text-white hover:bg-white/5'
                  }`}
              >
                {menu.label}
              </button>
            );
          }

          const isOpen = openDropdown === menu.id;
          return (
            <div
              key={menu.id}
              className="relative shrink-0"
              onMouseEnter={() => handleMenuEnter(menu.id)}
              onMouseLeave={handleMenuLeave}
            >
              <button
                onClick={() => setOpenDropdown(isOpen ? null : menu.id)}
                className={`flex items-center gap-1 px-3.5 py-1.5 rounded transition-all font-semibold ${isOpen
                  ? 'text-white bg-white/15'
                  : 'text-slate-200 hover:text-white hover:bg-white/5'
                  }`}
              >
                <span>{menu.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 opacity-80 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Submenu Dropdown with smooth hover bridge */}
              {isOpen && (
                <div
                  onMouseEnter={() => handleMenuEnter(menu.id)}
                  onMouseLeave={handleMenuLeave}
                  className="absolute top-full left-0 mt-0 w-52 bg-white border border-slate-200 shadow-2xl rounded-b-md py-0 z-[100] text-xs font-medium divide-y divide-slate-100 overflow-hidden animate-in fade-in duration-100 before:block before:absolute before:-top-3 before:left-0 before:right-0 before:h-3 before:content-['']"
                >
                  {menu.items.map((sub, idx) => {
                    const isItemActive = currentPage === sub.page;
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          onNavigate(sub.page);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-4 py-2.5 transition-colors ${isItemActive
                          ? 'bg-[#ef4444] text-white font-bold'
                          : 'text-slate-700 hover:bg-[#ef4444] hover:text-white font-medium'
                          }`}
                      >
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Change Password Modal matching PB Exchange Design */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in duration-100">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full overflow-hidden border border-slate-300">
            {/* Modal Header */}
            <div className="bg-[#1e3a8a] text-white px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                <h2 className="text-sm font-bold tracking-wide">Change Password</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handlePasswordSubmit} className="p-5 space-y-3.5 text-xs text-slate-800">
              {passwordError && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded font-medium text-xs">
                  {passwordError}
                </div>
              )}

              {passwordSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded font-medium text-xs">
                  {passwordSuccess}
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded font-medium text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 4 characters)"
                    className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded font-medium text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded font-medium text-slate-900 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Modal Buttons */}
              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="px-6 py-2 bg-[#1e3a8a] hover:bg-[#172554] active:bg-[#0f172a] text-white font-bold text-xs rounded shadow transition-colors disabled:opacity-50"
                >
                  {passwordLoading ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 bg-transparent hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded transition-colors"
                >
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
