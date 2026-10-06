import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { apiRequest } from '../api/client.js';

interface AttendanceRow {
  id: number;
  staffId: number;
  name: string;
  username: string;
  mobile: string | null;
  month: string;
  tDays: number;
  present: number;
  payLeave: number;
  tCount: number;
}

const CALENDAR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

export const PayrollAttendancePage: React.FC = () => {
  const now = new Date();
  const [month, setMonth] = useState(CALENDAR_MONTHS[now.getMonth()]);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [edits, setEdits] = useState<Record<number, { present: number; payLeave: number }>>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [creatingSalary, setCreatingSalary] = useState(false);

  const monthKey = () => `${year}-${String(CALENDAR_MONTHS.indexOf(month) + 1).padStart(2, '0')}`;

  const [hasSearched, setHasSearched] = useState(false);
  const fetchList = async (fromSearch = false) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const res = await apiRequest<AttendanceRow[]>(`/payroll/attendance?month=${monthKey()}`);
      // Live: a Search for a month with no attendance created says so in a red toast
      if (fromSearch && (!res.data || res.data.length === 0)) {
        setRows([]);
        setEdits({});
        toast.error(
          <div>
            <div className="font-bold text-base">Message</div>
            <div className="text-sm mt-0.5">Attendance not found!</div>
          </div>,
          { toastId: 'payatt-not-found' }
        );
      }
      if (res.data) {
        setRows(res.data);
        const e: Record<number, { present: number; payLeave: number }> = {};
        res.data.forEach(r => { e[r.id] = { present: r.present, payLeave: r.payLeave }; });
        setEdits(e);
      }
    } catch (err) {
      console.warn('Failed to load payroll attendance:', err);
    } finally {
      setLoading(false);
    }
  };

  // Live flow: the page opens on Month with an empty table; Enter walks Month -> Year ->
  // Search, and the list loads on Search (Enter or click) with a spinner on the button.
  const focusById = (id: string) => {
    (document.getElementById(id) as HTMLElement | null)?.focus();
  };
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusById(id);
  };
  useEffect(() => {
    focusById('payatt-month');
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    fetchList(true);
  };

  const handleCreateAttendance = async () => {
    setCreating(true);
    try {
      await apiRequest('/payroll/attendance', { method: 'POST', body: JSON.stringify({ month: monthKey() }) });
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Failed to create attendance');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateAttendance = async () => {
    setUpdating(true);
    try {
      for (const r of rows) {
        const edit = edits[r.id];
        if (!edit) continue;
        if (edit.present === r.present && edit.payLeave === r.payLeave) continue;
        await apiRequest(`/payroll/attendance/${r.id}`, { method: 'PATCH', body: JSON.stringify(edit) });
      }
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Failed to update attendance');
    } finally {
      setUpdating(false);
    }
  };

  const handleCreateSalary = async () => {
    if (!window.confirm(`Create salary for ${month} ${year} based on current attendance?`)) return;
    setCreatingSalary(true);
    try {
      await apiRequest('/payroll/salary', { method: 'POST', body: JSON.stringify({ month: monthKey() }) });
      alert('Salary created successfully. Check Salary Register.');
    } catch (err: any) {
      alert(err.message || 'Failed to create salary');
    } finally {
      setCreatingSalary(false);
    }
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5">
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Payroll Attendance</span>
        <form onSubmit={handleSearch} className="flex items-center gap-2.5">
          <select id="payatt-month" value={month} onChange={(e) => setMonth(e.target.value)} onKeyDown={enterTo('payatt-year')} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300">
            {CALENDAR_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select id="payatt-year" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} onKeyDown={enterTo('payatt-search-btn')} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300">
            {Array.from({ length: 8 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button id="payatt-search-btn" type="submit" disabled={loading} className="px-4 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded shadow-xs focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
            Search
            {/* Spinner while the list loads, as on live */}
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </button>
        </form>
        <button
          type="button"
          onClick={handleCreateAttendance}
          disabled={creating}
          className="ml-auto px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Attendance'}
        </button>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap sticky top-0 z-10">
                <th className="py-2 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Party</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Mobile</th>
                <th className="py-2 px-3 border-r border-[#223b63]">M/Y</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">T-Days</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Present</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Pay Leave</th>
                <th className="py-2 px-3 text-right">T-Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={8} className="py-14" /></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">No attendance for this month yet. Click Create Attendance.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-1.5 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-1.5 px-3 font-bold text-slate-900 uppercase border-r border-slate-200">{r.name} | {r.username}</td>
                    <td className="py-1.5 px-3 font-mono text-slate-700 border-r border-slate-200">{r.mobile || '-'}</td>
                    <td className="py-1.5 px-3 font-mono text-slate-700 border-r border-slate-200">{r.month}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{r.tDays}</td>
                    <td className="py-1 px-2 border-r border-slate-200">
                      <input
                        type="number"
                        value={edits[r.id]?.present ?? r.present}
                        onChange={(e) => setEdits(prev => ({ ...prev, [r.id]: { ...prev[r.id], present: parseInt(e.target.value, 10) || 0, payLeave: prev[r.id]?.payLeave ?? r.payLeave } }))}
                        className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono text-right"
                      />
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200">
                      <input
                        type="number"
                        value={edits[r.id]?.payLeave ?? r.payLeave}
                        onChange={(e) => setEdits(prev => ({ ...prev, [r.id]: { present: prev[r.id]?.present ?? r.present, payLeave: parseInt(e.target.value, 10) || 0 } }))}
                        className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono text-right"
                      />
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900">{fmt(r.tCount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-300 p-2.5 flex justify-end gap-3 bg-white">
          <button
            type="button"
            onClick={handleUpdateAttendance}
            disabled={updating || rows.length === 0}
            className="px-5 py-2 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
          >
            {updating ? 'Updating...' : 'Update Attendance'}
          </button>
          <button
            type="button"
            onClick={handleCreateSalary}
            disabled={creatingSalary || rows.length === 0}
            className="px-5 py-2 bg-[#059669] hover:bg-[#047857] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
          >
            {creatingSalary ? 'Processing...' : 'Create Salary'}
          </button>
        </div>
      </div>
    </div>
  );
};
