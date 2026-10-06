import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { PartyPicker } from '../components/PartyPicker.js';

interface SalaryRow {
  id: number;
  staffId: number;
  name: string;
  month: string;
  tDays: number;
  presentDays: number;
  payLeaveDays: number;
  netSalary: number;
  status: 'PENDING' | 'PAID';
  paidAt: string | null;
}

const CALENDAR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (n: number) => Math.round(n || 0).toLocaleString('en-IN');

export const SalaryRegisterPage: React.FC = () => {
  const now = new Date();
  const [fromMonth, setFromMonth] = useState(CALENDAR_MONTHS[now.getMonth()]);
  const [fromYear, setFromYear] = useState(now.getFullYear());
  const [toMonth, setToMonth] = useState(CALENDAR_MONTHS[now.getMonth()]);
  const [toYear, setToYear] = useState(now.getFullYear());
  const [agentSearch, setAgentSearch] = useState('');
  const [rows, setRows] = useState<SalaryRow[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);

  const monthKey = (m: string, y: number) => `${y}-${String(CALENDAR_MONTHS.indexOf(m) + 1).padStart(2, '0')}`;

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromMonth: monthKey(fromMonth, fromYear), toMonth: monthKey(toMonth, toYear) });
      if (agentSearch.trim()) params.append('search', agentSearch.trim());
      const res = await apiRequest<SalaryRow[]>(`/payroll/salary-register?${params.toString()}`);
      if (res.data) setRows(res.data);
      setChecked(new Set());
    } catch (err) {
      console.warn('Failed to load salary register:', err);
    } finally {
      setLoading(false);
    }
  };

  // Staff for the Choose Agent box — typing lists the names that start with the text
  // (arrows + Enter / click pick one), as on live
  const [staffList, setStaffList] = useState<{ id: number; fullName: string }[]>([]);
  useEffect(() => {
    apiRequest<{ id: number; fullName: string }[]>('/staff')
      .then(res => { if (res.data) setStaffList(res.data); })
      .catch(err => console.warn('Failed to load staff:', err));
  }, []);
  const agentOptions = useMemo(
    () => staffList.filter(s => s.fullName).map(s => ({ id: s.id, partyName: s.fullName }) as unknown as LedgerDto),
    [staffList]
  );
  const agentRef = useRef<HTMLInputElement>(null);

  // Live flow: the page opens on From's month with an empty table; Enter walks From Month ->
  // Year -> To Month -> Year -> Choose Agent -> Search, and the list loads on Search (Enter or
  // click) with a spinner on the button.
  const [hasSearched, setHasSearched] = useState(false);
  const focusById = (id: string) => {
    (document.getElementById(id) as HTMLElement | null)?.focus();
  };
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusById(id);
  };
  useEffect(() => {
    focusById('salreg-fromMonth');
  }, []);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setHasSearched(true);
    fetchList();
  };

  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Staff,Month,T-Days,Present,Pay Leave,Net Salary,Status'].concat(
        rows.map(r => `"${r.name}",${r.month},${r.tDays},${r.presentDays},${r.payLeaveDays},${r.netSalary},${r.status}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'salary_register.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleCheck = (id: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handlePaidSalaryProcess = async () => {
    const ids = Array.from(checked);
    if (ids.length === 0) {
      alert('Please check at least one row.');
      return;
    }
    setProcessing(true);
    try {
      await apiRequest('/payroll/salary-register/pay', { method: 'POST', body: JSON.stringify({ ids }) });
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Failed to process salary payment');
    } finally {
      setProcessing(false);
    }
  };

  const totalNet = rows.reduce((s, r) => s + r.netSalary, 0);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Salary Register</span>
            <span className="text-slate-600 font-medium">From</span>
            <select id="salreg-fromMonth" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} onKeyDown={enterTo('salreg-fromYear')} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300">
              {CALENDAR_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select id="salreg-fromYear" value={fromYear} onChange={(e) => setFromYear(parseInt(e.target.value, 10))} onKeyDown={enterTo('salreg-toMonth')} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300">
              {Array.from({ length: 8 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-slate-600 font-medium">To</span>
            <select id="salreg-toMonth" value={toMonth} onChange={(e) => setToMonth(e.target.value)} onKeyDown={enterTo('salreg-toYear')} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300">
              {CALENDAR_MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select id="salreg-toYear" value={toYear} onChange={(e) => setToYear(parseInt(e.target.value, 10))} onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); agentRef.current?.focus(); agentRef.current?.select(); }} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300">
              {Array.from({ length: 8 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className="w-44">
              <PartyPicker
                parties={agentOptions}
                value={agentSearch}
                onChange={setAgentSearch}
                onPick={(p) => { setAgentSearch(p.partyName); focusById('salreg-search-btn'); }}
                onInvalid={() => focusById('salreg-search-btn')}
                inputRef={agentRef}
                placeholder="Choose Agent"
                className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 uppercase placeholder:normal-case placeholder:text-slate-400 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
              />
            </div>
            <button id="salreg-search-btn" type="submit" disabled={loading} className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
              Search
              {/* Spinner while the list loads, as on live */}
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
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] w-10 text-center"></th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Staff</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Month</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">T-Days</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Present</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Pay Leave</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Net Salary</th>
                <th className="py-2.5 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={9} className="py-14" /></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">No salary records found for this filter.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-3 text-center border-r border-slate-200">
                      <input type="checkbox" checked={checked.has(r.id)} disabled={r.status === 'PAID'} onChange={() => toggleCheck(r.id)} />
                    </td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.name}</td>
                    <td className="py-2 px-4 font-mono text-slate-700 border-r border-slate-200">{r.month}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{r.tDays}</td>
                    <td className="py-2 px-4 text-right font-mono text-emerald-700 border-r border-slate-200">{r.presentDays}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{r.payLeaveDays}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{fmt(r.netSalary)}</td>
                    <td className="py-2 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td colSpan={7} className="py-2 px-4 border-r border-[#223b63]">Total ({rows.length})</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(totalNet)}</td>
                  <td className="py-2 px-4"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="pt-2.5 flex justify-end">
        <button
          type="button"
          onClick={handlePaidSalaryProcess}
          disabled={processing || checked.size === 0}
          className="px-5 py-2 bg-[#059669] hover:bg-[#047857] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
        >
          {processing ? 'Processing...' : 'Paid Salary Process'}
        </button>
      </div>
    </div>
  );
};
