import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';

const PAGE_TITLE = 'HawaPatti Rpt';
const VOUCHER_TYPE_FILTER: string | undefined = 'HAWA_PATTI';

interface VoucherListItem {
  id: number;
  voucherNumber: string;
  voucherType: string;
  totalAmount: number;
  narration: string | null;
  partyName: string;
  entrySide: string;
  oppositePartyName: string;
  createdByUsername: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);

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

const formatTimestamp = (dateVal?: string) => {
  if (!dateVal) return '-';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return dateVal;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day}-${month}-${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  } catch {
    return dateVal;
  }
};

export const HawaPattiRptPage: React.FC = () => {
  const [list, setList] = useState<VoucherListItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Month / Year pick the report's date range (the API still gets fromDate / toDate)
  const [month, setMonth] = useState(NOW.getMonth() + 1);
  // Year opens on the list's first year (2020), as the live page does
  const [year, setYear] = useState(YEAR_OPTIONS[0]);
  const { from: fromDate, to: toDate } = monthRange(month, year);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (VOUCHER_TYPE_FILTER) params.append('voucherType', VOUCHER_TYPE_FILTER);
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);
      const res = await apiRequest<VoucherListItem[]>(`/vouchers/manual?${params.toString()}`);
      if (res.data) setList(res.data);
      // Live: a Search that finds nothing says so in a red Error toast
      if (!res.data || res.data.length === 0) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'hawapatti-empty' }
        );
      }
    } catch (err) {
      console.warn('Failed to load vouchers:', err);
    } finally {
      setLoading(false);
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
      ['Date,Type,Party,Cr/Dr,Amount,Opposite Party,Remark'].concat(
        list.map(v => `${v.createdAt.slice(0, 10)},${v.voucherType},"${v.partyName}",${v.entrySide},${v.totalAmount},"${v.oppositePartyName}","${v.narration || ''}"`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `${PAGE_TITLE.toLowerCase().replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Date</th>
                {!VOUCHER_TYPE_FILTER && <th className="py-2.5 px-4 border-r border-[#223b63]">Type</th>}
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">Cr/Dr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Opposite Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Remark</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Added</th>
                <th className="py-2.5 px-4">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={10} className="py-14" /></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                list.map((v, idx) => (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono text-slate-600 border-r border-slate-200">{v.createdAt.slice(0, 10)}</td>
                    {!VOUCHER_TYPE_FILTER && (
                      <td className="py-2 px-4 border-r border-slate-200">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold uppercase">
                          {v.voucherType.replace(/_/g, ' ')}
                        </span>
                      </td>
                    )}
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{v.partyName}</td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${v.entrySide === 'CR' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {v.entrySide}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{v.totalAmount.toLocaleString('en-IN')}</td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{v.oppositePartyName}</td>
                    <td className="py-2 px-4 text-slate-600 border-r border-slate-200 whitespace-normal max-w-xs">{v.narration || '-'}</td>
                    <td className="py-1 px-4 border-r border-slate-200 leading-snug">
                      <div className="font-bold text-slate-900 uppercase text-[11px]">{v.createdByUsername}</div>
                      <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(v.createdAt)}</div>
                    </td>
                    <td className="py-1 px-4 leading-snug">
                      <div className="font-bold text-slate-900 uppercase text-[11px]">{v.updatedBy}</div>
                      <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(v.updatedAt)}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
