import React, { useState, useEffect } from 'react';
import { ShiftDto, UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { showsReducedDashboard } from '../config/roleAccess.js';
import { RedeclareModal } from '../components/RedeclareModal.js';

interface DashboardMetricsResponse {
  shifts: Array<{
    id: number;
    name: string;
    openDate: string;
    rawOpenDate: string;
    status: string;
    declaredNumber: string | null;
    totalAmount: number;
    totalCount: number;
    totalPayout: number;
    netAmount: number;
    cutoffPassed: boolean;
    timeRemainingSeconds: number;
    isActive?: boolean;
  }>;
  declareNeeded: Array<{
    id: number;
    name: string;
    openDate: string;
    status: string;
    isDeclared?: boolean;
    // Set only on ReDeclare rows (a declared cycle whose data changed after the declare)
    declarationId?: number;
    rawOpenDate?: string;
    changeCount?: number;
    terminal?: string;
    timestamp?: string;
  }>;
  unverifiedShifts: Array<{
    id: number;
    name: string;
    declaredNumber: string | null;
    openDate: string;
  }>;
  staffWorking: Array<{
    id: number;
    code: string;
    fullName: string;
    username?: string;
    partyName?: string;
    role?: string;
    designation: string;
    isWorkingLive: boolean;
    status: 'WORKING' | 'IDLE';
    timestamp: string;
  }>;
}


// The shift cards render whatever /dashboard/metrics returns, and a single missing numeric
// field used to take the entire page down: `s.netAmount.toLocaleString(...)` threw
// "Cannot read properties of undefined (reading 'toLocaleString')" inside this map, which
// React treats as an unrecoverable render error — the whole dashboard went blank. Coercing
// here keeps a card showing 0 instead, and also tolerates a numeric string (e.g. "300.00")
// from an older API build, which would otherwise render unformatted.
const money = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// Card badge as a whole number, rounded the mathematical way: .5 and up goes up, below .5
// goes down (124.56 -> 125, 30.4 -> 30), the same for minus amounts (-30.6 -> -31).
const roundHalfUp = (n: number): number => {
  const r = Math.sign(n) * Math.round(Math.abs(n));
  return r === 0 ? 0 : r;
};

interface DashboardPageProps {
  shifts: ShiftDto[];
  user: UserSession | null;
  onNavigate: (page: string) => void;
  onSelectShift: (shift: ShiftDto) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  user,
  onNavigate,
  onSelectShift,
}) => {
  const [metrics, setMetrics] = useState<DashboardMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // MANAGER/DATA ENTRY OPERATOR's live dashboard only shows the Staff Working panel —
  // Declare Needed and Un-Verified Shifts aren't rendered at all (not even as empty boxes,
  // unlike ADMIN which still sees the empty panel containers).
  const hideDeclarePanels = showsReducedDashboard(user?.roleName);
  // ReDeclare popup (DECLARE INFO) for the Declare Needed row that was clicked
  const [redeclareTarget, setRedeclareTarget] = useState<{ declarationId: number; changeCount?: number } | null>(null);
  // Declare Needed lists only the ReDeclare rows (declared cycles changed after the declare),
  // as on the live panel. The API still returns the not-yet-declared shifts too — they are
  // just not rendered here; declaring them stays on Result → Declare.
  const redeclareRows = (metrics?.declareNeeded || []).filter((d) => d.isDeclared && d.declarationId);

  // Fetch fully dynamic metrics from backend API
  const fetchMetrics = async () => {
    try {
      const res = await apiRequest<DashboardMetricsResponse>('/dashboard/metrics');
      if (res.data) {
        setMetrics(res.data);
      }
    } catch (err) {
      console.warn('Failed to load dashboard dynamic metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000); // Poll live database every 10s
    return () => clearInterval(interval);
  }, []);

  // An SSE-based real-time channel was tried here (Redis Pub/Sub -> EventSource), but was
  // reverted: EventSource holds a persistent connection, and Chrome caps concurrent
  // connections per origin at 6 — shared across every open tab, not per tab. With several
  // "PB Exchange" tabs open at once (common in this app's own multi-window workflows), two
  // persistent SSE connections per tab exhausted that shared budget and started silently
  // queueing regular fetch() calls (including the poll above), breaking data on refresh. The
  // backend Pub/Sub + /dashboard/stream endpoint are left in place, unused, for a future retry
  // behind a single shared connection instead of one-per-page.

  const handleVerifyShift = async (shift: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Verify and audit declared result for ${shift.name} [${shift.declaredNumber || ''}]?`)) return;
    try {
      await apiRequest(`/declarations/${shift.id}/verify`, { method: 'POST' });
      await fetchMetrics();
    } catch (err: any) {
      alert(err.message || 'Verification failed');
    }
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-4 sm:p-5 flex flex-col justify-between text-slate-800 select-none">
      <div>
        {/* Top Market Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 mb-4">
          {metrics?.shifts.filter((s) => s.isActive !== false).map((s) => {
            const isDeclared = s.declaredNumber !== null && s.declaredNumber !== undefined;

            return (
              <div
                key={s.id}
                onClick={() => {
                  onSelectShift(s as any);
                  window.open(`/transaction_add/${s.id}`, '_blank');
                }}
                className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow border border-slate-200/60 p-3.5 min-h-[96px] flex items-center justify-between cursor-pointer group"
              >
                {/* Declared Card Layout */}
                {isDeclared ? (
                  <>
                    <div className="flex flex-col justify-center min-w-0 pr-2">
                      <span className="text-[11px] sm:text-xs font-bold text-slate-500 tracking-wider uppercase truncate mb-1">
                        {s.name}
                      </span>
                      <span className="text-[11px] font-bold text-emerald-600 font-sans tracking-wide">
                        {s.openDate}
                      </span>
                    </div>

                    {/* Pink Badge with Declared Number */}
                    <div className="shrink-0 bg-[#ec135d] text-white rounded-2xl px-3.5 py-1.5 shadow-sm shadow-pink-500/20 text-center min-w-[50px]">
                      <span className="text-xl sm:text-2xl font-black italic tracking-tight font-serif leading-none">
                        {s.declaredNumber}
                      </span>
                    </div>
                  </>
                ) : (
                  /* Open/Pending Card Layout with Live Dynamic Metrics */
                  <div className="flex flex-col justify-between w-full h-full">
                    <span className="text-[11px] sm:text-xs font-bold text-slate-800 tracking-wider uppercase truncate">
                      {s.name}
                    </span>

                    <div className="flex items-baseline justify-between mt-2">
                      <span className="text-lg sm:text-xl font-bold text-[#00897b] font-sans tracking-tight">
                        {money(s.totalAmount) > 0 ? money(s.totalAmount).toLocaleString('en-IN') : '0'}
                      </span>
                      {/* Total Amount after each party's own Commission/Hissa/Kat (Rebate) is
                          deducted — same per-party ledger-config approach as the Collection report. */}
                      {money(s.totalAmount) > 0 && (
                        <span className="border border-emerald-300 bg-emerald-50 text-emerald-700 rounded-md px-2 py-0.5 text-[11px] sm:text-xs font-bold font-mono tracking-tight">
                          {roundHalfUp(money(s.netAmount)).toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Three Operational Panels */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* Panel 1: Declare Needed (hidden entirely for MANAGER/DATA ENTRY OPERATOR) */}
          {!hideDeclarePanels && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-4 h-[290px] flex flex-col relative">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">
                Declare Needed
              </h2>
              {redeclareRows.length > 0 && (
                <span className="px-2 py-0.5 bg-rose-100 text-rose-700 text-xs font-bold rounded-full">
                  {redeclareRows.length}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
              {redeclareRows.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
                  No shifts pending declaration
                </div>
              ) : (
                redeclareRows.map((d) => (
                  <div
                    key={d.declarationId ? `re-${d.declarationId}` : `${d.id}-${d.rawOpenDate || d.openDate}`}
                    onClick={() => {
                      if (d.isDeclared && d.declarationId) {
                        setRedeclareTarget({ declarationId: d.declarationId, changeCount: d.changeCount });
                        return;
                      }
                      onSelectShift(d as any);
                      onNavigate('declare');
                    }}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-rose-50 border border-slate-100 hover:border-rose-200 transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800 uppercase">
                        {d.name} | {d.openDate}
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                        {d.terminal || 'T1'} | {d.timestamp || d.openDate}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-3 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-white rounded-full text-[11px] font-bold shadow-xs cursor-pointer transition-colors"
                    >
                      {d.isDeclared ? 'ReDeclare' : 'Declare'}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Scroll Indicator */}
            <div className="absolute right-2 top-4 flex flex-col text-slate-300 pointer-events-none">
              <ChevronUp className="h-3.5 w-3.5" />
              <ChevronDown className="h-3.5 w-3.5" />
            </div>
          </div>
          )}

          {/* Panel 2: Un-Verified Shifts (hidden entirely for MANAGER/DATA ENTRY OPERATOR) */}
          {!hideDeclarePanels && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-4 h-[290px] flex flex-col relative">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">
                Un-Verified Shifts
              </h2>
              {metrics && metrics.unverifiedShifts.length > 0 && (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                  {metrics.unverifiedShifts.length}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
              {!metrics || metrics.unverifiedShifts.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
                  All declared shifts verified
                </div>
              ) : (
                metrics.unverifiedShifts.map((u) => (
                  <div
                    key={u.id}
                    onClick={() => {
                      onSelectShift(u as any);
                      onNavigate('audit');
                    }}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-amber-50 border border-slate-100 hover:border-amber-200 transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800 uppercase">{u.name}</div>
                      <div className="text-[10px] text-slate-500 font-sans">{u.openDate}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {u.declaredNumber && (
                        <span className="px-2 py-0.5 bg-pink-100 text-pink-700 font-bold text-xs rounded">
                          {u.declaredNumber}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleVerifyShift(u, e)}
                        className="px-3 py-1 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-bold rounded-lg text-xs shadow-sm transition-colors cursor-pointer"
                      >
                        Verify
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Scroll Indicator */}
            <div className="absolute right-2 top-4 flex flex-col text-slate-300 pointer-events-none">
              <ChevronUp className="h-3.5 w-3.5" />
              <ChevronDown className="h-3.5 w-3.5" />
            </div>
          </div>
          )}

          {/* Panel 3: Staff Working */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-4 h-[290px] flex flex-col relative">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">
                Staff Working
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-slate-100 pr-1">
              {!metrics || metrics.staffWorking.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
                  No staff currently working
                </div>
              ) : (
                metrics.staffWorking.map((st) => {
                  const isWorking = st.status === 'WORKING' || st.isWorkingLive;
                  const isAdminRole = (st.role && st.role.toUpperCase().includes('ADMIN')) || 
                                     (st.designation && st.designation.toUpperCase().includes('ADMIN'));

                  const parts = (st.code || '').split('|').map((p) => p.trim());
                  const first = parts[0] || st.fullName;
                  const second = parts[1] || st.username || first;

                  return (
                    <div key={st.id} className="py-2.5 first:pt-1">
                      <div className="text-xs tracking-wide mb-1 flex items-center gap-1.5">
                        <span className="font-bold text-slate-900">{first}</span>
                        <span className="text-slate-400 font-normal">|</span>
                        <span className="font-bold text-[#7c3aed]">{second}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-white text-[10px] font-bold rounded ${
                              isWorking ? 'bg-[#00897b]' : 'bg-[#dc2626]'
                            }`}
                          >
                            {isWorking ? 'WORKING' : 'IDLE'}
                          </span>
                          <span
                            className={`font-semibold uppercase text-[10px] tracking-wide ${
                              isAdminRole ? 'text-[#7c3aed] font-bold' : 'text-slate-500'
                            }`}
                          >
                            {st.designation}
                          </span>
                        </div>
                        <span className="text-slate-400 font-medium text-[10px] font-sans">
                          {st.timestamp}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>


            {/* Scroll Indicator */}
            <div className="absolute right-2 top-4 flex flex-col text-slate-300 pointer-events-none">
              <ChevronUp className="h-3.5 w-3.5" />
              <ChevronDown className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>
      </div>

      <RedeclareModal
        declarationId={redeclareTarget?.declarationId ?? null}
        changeCount={redeclareTarget?.changeCount}
        onClose={() => setRedeclareTarget(null)}
        onRedeclared={fetchMetrics}
      />

      {/* Bottom Footer Credit */}
      <div className="pt-2 text-slate-400 text-[11px] font-medium select-none">
        © PB Exchange 2026
      </div>
    </div>
  );
};
