import React, { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';

const PAGE_TITLE = 'Limit & Balance Report';

// One ledger of GET /vouchers/limit-balance (see VoucherService.getLimitBalanceReport):
// Balance and Limit are Dr − Cr; FinalLimit = Balance + Limit + TransConsum.
interface LimitBalanceRow {
  ledgerId: number;
  partyName: string;
  balance: number;
  limit: number;
  transConsum: number;
  finalLimit: number;
  status: 'SUFFICIENT' | 'INSUFFICIENT';
}

type FilterMode = 'ALL' | 'SUFFICIENT' | 'INSUFFICIENT';

// Whole numbers without grouping, as the live report prints them (697516, -120279572).
const fmt = (n: number) => String(Math.round(n || 0));

export const LimitBalanceReportPage: React.FC = () => {
  const [list, setList] = useState<LimitBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('ALL');

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<LimitBalanceRow[]>('/vouchers/limit-balance');
      setList(res.data || []);
    } catch (err: any) {
      console.warn('Failed to load limit & balance report:', err);
      toast.error(
        <div>
          <div className="font-bold text-base">Message</div>
          <div className="text-sm mt-0.5">{err.message || 'Failed to load report'}</div>
        </div>,
        { toastId: 'limit-balance-load' }
      );
    } finally {
      setLoading(false);
    }
  };

  // Live page opens empty and only loads on Search (or F5 = Reload List).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        fetchList();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchList();
  };

  // Filter narrows the loaded list: Sufficient = FinalLimit ≤ 0, Insufficient = FinalLimit > 0.
  const rows = useMemo(
    () => (filter === 'ALL' ? list : list.filter(r => r.status === filter)),
    [list, filter]
  );

  const totals = useMemo(() => rows.reduce(
    (t, r) => ({
      balance: t.balance + r.balance,
      limit: t.limit + r.limit,
      transConsum: t.transConsum + r.transConsum,
      finalLimit: t.finalLimit + r.finalLimit,
    }),
    { balance: 0, limit: 0, transConsum: 0, finalLimit: 0 }
  ), [rows]);

  const handleExportExcel = () => {
    if (rows.length === 0) {
      toast.error(
        <div>
          <div className="font-bold text-base">Message</div>
          <div className="text-sm mt-0.5">Record not found!</div>
        </div>,
        { toastId: 'limit-balance-excel' }
      );
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Sr,Party,Balance,Limit,TransConsum,FinalLimit'].concat(
        rows.map((r, i) => `${i + 1},"${r.partyName}",${fmt(r.balance)},${fmt(r.limit)},${fmt(r.transConsum)},${fmt(r.finalLimit)}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `${PAGE_TITLE.toLowerCase().replace(/[^a-z]+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const th = 'py-2.5 px-3 border-r border-[#223b63]';
  const td = 'py-2 px-3 text-right font-semibold text-slate-700 border-r border-slate-200';

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-700 tracking-tight mx-3">{PAGE_TITLE}</span>
          <button type="submit" className="px-10 py-1.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded-xs shadow-xs transition-colors">
            Search
          </button>
          <span className="text-slate-600 font-semibold text-[11px] ml-4">Filter</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterMode)}
            className="w-32 px-2.5 py-1 bg-[#fde68a] border border-amber-300 rounded-xs text-xs font-bold text-slate-900 cursor-pointer focus:outline-none"
          >
            <option value="ALL">All</option>
            <option value="SUFFICIENT">Sufficient</option>
            <option value="INSUFFICIENT">Insufficient</option>
          </select>
          <button type="button" onClick={handleExportExcel} className="ml-auto px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded-xs shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="overflow-auto flex-1 max-h-[calc(100vh-190px)]">
          <table className="w-full text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className={`${th} w-12`}>Sr.</th>
                <th className={`${th} w-72`}>Party</th>
                <th className={`${th} w-24 text-right`}>Balance</th>
                <th className={`${th} w-24 text-right`}>Limit</th>
                <th className={`${th} w-24 text-right`}>TransConsum</th>
                <th className={`${th} w-24 text-right`}>FinalLimit</th>
                <th className="py-2.5 px-3"></th>
              </tr>
            </thead>
            <tbody className="font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={7} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.ledgerId} className="hover:bg-slate-50 even:bg-slate-50/60 [&>td]:border-b [&>td]:border-slate-200">
                    <td className="py-2 px-3 text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-3 font-semibold text-slate-700 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className={td}>{fmt(r.balance)}</td>
                    <td className={td}>{fmt(r.limit)}</td>
                    <td className={td}>{fmt(r.transConsum)}</td>
                    <td className={td}>{fmt(r.finalLimit)}</td>
                    <td></td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td className={th}>{rows.length}</td>
                  <td className={th}>Party</td>
                  <td className={`${th} text-right`}>{fmt(totals.balance)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.limit)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.transConsum)}</td>
                  <td className={`${th} text-right`}>{fmt(totals.finalLimit)}</td>
                  <td className="py-2.5 px-3"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <div className="mt-2 px-1 text-[11px] text-slate-600">[F5 = Reload List]</div>
    </div>
  );
};
