import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { DateDMYInput } from '../components/DateDMYInput.js';

const DECLARE_MODE = true;
const PAGE_TITLE = 'Declare Trans ASC';

interface DeclareTransAscPageProps {
  shifts?: ShiftDto[];
}

interface EntryAscRow {
  id: number;
  partyName: string;
  numberValue: string;
  sale: number;
  pnlAmount: number;
  rate: string;
  sHissa: number;
  oHissa: number;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);

export const DeclareTransAscPage: React.FC<DeclareTransAscPageProps> = ({ shifts = [] }) => {
  const availableShifts = useMemo(() => {
    // Only active shifts belong in this dropdown — a disabled shift (Shift Manage's
    // Enable/Disable tab) shouldn't still be selectable here.
    const activeOnly = shifts.filter(s => s.isActive !== false);
    const base = activeOnly.length > 0 ? activeOnly : shifts;
    if (!DECLARE_MODE) return base;
    const declared = base.filter(s => !!s.declaredNumber || s.status === 'DECLARED' || s.status === 'AUDITED');
    return declared.length > 0 ? declared : base;
  }, [shifts]);

  // Live: no "-- ALL SHIFTS --" choice — the dropdown opens on its first shift (index 0)
  const [shiftId, setShiftId] = useState(() => (availableShifts[0] ? String(availableShifts[0].id) : ''));
  useEffect(() => {
    // Shifts arrive after the first render: pick the first one once they're in (or if the
    // chosen one is no longer listed)
    if (availableShifts.length === 0) return;
    if (!shiftId || !availableShifts.some(s => String(s.id) === shiftId)) {
      setShiftId(String(availableShifts[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableShifts]);
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [minAmount, setMinAmount] = useState('');
  const [list, setList] = useState<EntryAscRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (shiftId) params.append('shiftId', shiftId);
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);
      if (minAmount) params.append('minAmount', minAmount);
      const res = await apiRequest<EntryAscRow[]>(`/transactions/entries/asc?${params.toString()}`);
      if (res.data) setList(res.data);
    } catch (err) {
      console.warn('Failed to load transaction ASC report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId, fromDate, toDate]);

  // Live Enter flow: the page opens on Shift; Enter walks Shift -> From DD -> MM -> YYYY ->
  // To DD -> MM -> YYYY -> Amount -> Search, and Enter on Search searches (spinner while it runs)
  const focusDasc = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  useEffect(() => {
    const id = requestAnimationFrame(() => focusDasc('dasc-shift'));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    fetchList();
  };

  const handleExportExcel = () => {
    if (list.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Party,Number,Sale,P&L Amount,Rate,S-Hissa,O-Hissa'].concat(
        list.map(r => `"${r.partyName}",${r.numberValue},${r.sale},${r.pnlAmount},${r.rate},${r.sHissa},${r.oHissa}`)
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
            <select
              id="dasc-shift"
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusDasc('dasc-from-dd'); } }}
              className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:bg-[#fef08a] focus:border-amber-300 cursor-pointer min-w-32 shadow-xs"
            >
              {availableShifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {/* DD / MM / YYYY as live; still sends YYYY-MM-DD */}
            <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="dasc-from" onEnterFromYear={() => focusDasc('dasc-to-dd')} />
            <DateDMYInput value={toDate} onChange={setToDate} idPrefix="dasc-to" onEnterFromYear={() => focusDasc('dasc-amount')} />
            <input
              id="dasc-amount"
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusDasc('dasc-search-btn'); } }}
              placeholder="ABOVE"
              className="w-24 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300 placeholder:text-slate-400 font-semibold"
            />
            <button
              id="dasc-search-btn"
              type="submit"
              disabled={loading}
              className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5"
            >
              Search
              {/* Spinner while the report loads, as on live */}
              {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            </button>
          </div>
          <button type="button" onClick={handleExportExcel} className="px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Excel
          </button>
        </form>

        {/* Scrolls inside its own box with the header and the total row pinned, as on live */}
        <div className="overflow-auto flex-1 max-h-[calc(100vh-200px)] pbmax-table-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Number</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Sale</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">P&amp;L Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Rate</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">S-Hissa</th>
                <th className="py-2.5 px-4 text-center">O-Hissa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">No entries found for this filter.</td></tr>
              ) : (
                list.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className="py-2 px-4 text-center font-mono font-bold text-blue-700 border-r border-slate-200">{r.numberValue}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-900 border-r border-slate-200">{r.sale.toLocaleString('en-IN')}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold border-r border-slate-200 ${r.pnlAmount >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                      {r.pnlAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 px-4 text-center font-mono text-slate-700 border-r border-slate-200">{r.rate}</td>
                    <td className="py-2 px-4 text-center font-mono text-slate-700 border-r border-slate-200">{r.sHissa}</td>
                    <td className="py-2 px-4 text-center font-mono text-slate-700">{r.oHissa}</td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Live total row: row count, then the Sale and P&L Amount totals (plain numbers) */}
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <td className="py-2.5 px-3 border-r border-[#223b63] text-center">{list.length}</td>
                <td className="py-2.5 px-4 border-r border-[#223b63]">Party</td>
                <td className="py-2.5 px-4 border-r border-[#223b63] text-center">Number</td>
                <td className="py-2.5 px-4 border-r border-[#223b63] text-right font-mono">{Math.round(list.reduce((t, r) => t + (r.sale || 0), 0))}</td>
                <td className="py-2.5 px-4 border-r border-[#223b63] text-right font-mono">{Math.round(list.reduce((t, r) => t + (r.pnlAmount || 0), 0))}</td>
                <td className="py-2.5 px-4 border-r border-[#223b63] text-center">Rate</td>
                <td className="py-2.5 px-4 border-r border-[#223b63] text-center">S-Hissa</td>
                <td className="py-2.5 px-4 text-center">O-Hissa</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
