import React, { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface ProductivityShiftPageProps {
  onNavigate?: (page: string) => void;
}

interface ProductivityShiftRow {
  staffId: number;
  name: string;
  mobile: string;
  address: string;
  role: string;
  username: string;
  tCount: number;
  perShift: Record<string, number>;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

export const ProductivityShiftPage: React.FC<ProductivityShiftPageProps> = ({ onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [rows, setRows] = useState<ProductivityShiftRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      const res = await apiRequest<ProductivityShiftRow[]>(`/transactions/productivity-shift?${params.toString()}`);
      if (res.data) setRows(res.data);
    } catch (err) {
      console.warn('Failed to load productivity shift report:', err);
    } finally {
      setLoading(false);
    }
  };

  // Live flow: the page opens with the cursor on From's day and an empty table; Enter walks
  // From DD -> MM -> YYYY -> To DD -> MM -> YYYY -> Search, and the report loads on Search
  // (Enter or click) with a spinner on the button.
  const [hasSearched, setHasSearched] = useState(false);
  const focusById = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  useEffect(() => {
    focusById('prodshift-fromDate-dd');
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setHasSearched(true);
    fetchList();
  };

  // Columns are built dynamically from whatever shift names actually appear in the data —
  // no market list is hardcoded, so this naturally matches whatever shifts exist in the DB.
  const shiftColumns = useMemo(() => {
    const names = new Set<string>();
    rows.forEach(r => Object.keys(r.perShift).forEach(n => names.add(n)));
    return Array.from(names).sort();
  }, [rows]);

  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const header = ['Name', 'Mobile', 'Address', 'Role', 'User', 'T-Count', ...shiftColumns].join(',');
    const csvContent = 'data:text/csv;charset=utf-8,' +
      [header].concat(
        rows.map(r => [`"${r.name}"`, `"${r.mobile}"`, `"${r.address}"`, `"${r.role}"`, `"${r.username}"`, r.tCount, ...shiftColumns.map(c => r.perShift[c] || 0)].join(','))
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'productivity_shift.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalTCount = rows.reduce((s, r) => s + r.tCount, 0);

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
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Productivity Shift</span>
            <span className="text-slate-600 font-medium">From</span>
            <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="prodshift-fromDate" separator="-" onEnterFromYear={() => focusById('prodshift-toDate-dd')} />
            <span className="text-slate-600 font-medium">To</span>
            <DateDMYInput value={toDate} onChange={setToDate} idPrefix="prodshift-toDate" separator="-" onEnterFromYear={() => focusById('prodshift-search-btn')} />
            <button id="prodshift-search-btn" type="submit" disabled={loading} className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
              Search
              {/* Spinner while the report loads, as on live */}
              {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
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
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">SR</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Name</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Mobile</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Address</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Role</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">User</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">T-Count</th>
                {shiftColumns.map(c => (
                  <th key={c} className="py-2.5 px-4 border-r border-[#223b63] text-right">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={7 + shiftColumns.length} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={7 + shiftColumns.length} className="py-14" /></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7 + shiftColumns.length} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.staffId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.name}</td>
                    <td className="py-2 px-4 font-mono text-slate-700 border-r border-slate-200">{r.mobile}</td>
                    <td className="py-2 px-4 text-slate-700 uppercase border-r border-slate-200">{r.address}</td>
                    <td className="py-2 px-4 text-slate-700 uppercase border-r border-slate-200">{r.role}</td>
                    <td className="py-2 px-4 font-semibold text-slate-800 uppercase border-r border-slate-200">{r.username}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{fmt(r.tCount)}</td>
                    {shiftColumns.map(c => (
                      <td key={c} className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.perShift[c] || 0)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td colSpan={6} className="py-2 px-4 border-r border-[#223b63]">Total ({rows.length})</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(totalTCount)}</td>
                  {shiftColumns.map(c => (
                    <td key={c} className="py-2 px-4 text-right font-mono border-r border-[#223b63]">
                      {fmt(rows.reduce((s, r) => s + (r.perShift[c] || 0), 0))}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
