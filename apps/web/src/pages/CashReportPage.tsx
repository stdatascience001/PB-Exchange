import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { DateDMYInput } from '../components/DateDMYInput.js';

const PAGE_TITLE = 'Cash Report';

// One Cash Agent ledger of GET /transactions/cash-agent-report
// (TransactionService.getCashAgentReport): Opening (before From), Amount (From → To), Closing.
// Balances are Dr − Cr, the same figure Admin Cash / OutStanding show for the ledger.
interface CashAgentRow {
  ledgerId: number;
  partyName: string;
  opening: number;
  amount: number;
  closing: number;
}

interface CashAgentReport {
  rows: CashAgentRow[];
  totalOpening: number;
  totalAmount: number;
  totalClosing: number;
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST)
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, signed, as the live report prints them (4511958, 0)
const fmt = (n: number) => String(Math.round(n || 0) + 0);

export const CashReportPage: React.FC = () => {
  const [data, setData] = useState<CashAgentReport | null>(null);
  const list = data?.rows || [];
  // Only the latest Search may fill the table
  const reqRef = useRef(0);
  const [loading, setLoading] = useState(false);
  // Live opens with both From and To on today's date
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());

  const message = (kind: 'Error' | 'Message', text: string, toastId: string) => toast.error(
    <div>
      <div className="font-bold text-base">{kind}</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    { toastId }
  );

  const fetchList = async () => {
    if (!fromDate || !toDate) return message('Message', 'Please select both Dates!', 'cashrpt-date');
    if (fromDate > toDate) return message('Message', 'From Date cannot be after To Date!', 'cashrpt-date');
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const res = await apiRequest<CashAgentReport>(`/transactions/cash-agent-report?${params.toString()}`);
      if (reqId !== reqRef.current) return;
      setData(res.data || null);
      // Live: a Search that finds nothing says so in a red Error toast
      if (!res.data || res.data.rows.length === 0) message('Error', 'Record not avaliable!', 'cashrpt-empty');
    } catch (err: any) {
      if (reqId !== reqRef.current) return;
      console.warn('Failed to load cash report:', err);
      setData(null);
      message('Error', err?.message || 'Failed to load report', 'cashrpt-load');
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  };

  // Live flow: the page opens with the cursor on From's day and an empty table; Enter walks
  // From DD -> MM -> YYYY -> To DD -> MM -> YYYY -> Search, and the report loads on Search
  // (Enter or click) with a spinner on the button — not on every date change.
  const [hasSearched, setHasSearched] = useState(false);
  const focusById = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  useEffect(() => {
    focusById('cashrpt-fromDate-dd');
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setHasSearched(true);
    fetchList();
  };

  const handleExportExcel = () => {
    if (list.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Sr,Party,Opening,Amount,Closing'].concat(
        list.map((r, i) => `${i + 1},"${r.partyName}",${fmt(r.opening)},${fmt(r.amount)},${fmt(r.closing)}`),
        [`${list.length},Party,${fmt(data?.totalOpening || 0)},${fmt(data?.totalAmount || 0)},${fmt(data?.totalClosing || 0)}`]
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `${PAGE_TITLE.toLowerCase().replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const th = 'py-2.5 px-3 border-r border-[#223b63]';
  const td = 'py-2 px-3 font-semibold text-slate-700 border-r border-slate-200';

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">{PAGE_TITLE}</span>
            <span className="text-slate-600 font-semibold text-[11px] ml-4">From</span>
            <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="cashrpt-fromDate" separator="-" onEnterFromYear={() => focusById('cashrpt-toDate-dd')} />
            <span className="text-slate-600 font-semibold text-[11px] mx-1">To</span>
            <DateDMYInput value={toDate} onChange={setToDate} idPrefix="cashrpt-toDate" separator="-" onEnterFromYear={() => focusById('cashrpt-search-btn')} />
            <button id="cashrpt-search-btn" type="submit" disabled={loading} className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
              Search
              {/* Spinner while the report loads, as on live */}
              {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            </button>
          </div>
          <button type="button" onClick={handleExportExcel} className="px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="overflow-auto flex-1 max-h-[calc(100vh-190px)]">
          <table className="w-auto min-w-[560px] text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className={`${th} w-11`}>Sr.</th>
                <th className={`${th} w-56`}>Party</th>
                <th className={`${th} w-24 text-right`}>Opening</th>
                <th className={`${th} w-24 text-right`}>Amount</th>
                <th className={`${th} w-24 text-right`}>Closing</th>
              </tr>
            </thead>
            <tbody className="font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={5} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={5} className="py-14" /></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={5} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                list.map((r, idx) => (
                  <tr key={r.ledgerId} className="even:bg-slate-50/60 hover:bg-slate-50 [&>td]:border-b [&>td]:border-slate-200">
                    <td className={td}>{idx + 1}</td>
                    <td className={`${td} uppercase bg-[#f1f1f1]`}>{r.partyName}</td>
                    <td className={`${td} text-right`}>{fmt(r.opening)}</td>
                    <td className={`${td} text-right`}>{fmt(r.amount)}</td>
                    <td className={`${td} text-right`}>{fmt(r.closing)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Footer as live: count, then the Opening / Amount / Closing totals */}
            {!loading && hasSearched && list.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className={th}>{list.length}</td>
                  <td className={th}>Party</td>
                  <td className={`${th} text-right`}>{fmt(data?.totalOpening || 0)}</td>
                  <td className={`${th} text-right`}>{fmt(data?.totalAmount || 0)}</td>
                  <td className={`${th} text-right`}>{fmt(data?.totalClosing || 0)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
