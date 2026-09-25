import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';

const DECLARE_MODE = false;
const PAGE_TITLE = 'Transaction ASC';

interface TransactionAscPageProps {
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

export const TransactionAscPage: React.FC<TransactionAscPageProps> = ({ shifts = [] }) => {
  const availableShifts = useMemo(() => {
    // Only active shifts belong in this dropdown — a disabled shift (Shift Manage's
    // Enable/Disable tab) shouldn't still be selectable here.
    const activeOnly = shifts.filter(s => s.isActive !== false);
    const base = activeOnly.length > 0 ? activeOnly : shifts;
    if (!DECLARE_MODE) return base;
    const declared = base.filter(s => !!s.declaredNumber || s.status === 'DECLARED' || s.status === 'AUDITED');
    return declared.length > 0 ? declared : base;
  }, [shifts]);

  const [shiftId, setShiftId] = useState('');
  // Live bar has a single "Date" — the report is for that one day, so it's sent as both
  // fromDate and toDate (the API's date-range filter is unchanged).
  const [reportDate, setReportDate] = useState(todayInputDate());
  const fromDate = reportDate;
  const toDate = reportDate;

  // Picking a shift sets Date to that shift's own open_date (its live cycle — e.g. an
  // undeclared HYDRABAD NIGHT still on 23-09), same as Transaction List. Once per selected
  // shift, so a date typed in by hand afterwards is left alone.
  const dateSyncedForShiftRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shiftId || dateSyncedForShiftRef.current === shiftId) return;
    const shift = shifts.find(s => String(s.id) === shiftId);
    if (!shift?.openDate) return;
    dateSyncedForShiftRef.current = shiftId;
    if (/^\d{4}-\d{2}-\d{2}$/.test(shift.openDate)) setReportDate(shift.openDate);
  }, [shiftId, shifts]);
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

  // Live flow: pick the filters, then press Search — the report only loads on Search (it no
  // longer reloads on its own whenever Shift or Date changes, or on page open).
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setHasSearched(true);
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
            <div className="flex items-center gap-1.5">
              <span className="text-slate-600 font-medium text-xs">Shift</span>
              <select
                value={shiftId}
                onChange={(e) => setShiftId(e.target.value)}
                className="px-3 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer min-w-40 shadow-xs"
              >
                <option value="">-- ALL SHIFTS --</option>
                {availableShifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-600 font-medium text-xs">Date</span>
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-600 font-medium text-xs">Amount</span>
              <input
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="ABOVE"
                className="w-32 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:border-blue-500 placeholder:text-slate-400 font-semibold"
              />
            </div>
            <button type="submit" className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors">
              Search
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
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">{hasSearched ? 'No entries found for this filter.' : 'Select Shift and Date, then click Search.'}</td></tr>
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
            {/* Footer row as on the live report: row count, the column names again, and the
                Sale / P&L Amount totals of the rows listed. Shown only when there are rows. */}
            {!loading && list.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className="py-2.5 px-3 border-r border-[#223b63] text-center">{list.length}</td>
                  <td className="py-2.5 px-4 border-r border-[#223b63]">Party</td>
                  <td className="py-2.5 px-4 border-r border-[#223b63] text-center">Number</td>
                  <td className="py-2.5 px-4 border-r border-[#223b63] text-right font-mono">
                    {list.reduce((sum, r) => sum + (r.sale || 0), 0).toLocaleString('en-IN')}
                  </td>
                  <td className="py-2.5 px-4 border-r border-[#223b63] text-right font-mono">
                    {list.reduce((sum, r) => sum + (r.pnlAmount || 0), 0).toLocaleString('en-IN')}
                  </td>
                  <td className="py-2.5 px-4 border-r border-[#223b63] text-center">Rate</td>
                  <td className="py-2.5 px-4 border-r border-[#223b63] text-center">S-Hissa</td>
                  <td className="py-2.5 px-4 text-center">O-Hissa</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
