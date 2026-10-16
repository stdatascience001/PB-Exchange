import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';

const PAGE_TITLE = 'HawaPatti Rpt';

// One processed Hawa Patti line of GET /transactions/hawa-patti-report
// (TransactionService.getHawaPattiReport): live columns Party / HP-Party / Base-Amt / HP-% /
// HP-Amt / AddedBy / AddedDate.
interface HawaPattiLine {
  voucherId: number;
  partyId: number | null;
  partyName: string;
  hpPartyName: string;
  baseAmt: number;
  hpPct: number;
  hpAmt: number;
  addedBy: string;
  addedAt: string;
}

interface HawaPattiReport {
  rows: HawaPattiLine[];
  totalBase: number;
  totalHpAmt: number;
}

// Whole numbers without grouping, signed, as the live report prints them (3811, -28385)
const fmt = (n: number) => String(Math.round(n || 0) + 0);
// HP-% as live: 20, 25, 12.5
const fmtPct = (n: number) => String(Math.round((n || 0) * 100) / 100);
// "30-09-2026 11:05" — stored timestamps are wall-clock values, printed as stored
const addedDate = (iso: string) => {
  if (!iso) return '-';
  const [d, t] = iso.slice(0, 16).split('T');
  return `${d.split('-').reverse().join('-')} ${t || ''}`.trim();
};

// Live filter: Month + Year. Months are listed from the current one onwards (October,
// November … September) and years from 2020 to next year; the report covers that month.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NOW = new Date();
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => (NOW.getMonth() + i) % 12 + 1);
const YEAR_OPTIONS = Array.from({ length: NOW.getFullYear() + 1 - 2020 + 1 }, (_, i) => 2020 + i);
const monthRange = (month: number, year: number) => {
  const mm = String(month).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
};

export const HawaPattiRptPage: React.FC = () => {
  const [data, setData] = useState<HawaPattiReport | null>(null);
  const list = data?.rows || [];
  // Only the latest Search may fill the table
  const reqRef = useRef(0);
  const [loading, setLoading] = useState(false);
  // Month / Year pick the report's date range (the API still gets fromDate / toDate)
  const [month, setMonth] = useState(NOW.getMonth() + 1);
  // Year opens on the list's first year (2020), as the live page does
  const [year, setYear] = useState(YEAR_OPTIONS[0]);

  const fetchList = async () => {
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ month: String(month), year: String(year) });
      const res = await apiRequest<HawaPattiReport>(`/transactions/hawa-patti-report?${params.toString()}`);
      if (reqId !== reqRef.current) return;
      setData(res.data || null);
      // Live: a Search that finds nothing says so in a red Error toast
      if (!res.data || res.data.rows.length === 0) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'hawapatti-empty' }
        );
      }
    } catch (err: any) {
      if (reqId !== reqRef.current) return;
      console.warn('Failed to load hawa patti report:', err);
      setData(null);
      toast.error(
        <div>
          <div className="font-bold text-base">Error</div>
          <div className="text-sm mt-0.5">{err?.message || 'Failed to load report'}</div>
        </div>,
        { toastId: 'hawapatti-load' }
      );
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  };

  // Live flow: the page opens on Month with an empty table; Enter walks Month -> Year ->
  // Search, and the report loads on Search (Enter or click) with a spinner on the button.
  const [hasSearched, setHasSearched] = useState(false);
  const focusById = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  useEffect(() => {
    focusById('hawapatti-month');
  }, []);
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusById(id);
  };

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
      ['Sr,Party,HP-Party,Base-Amt,HP-%,HP-Amt,AddedBy,AddedDate'].concat(
        list.map((r, i) => `${i + 1},"${r.partyName}","${r.hpPartyName}",${fmt(r.baseAmt)},${fmtPct(r.hpPct)},${fmt(r.hpAmt)},${r.addedBy},${addedDate(r.addedAt)}`),
        [`${list.length},,,${fmt(data?.totalBase || 0)},,${fmt(data?.totalHpAmt || 0)},,`]
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
            <span className="text-slate-600 font-semibold text-[11px] ml-4">Month</span>
            <select
              id="hawapatti-month"
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value, 10))}
              onKeyDown={enterTo('hawapatti-year')}
              className="w-32 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 cursor-pointer focus:outline-none focus:bg-[#fde68a]"
            >
              {MONTH_OPTIONS.map(m => <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>)}
            </select>
            <select
              id="hawapatti-year"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              onKeyDown={enterTo('hawapatti-search-btn')}
              className="w-32 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 cursor-pointer focus:outline-none focus:bg-[#fde68a]"
            >
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button id="hawapatti-search-btn" type="submit" disabled={loading} className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
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
          <table className="w-auto min-w-[1080px] text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className={`${th} w-11`}>Sr.</th>
                <th className={`${th} w-64`}>Party</th>
                <th className={`${th} w-64`}>HP-Party</th>
                <th className={`${th} w-24 text-right`}>Base-Amt</th>
                <th className={`${th} w-20 text-right`}>HP-%</th>
                <th className={`${th} w-20 text-right`}>HP-Amt</th>
                <th className={`${th} w-28 text-center`}>AddedBy</th>
                <th className={`${th} w-32 text-center`}>AddedDate</th>
              </tr>
            </thead>
            <tbody className="font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={8} className="py-14" /></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                list.map((r, idx) => (
                  <tr key={r.voucherId} className="even:bg-slate-50/60 hover:bg-slate-50 [&>td]:border-b [&>td]:border-slate-200">
                    <td className={td}>{idx + 1}</td>
                    <td className={`${td} uppercase`}>{r.partyName}</td>
                    <td className={`${td} uppercase`}>{r.hpPartyName}</td>
                    <td className={`${td} text-right`}>{fmt(r.baseAmt)}</td>
                    <td className={`${td} text-right`}>{fmtPct(r.hpPct)}</td>
                    <td className={`${td} text-right`}>{fmt(r.hpAmt)}</td>
                    <td className={`${td} text-center uppercase`}>{r.addedBy}</td>
                    <td className={`${td} text-center`}>{addedDate(r.addedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Footer as live: row count, then the Base-Amt and HP-Amt totals */}
            {!loading && hasSearched && list.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className={th}>{list.length}</td>
                  <td className={th}>Party</td>
                  <td className={th}>HP-Party</td>
                  <td className={`${th} text-right`}>{fmt(data?.totalBase || 0)}</td>
                  <td className={`${th} text-center`}>HP-%</td>
                  <td className={`${th} text-right`}>{fmt(data?.totalHpAmt || 0)}</td>
                  <td className={`${th} text-center`}>Added By</td>
                  <td className={`${th} text-center`}>Added Date</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
