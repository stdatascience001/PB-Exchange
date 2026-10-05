import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { DateDMYInput } from '../components/DateDMYInput.js';

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

  // Live flow: the page opens with the cursor on From's day and an empty table; the report
  // loads when Search is pressed (by Enter through the dates or a click) — not on every date
  // change, which would also fire mid-typing as the date parts are filled in.
  const [hasSearched, setHasSearched] = useState(false);
  useEffect(() => {
    const el = document.getElementById('att-from-dd') as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setHasSearched(true);
    fetchList();
  };

  // Excel (CSV) of the rows on screen, columns as the live report
  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['Sr.,Staff,Mobile,Address,Days,Attandance,Paid,UnPaid,Absent,Count'].concat(
      rows.map((r, i) => [i + 1, esc(r.name), esc(r.mobile), esc(r.address), r.days, r.attendance, r.paid, r.unpaid, r.absent, Math.round(r.count || 0)].join(','))
    );
    const link = document.createElement('a');
    link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n')));
    link.setAttribute('download', `staff_attandance_${fromDate}_to_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          {/* Title / labels spelled as on the live page ("Staff Attandance") */}
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Staff Attandance</span>
          <span className="text-slate-600 font-medium">From</span>
          {/* DD / MM / YYYY as live; Enter steps DD -> MM -> YYYY -> To -> Search */}
          <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="att-from" onEnterFromYear={() => { const el = document.getElementById('att-to-dd') as HTMLInputElement | null; el?.focus(); el?.select(); }} />
          <span className="text-slate-600 font-medium">To</span>
          <DateDMYInput value={toDate} onChange={setToDate} idPrefix="att-to" onEnterFromYear={() => document.getElementById('att-search-btn')?.focus()} />
          <button id="att-search-btn" type="submit" disabled={loading} className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
            Search
            {/* Spinner while the report loads, as on live */}
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </button>
          <button type="button" onClick={handleExportExcel} className="ml-auto px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Excel
          </button>
        </form>

        {/* Scrolls inside its own box with the header row pinned, as on live */}
        <div className="overflow-auto flex-1 max-h-[calc(100vh-230px)] min-h-[240px] pbmax-table-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr.</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Staff</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Mobile</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Address</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Days</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Attandance</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Paid</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">UnPaid</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Absent</th>
                <th className="py-2.5 px-4 text-right">Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={10} className="py-14" /></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">No staff found.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.staffId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.name}</td>
                    <td className="py-2 px-4 text-center font-mono text-slate-700 border-r border-slate-200">{r.mobile}</td>
                    <td className="py-2 px-4 text-center text-slate-700 uppercase border-r border-slate-200">{r.address}</td>
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
