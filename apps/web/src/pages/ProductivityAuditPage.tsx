import React, { useState, useEffect } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';

interface ProductivityAuditPageProps {
  shifts?: ShiftDto[];
  onNavigate?: (page: string) => void;
}

interface ProductivityAuditRow {
  staffId: number;
  name: string;
  mobile: string;
  address: string;
  role: string;
  tParty: number;
  tCount: number;
  valid: number;
  mistake: number;
  modify: number;
  tAmount: number;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

export const ProductivityAuditPage: React.FC<ProductivityAuditPageProps> = ({ shifts = [], onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [shiftId, setShiftId] = useState('');
  const [rows, setRows] = useState<ProductivityAuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      if (shiftId) params.append('shiftId', shiftId);
      const res = await apiRequest<ProductivityAuditRow[]>(`/transactions/productivity-audit?${params.toString()}`);
      if (res.data) setRows(res.data);
    } catch (err) {
      console.warn('Failed to load productivity audit:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, shiftId]);

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
      ['Name,Mobile,Address,User Type,T-Party,T-Count,Valid,Mistake,Modify,T-Amount'].concat(
        rows.map(r => `"${r.name}","${r.mobile}","${r.address}","${r.role}",${r.tParty},${r.tCount},${r.valid},${r.mistake},${r.modify},${r.tAmount}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'productivity_audit.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            {onNavigate && (
              <button type="button" onClick={() => onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Productivity Audit</span>
            <span className="text-slate-600 font-medium">From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <span className="text-slate-600 font-medium">To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <select
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
            >
              <option value="">ALL</option>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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
                <th className="py-2.5 px-4 border-r border-[#223b63]">Name</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Mobile</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Address</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">User Type</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">T-Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">T-Count</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Valid</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Mistake</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Modify</th>
                <th className="py-2.5 px-4 text-right">T-Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={11} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.staffId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.name}</td>
                    <td className="py-2 px-4 font-mono text-slate-700 border-r border-slate-200">{r.mobile}</td>
                    <td className="py-2 px-4 text-slate-700 uppercase border-r border-slate-200">{r.address}</td>
                    <td className="py-2 px-4 text-slate-700 uppercase border-r border-slate-200">{r.role}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.tParty)}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{fmt(r.tCount)}</td>
                    <td className="py-2 px-4 text-right font-mono text-emerald-700 border-r border-slate-200">{fmt(r.valid)}</td>
                    <td className="py-2 px-4 text-right font-mono text-rose-700 border-r border-slate-200">{fmt(r.mistake)}</td>
                    <td className="py-2 px-4 text-right font-mono text-amber-700 border-r border-slate-200">{fmt(r.modify)}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900">{fmt(r.tAmount)}</td>
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
