import React, { useState, useEffect } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';

interface TpcReportPageProps {
  shifts?: ShiftDto[];
}

interface PartyCollectionRow {
  partyId: number;
  partyName: string;
  totalAmount: number;
  slipCount: number;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);

export const TpcReportPage: React.FC<TpcReportPageProps> = ({ shifts = [] }) => {
  const [list, setList] = useState<PartyCollectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [shiftId, setShiftId] = useState('');
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (shiftId) params.append('shiftId', shiftId);
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);
      const res = await apiRequest<PartyCollectionRow[]>(`/transactions/party-collection-totals?${params.toString()}`);
      if (res.data) setList(res.data);
    } catch (err) {
      console.warn('Failed to load TPC report:', err);
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
    if (list.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Party,Total Amount,Slip Count'].concat(
        list.map(r => `"${r.partyName}",${r.totalAmount},${r.slipCount}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'tpc_report.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const grandTotal = list.reduce((s, r) => s + r.totalAmount, 0);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">TPC Report</span>
            <select
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
            >
              <option value="">-- ALL SHIFTS --</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
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
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Total Amount</th>
                <th className="py-2.5 px-4 text-center">Slip Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={4} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={4} className="py-14 text-center text-slate-400 font-medium">No collections found for this filter.</td></tr>
              ) : (
                list.map((r, idx) => (
                  <tr key={r.partyId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{r.totalAmount.toLocaleString('en-IN')}</td>
                    <td className="py-2 px-4 text-center font-mono text-slate-700">{r.slipCount}</td>
                  </tr>
                ))
              )}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td className="py-2 px-3 text-center border-r border-[#223b63]">{list.length}</td>
                  <td className="py-2 px-4 border-r border-[#223b63]">Total</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{grandTotal.toLocaleString('en-IN')}</td>
                  <td className="py-2 px-4"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
