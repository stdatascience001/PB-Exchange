import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';

interface StaffAttendanceRow {
  staffId: number;
  name: string;
  mobile: string;
  address: string;
  days: number;
  attendance: number;
  paid: number;
  unpaid: number;
  absent: number;
  count: number;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

export const StaffAttendancePage: React.FC = () => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [rows, setRows] = useState<StaffAttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const res = await apiRequest<StaffAttendanceRow[]>(`/payroll/staff-attendance?${params.toString()}`);
      if (res.data) setRows(res.data);
    } catch (err) {
      console.warn('Failed to load staff attendance:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchList();
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Staff Attendance</span>
          <span className="text-slate-600 font-medium">From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
          <span className="text-slate-600 font-medium">To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
          <button type="submit" className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Search
          </button>
        </form>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Staff</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Mobile</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Address</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Days</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Attendance</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Paid</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">UnPaid</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Absent</th>
                <th className="py-2.5 px-4 text-right">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">No staff found.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.staffId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.name}</td>
                    <td className="py-2 px-4 font-mono text-slate-700 border-r border-slate-200">{r.mobile}</td>
                    <td className="py-2 px-4 text-slate-700 uppercase border-r border-slate-200">{r.address}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{r.days}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-emerald-700 border-r border-slate-200">{r.attendance}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{r.paid}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{r.unpaid}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-rose-700 border-r border-slate-200">{r.absent}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900">{fmt(r.count)}</td>
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
