import React, { useState, useEffect } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';

interface PlBeforeAfterDeclarePageProps {
  shifts?: ShiftDto[];
}

interface PlRow {
  date: string;
  shiftName: string;
  result: string;
  saleBefore: number;
  saleAfter: number;
  saleDiff: number;
  plBefore: number;
  plAfter: number;
  plDiff: number;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

export const PlBeforeAfterDeclarePage: React.FC<PlBeforeAfterDeclarePageProps> = ({ shifts = [] }) => {
  const [shiftId, setShiftId] = useState('');
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [rows, setRows] = useState<PlRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      if (shiftId) params.append('shiftId', shiftId);
      const res = await apiRequest<PlRow[]>(`/transactions/pl-before-after-declare?${params.toString()}`);
      if (res.data) setRows(res.data);
    } catch (err) {
      console.warn('Failed to load P&L before/after declare:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId, fromDate, toDate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchList();
  };

  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Date,Shift,Result,S-Before,S-After,S-Diff,PL-Before,PL-After,PL-Diff'].concat(
        rows.map(r => `${r.date},"${r.shiftName}",${r.result},${r.saleBefore},${r.saleAfter},${r.saleDiff},${r.plBefore},${r.plAfter},${r.plDiff}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'pl_before_after_declare.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">P&amp;L Before-After Declare</span>
            <select
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
            >
              <option value="">-- ALL SHIFT --</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <button type="submit" className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors">
              Search (F5)
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
                <th className="py-2.5 px-4 border-r border-[#223b63]">Shift</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Result</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">S-Before</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">S-After</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">S-Diff</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">PL-Before</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">PL-After</th>
                <th className="py-2.5 px-4 text-right">PL-Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">No declared shifts found for this filter.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={`${r.date}-${r.shiftName}`} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono text-slate-700 border-r border-slate-200">{r.date.split('-').reverse().join('-')}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.shiftName}</td>
                    <td className="py-2 px-4 text-center font-mono font-bold text-blue-800 border-r border-slate-200">{r.result}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.saleBefore)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.saleAfter)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.saleDiff)}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold border-r border-slate-200 ${r.plBefore >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.plBefore)}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold border-r border-slate-200 ${r.plAfter >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.plAfter)}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900">{fmt(r.plDiff)}</td>
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
