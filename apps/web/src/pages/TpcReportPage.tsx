import React, { useState, useEffect } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface TpcReportPageProps {
  shifts?: ShiftDto[];
}

// One row of GET /transactions/tpc-report: a party that earns Third Party Commission
// through other ledgers' TPC links, with its agent.
interface TpcRow {
  partyName: string;
  amount: number;
  agentName: string;
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, as the live report prints them (240, 3102, 3342).
const fmt = (n: number) => String(Math.round(n || 0));

const messageToast = (text: string, toastId: string) =>
  toast.error(
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    { toastId }
  );

export const TpcReportPage: React.FC<TpcReportPageProps> = () => {
  const [list, setList] = useState<TpcRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());

  const fetchList = async () => {
    if (!fromDate || !toDate) return messageToast('Please select both Dates!', 'tpc-date');
    if (fromDate > toDate) return messageToast('From Date cannot be after To Date!', 'tpc-date');
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const res = await apiRequest<{ rows: TpcRow[] }>(`/transactions/tpc-report?${params.toString()}`);
      const rows = res.data?.rows || [];
      setList(rows);
      // Live: a Search that finds nothing says so in a red Error toast
      if (rows.length === 0) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'tpc-empty' }
        );
      }
    } catch (err: any) {
      console.warn('Failed to load TPC report:', err);
      messageToast(err.message || 'Failed to load TPC report', 'tpc-load');
    } finally {
      setLoading(false);
    }
  };

  // Live flow: the page opens with the cursor on From's day and an empty table; Enter walks
  // From DD -> MM -> YYYY -> To DD -> MM -> YYYY -> Search, and the report loads on Search
  // (Enter or click) with a spinner on the button — not on every date change.
  const focusById = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  useEffect(() => {
    focusById('tpc-fromDate-dd');
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    fetchList();
  };

  const handleExportExcel = () => {
    if (list.length === 0) {
      messageToast('Record not found!', 'tpc-excel');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Sr,Party,Amount,Agent'].concat(
        list.map((r, i) => `${i + 1},"${r.partyName}",${fmt(r.amount)},"${r.agentName}"`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `tpc_report_${fromDate}_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const grandTotal = list.reduce((s, r) => s + r.amount, 0);
  const th = 'py-2.5 px-3 border-r border-[#223b63]';

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-700 tracking-tight mx-4">TPC Report</span>
          <span className="text-slate-600 font-semibold text-[11px] ml-10">From</span>
          <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="tpc-fromDate" separator="-" onEnterFromYear={() => focusById('tpc-toDate-dd')} />
          <span className="text-slate-600 font-semibold text-[11px] mx-3">To</span>
          <DateDMYInput value={toDate} onChange={setToDate} idPrefix="tpc-toDate" separator="-" onEnterFromYear={() => focusById('tpc-search-btn')} />
          <button id="tpc-search-btn" type="submit" disabled={loading} className="ml-3 px-10 py-1.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded-xs shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
            Search
            {/* Spinner while the report loads, as on live */}
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </button>
          <button type="button" onClick={handleExportExcel} className="ml-auto px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded-xs shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className={`${th} w-12`}>Sr.</th>
                <th className={`${th} w-64`}>Party</th>
                <th className={`${th} w-24 text-right`}>Amount</th>
                <th className="py-2.5 px-3">Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={4} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : (
                list.map((r, idx) => (
                  <tr key={r.partyName} className="hover:bg-slate-50 transition-colors even:bg-slate-50/60">
                    <td className="py-2 px-3 text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-3 font-semibold text-slate-700 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className="py-2 px-3 text-right font-semibold text-slate-700 border-r border-slate-200">{fmt(r.amount)}</td>
                    <td className="py-2 px-3 font-semibold text-slate-700 uppercase">{r.agentName}</td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && list.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className={th}>{list.length}</td>
                  <td className={th}>Party</td>
                  <td className={`${th} text-right`}>{fmt(grandTotal)}</td>
                  <td className="py-2.5 px-3">Agent</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
