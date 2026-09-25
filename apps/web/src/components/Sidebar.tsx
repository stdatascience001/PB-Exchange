import React from 'react';
import {
  LayoutDashboard,
  PlusCircle,
  ListOrdered,
  Trophy,
  Grid3X3,
  CopyCheck,
  ShieldAlert,
  Clock,
  BookOpen,
  Users,
  UserCheck,
  Ban,
  FileCheck2,
} from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  userRole?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  userRole,
}) => {
  const transactionItems = [
    { id: 'dashboard', label: 'Live Dashboard', icon: LayoutDashboard },
    { id: 'add-transaction', label: 'Add Slip (F1)', icon: PlusCircle, badge: 'HOT' },
    { id: 'transaction-list', label: 'Transaction List', icon: ListOrdered },
    { id: 'jantri', label: 'Jantri 10x10 View', icon: Grid3X3 },
    { id: 'declare', label: 'Declare Shift Result', icon: Trophy, adminOnly: true },
    { id: 'duplicates', label: 'Duplicate Review', icon: CopyCheck },
    { id: 'audit', label: 'Audit Inspection', icon: FileCheck2 },
  ];

  const masterItems = [
    { id: 'shifts', label: 'Shifts & Timers', icon: Clock, adminOnly: true },
    { id: 'ledgers', label: 'Parties & Ledgers', icon: BookOpen },
    { id: 'staff', label: 'Staff & Working List', icon: Users },
    { id: 'access-block', label: 'IP Access Blocking', icon: Ban, adminOnly: true },
  ];

  const isAdmin = userRole === 'DEVELOPER' || userRole === 'SUPER ADMIN' || userRole === 'ADMIN';

  return (
    <aside className="w-60 bg-[#090e1d] border-r border-slate-800 flex flex-col shrink-0 custom-scrollbar select-none">
      <div className="p-3">
        {/* Transaction Menu Section */}
        <div className="text-[10px] font-mono uppercase tracking-wider text-amber-500 font-bold px-3 py-1.5 flex items-center gap-1">
          <span>OPERATIONS & TRANSACTIONS</span>
        </div>
        <nav className="space-y-0.5 mt-1">
          {transactionItems.map((item) => {
            if (item.adminOnly && !isAdmin) return null;
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-500/20 to-amber-500/5 text-amber-400 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`h-4 w-4 ${isActive ? 'text-amber-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="px-1.5 py-0.5 text-[9px] font-mono font-black bg-amber-500 text-slate-950 rounded">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Master Management Section */}
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold px-3 py-1.5 mt-5 flex items-center gap-1 border-t border-slate-800/80 pt-4">
          <span>MASTER MANAGEMENT</span>
        </div>
        <nav className="space-y-0.5 mt-1">
          {masterItems.map((item) => {
            if (item.adminOnly && !isAdmin) return null;
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-500/20 to-blue-500/5 text-blue-400 border border-blue-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-3 border-t border-slate-800/60 bg-[#070b16]">
        <div className="text-[10px] text-slate-400 font-mono text-center">
          PB EXCHANGE v1.0.0
        </div>
      </div>
    </aside>
  );
};
