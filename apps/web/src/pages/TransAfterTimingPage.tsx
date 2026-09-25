import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';

interface TransAfterTimingRow {
  id: number;
  date: string;
  shiftName: string;
  partyName: string;
  status: string;
  amount: number;
  addedBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  allowTill: string | null;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

const formatTimestamp = (val: string | null) => {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}-${d.getFullYear()} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
};

export const TransAfterTimingPage: React.FC = () => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [rows, setRows] = useState<TransAfterTimingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [errorToast, setErrorToast] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const res = await apiRequest<TransAfterTimingRow[]>(`/transactions/after-timing?${params.toString()}`);
      const data = res.data || [];
      setRows(data);
      setSearched(true);
      if (data.length === 0) {
        setErrorToast(true);
        setTimeout(() => setErrorToast(false), 3000);
      }
    } catch (err) {
      console.warn('Failed to load trans after timing:', err);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

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
      ['Date,Shift,Party,Status,Amount,Added,Updated,Allow Till'].concat(
        rows.map(r => `${r.date},"${r.shiftName}","${r.partyName}",${r.status},${r.amount},"${r.addedBy}","${r.updatedBy}","${r.allowTill || ''}"`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'trans_after_timing.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs relative">
      {errorToast && (
        <div className="absolute top-2 right-2 z-50 bg-[#b91c1c] text-white rounded shadow-lg px-4 py-2.5 w-64 animate-in fade-in duration-150">
          <div className="font-bold text-sm">Error</div>
          <div className="text-xs mt-0.5">Record not avaliable!</div>
        </div>
      )}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Trans After Timing</span>
            <span className="text-slate-600 font-medium">From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <span className="text-slate-600 font-medium">To</span>
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
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr.</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Date</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Shift</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Status</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Added</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Updated</th>
                <th className="py-2.5 px-4">Allow Till</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">{searched ? 'No records found for this filter.' : 'Choose a date range and Search.'}</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono text-slate-700 border-r border-slate-200">{r.date.split('-').reverse().join('-')}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.shiftName}</td>
                    <td className="py-2 px-4 font-semibold text-slate-800 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{fmt(r.amount)}</td>
                    <td className="py-1 px-4 border-r border-slate-200 leading-snug">
                      <div className="font-bold text-slate-900 uppercase text-[11px]">{r.addedBy}</div>
                      <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(r.createdAt)}</div>
                    </td>
                    <td className="py-1 px-4 border-r border-slate-200 leading-snug">
                      <div className="font-bold text-slate-900 uppercase text-[11px]">{r.updatedBy}</div>
                      <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(r.updatedAt)}</div>
                    </td>
                    <td className="py-2 px-4 font-mono text-slate-700">{formatTimestamp(r.allowTill)}</td>
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
