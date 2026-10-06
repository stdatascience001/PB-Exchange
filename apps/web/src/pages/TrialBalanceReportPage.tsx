import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { DateDMYInput } from '../components/DateDMYInput.js';

const PAGE_TITLE = 'Trail Balance Report';

// GET /transactions/trial-balance?date= (TransactionService.getTrialBalance)
interface TrialRow {
  ledgerId: number;
  partyName: string;
  limit: number;
  amount: number;
}

interface TrialData {
  credit: TrialRow[];
  debit: TrialRow[];
  totalCredit: number;
  totalDebit: number;
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, as the live report prints them (36410, 37735796336).
const fmt = (n: number) => String(Math.round(n || 0));

const messageToast = (text: string, toastId: string) =>
  toast.error(
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    { toastId }
  );

// One side of the report (Credit or Debit): its own scroll, sticky header and footer.
const SideTable: React.FC<{ label: 'Credit' | 'Debit'; rows: TrialRow[]; total: number }> = ({ label, rows, total }) => {
  const th = 'py-2.5 px-3 border-r border-[#223b63]';
  return (
    <div className="flex-1 min-w-[320px] max-w-[660px] overflow-y-auto max-h-[calc(100vh-215px)] border border-slate-200">
      <table className="w-full text-left text-xs border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#152847] text-white font-bold text-[12px] whitespace-nowrap">
            <th className={`${th} w-16`}>Sr.</th>
            <th className={th}>Party Name</th>
            <th className="py-2.5 px-3 w-36 text-right">{label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.ledgerId} className="even:bg-slate-50/60 hover:bg-slate-50 [&>td]:border-b [&>td]:border-slate-200">
              <td className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-200">{i + 1}</td>
              <td className="py-1.5 px-3 border-r border-slate-200">
                <div className="font-semibold text-slate-700 uppercase">{r.partyName}</div>
                <div className="text-[9px] text-rose-600 font-semibold leading-tight">LIMIT: {fmt(r.limit)}</div>
              </td>
              <td className="py-2 px-3 text-right font-semibold text-slate-700">{fmt(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot className="sticky bottom-0 z-10">
            <tr className="bg-[#152847] text-white font-bold text-[12px]">
              <td className={th}>{rows.length}</td>
              <td className={th}>Party Name</td>
              <td className="py-2.5 px-3 text-right">{fmt(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

export const TrialBalanceReportPage: React.FC = () => {
  const [date, setDate] = useState(todayInputDate());
  const [data, setData] = useState<TrialData | null>(null);
  const [loading, setLoading] = useState(false);

  // Live page opens empty and loads only on Search (or F5 = Reload List).
  const fetchList = async () => {
    if (!date) return messageToast('Please select Date!', 'trial-date');
    setLoading(true);
    try {
      const res = await apiRequest<TrialData>(`/transactions/trial-balance?date=${encodeURIComponent(date)}`);
      setData(res.data || null);
    } catch (err: any) {
      console.warn('Failed to load trial balance:', err);
      messageToast(err.message || 'Failed to load trial balance', 'trial-load');
    } finally {
      setLoading(false);
    }
  };

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
  }, [date]);

  // Live keyboard flow: the page opens with the cursor on the date's day; Enter walks DD ->
  // MM -> YYYY -> Search, whose Enter loads the list (spinner on the button).
  useEffect(() => {
    const el = document.getElementById('trial-date-dd') as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    fetchList();
  };

  const handleExportExcel = () => {
    if (!data || (data.credit.length === 0 && data.debit.length === 0)) {
      messageToast('Record not found!', 'trial-excel');
      return;
    }
    const lines = ['Side,Sr,Party Name,Limit,Amount'];
    data.credit.forEach((r, i) => lines.push(`Credit,${i + 1},"${r.partyName}",${fmt(r.limit)},${fmt(r.amount)}`));
    lines.push(`Credit,Total,,,${fmt(data.totalCredit)}`);
    data.debit.forEach((r, i) => lines.push(`Debit,${i + 1},"${r.partyName}",${fmt(r.limit)},${fmt(r.amount)}`));
    lines.push(`Debit,Total,,,${fmt(data.totalDebit)}`);
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI('data:text/csv;charset=utf-8,' + lines.join('\n')));
    link.setAttribute('download', `trail_balance_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-700 tracking-tight mx-3">{PAGE_TITLE}</span>
          <span className="text-slate-600 font-semibold text-[11px] ml-4">From</span>
          <DateDMYInput value={date} onChange={setDate} idPrefix="trial-date" separator="-" onEnterFromYear={() => document.getElementById('trial-search-btn')?.focus()} />
          <button
            id="trial-search-btn"
            type="submit"
            disabled={loading}
            className="px-10 py-1.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded-xs shadow-xs transition-colors inline-flex items-center gap-1.5 disabled:opacity-90 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            Search
            {loading && <span className="inline-block w-3.5 h-3.5 border-2 border-white border-r-transparent rounded-full animate-spin" />}
          </button>
          <button type="button" onClick={handleExportExcel} className="ml-auto px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded-xs shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="flex-1 p-1 flex flex-wrap gap-3 items-start">
          <SideTable label="Credit" rows={data?.credit || []} total={data?.totalCredit || 0} />
          <SideTable label="Debit" rows={data?.debit || []} total={data?.totalDebit || 0} />
        </div>
      </div>
      <div className="mt-2 px-1 text-[11px] text-slate-600">[F5 = Reload List]</div>
    </div>
  );
};
