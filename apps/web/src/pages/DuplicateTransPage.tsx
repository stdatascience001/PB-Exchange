import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto, UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { FileSpreadsheet, Eye, Trash2, CheckCircle2 } from 'lucide-react';

interface DuplicateTransItem {
  sr: number;
  id: number;
  party: string;
  shift: string;
  date: string;
  amount: number;
  dCount: number;
  // Every slip in the group, newest first — lets a row act on the repeats without a re-fetch.
  transactionIds?: number[];
}

interface DuplicateTransPageProps {
  shifts?: ShiftDto[];
  user?: UserSession | null;
}

export const DuplicateTransPage: React.FC<DuplicateTransPageProps> = ({ shifts = [] }) => {
  const [list, setList] = useState<DuplicateTransItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  // Was a hardcoded "10 / 09 / 2026" label in a plain div that never reached the query, so the
  // report ignored whatever date was on screen. Now a real filter, held as YYYY-MM-DD.
  const [dateStr, setDateStr] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Only active shifts belong in this dropdown — the same guard the other shift pickers use.
  // "-- ALL --" still spans every shift, so nothing becomes unreachable.
  const availableShifts = useMemo(() => {
    const activeOnly = shifts.filter(s => s.isActive !== false);
    return activeOnly.length > 0 ? activeOnly : shifts;
  }, [shifts]);

  const fetchDuplicates = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedShiftId) params.append('shiftId', selectedShiftId);
      if (dateStr) params.append('date', dateStr);

      const res = await apiRequest<DuplicateTransItem[]>(`/transactions/duplicates?${params.toString()}`);
      if (res.data) {
        setList(res.data);
      }
    } catch (err) {
      console.warn('Failed to load duplicate transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDuplicates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShiftId, dateStr]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDuplicates();
  };

  // The live report's row action is Delete. A row stands for a GROUP of identical slips, so
  // this clears the repeats and leaves the original standing — spelled out in the confirm so
  // nothing is removed by surprise.
  const handleDelete = async (r: DuplicateTransItem) => {
    const ids = r.transactionIds && r.transactionIds.length > 0 ? r.transactionIds : [r.id];
    const extras = ids.slice(0, -1); // every slip except the earliest
    if (extras.length === 0) return;
    const ok = window.confirm(
      `${r.party} — ${r.shift} — ${r.date}\n` +
      `${r.dCount} identical slips of ${r.amount.toLocaleString('en-IN')}.\n\n` +
      `Delete ${extras.length} duplicate slip${extras.length > 1 ? 's' : ''} and keep the original?`
    );
    if (!ok) return;
    try {
      for (const id of extras) {
        await apiRequest(`/transactions/${id}`, { method: 'DELETE' });
      }
      await fetchDuplicates();
    } catch (err: any) {
      alert(err.message || 'Failed to delete duplicate transactions');
    }
  };

  const handleExportExcel = () => {
    if (list.length === 0) {
      alert('No duplicate records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Sr,Party,Shift,Date,Amount,D-Count'].concat(
        list.map(r => `${r.sr},"${r.party}","${r.shift}",${r.date},${r.amount},${r.dCount}`)
      ).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `duplicate_trans_${dateStr.replace(/\s|\//g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      {/* Outer Card matching pbmax1.com Screenshot 4 */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        {/* Subheader Filter Bar matching Screenshot 4 */}
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">
              Duplicate Trans
            </span>

            {/* Shift select with soft yellow background matching Screenshot 4 */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-600 font-medium text-xs">Shift</span>
              <select
                value={selectedShiftId}
                onChange={(e) => setSelectedShiftId(e.target.value)}
                className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
              >
                <option value="">-- ALL --</option>
                {availableShifts.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-600 font-medium text-xs">Date</span>
              <input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-700 tracking-wider focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
              />
            </div>

            {/* Search Teal Button */}
            <button
              type="submit"
              className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Search
            </button>
          </div>

          {/* Excel Green Button on Right matching Screenshot 4 */}
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <span>Excel</span>
          </button>
        </form>

        {/* 7-Column Table matching Screenshot 4 */}
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr.</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Shift</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Date</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center w-24">D-Count</th>
                <th className="py-2.5 px-4 text-center w-28">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400 font-medium">
                    Checking for duplicate transactions...
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400 font-medium">
                    No duplicate transactions detected.
                  </td>
                </tr>
              ) : (
                list.map((r, idx) => (
                  <tr key={r.id || idx} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">
                      {idx + 1}
                    </td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">
                      {r.party}
                    </td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">
                      {r.shift}
                    </td>
                    <td className="py-2 px-4 text-center font-mono text-slate-600 border-r border-slate-200">
                      {r.date}
                    </td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                      ₹{r.amount.toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded-full text-[10px]">
                        {r.dCount}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleDelete(r)}
                        className="px-3 py-1 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-[10px] rounded shadow-xs"
                      >
                        Delete
                      </button>
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
