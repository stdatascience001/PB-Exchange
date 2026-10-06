import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface DailyReportPageProps {
  shifts?: ShiftDto[];
  onNavigate?: (page: string) => void;
}

interface AgentOption {
  id: number;
  agentName: string;
}

interface DailyReportRow {
  partyId: number;
  partyName: string;
  agentName: string;
  cap: number;
  rate: string;
  sHissa: number;
  totalSale: number;
  dSale: number;
  aSale: number;
  comm: number;
  oDara: number;
  oAkhar: number;
  tpc: number;
  hissa: number;
  debit: number;
  credit: number;
}

interface DailyReportData {
  shiftId: number;
  shiftName: string;
  partyCount: number;
  profit: number;
  rows: DailyReportRow[];
  masterTotal: {
    totalSale: number; dSale: number; aSale: number; comm: number;
    oDara: number; oAkhar: number; tpc: number; hissa: number; debit: number; credit: number;
  };
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Shift-based date: a shift's report date is its current cycle's open date, not the
// calendar day — e.g. a shift still on yesterday's cycle reports on yesterday.
const shiftCycleDate = (s?: ShiftDto) => s?.openDate || todayInputDate();
const fmt = (n: number) => (n || 0).toLocaleString('en-IN');

export const DailyReportPage: React.FC<DailyReportPageProps> = ({ shifts = [], onNavigate }) => {
  const [shiftId, setShiftId] = useState<string>('');
  const [date, setDate] = useState(todayInputDate());
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [data, setData] = useState<DailyReportData | null>(null);
  const [loading, setLoading] = useState(false);

  // Only active shifts belong in this dropdown — a disabled shift (Shift Manage's
  // Enable/Disable tab) shouldn't still be selectable here. Same guard the other shift
  // pickers use: if nothing is active, fall back to the full list rather than rendering
  // an empty dropdown.
  const availableShifts = useMemo(() => {
    const activeOnly = shifts.filter(s => s.isActive !== false);
    return activeOnly.length > 0 ? activeOnly : shifts;
  }, [shifts]);

  // First load picks the first active shift AND its cycle date together, so the report is
  // fetched once, for the right day.
  useEffect(() => {
    if (!shiftId && availableShifts.length > 0) {
      setShiftId(String(availableShifts[0].id));
      setDate(shiftCycleDate(availableShifts[0]));
    }
  }, [availableShifts]);

  // Choosing a shift moves the date to that shift's cycle date; the date box can still be
  // changed by hand afterwards to look at any other day.
  const handleShiftChange = (value: string) => {
    setShiftId(value);
    setDate(shiftCycleDate(availableShifts.find(s => String(s.id) === value)));
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<AgentOption[]>('/agents');
        if (res.data) setAgents(res.data);
      } catch {
        // ignore
      }
    })();
  }, []);

  const fetchReport = async () => {
    if (!shiftId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ shiftId, date });
      if (agentId) params.append('agentId', agentId);
      const res = await apiRequest<DailyReportData>(`/transactions/daily-report?${params.toString()}`);
      if (res.data) setData(res.data);
    } catch (err) {
      console.warn('Failed to load daily report:', err);
    } finally {
      setLoading(false);
    }
  };

  // Live flow: the page opens on Shift with an empty table; Enter walks Shift -> DD -> MM ->
  // YYYY -> Agents -> Search, and the report loads on Search (Enter or click), with a spinner
  // on the button — not on every change, which also fired mid-typing as the date was filled.
  const focusById = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusById(id);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    fetchReport();
  };

  const handleExportExcel = () => {
    if (!data || data.rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Party,Agent,Cap,Rate,S-Hissa,Total Sale,D-Sale,A-Sale,Comm,O-Dara,O-Akhar,TPC,Hissa,Debit,Credit'].concat(
        data.rows.map(r => `"${r.partyName}","${r.agentName}",${r.cap},${r.rate},${r.sHissa},${r.totalSale},${r.dSale},${r.aSale},${r.comm},${r.oDara},${r.oAkhar},${r.tpc},${r.hissa},${r.debit},${r.credit}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `daily_report_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Daily Report</span>

          <select
            id="daily-shift"
            autoFocus
            value={shiftId}
            onChange={(e) => handleShiftChange(e.target.value)}
            onKeyDown={enterTo('daily-date-dd')}
            className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
          >
            {availableShifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* DD-MM-YYYY (was the browser's MM/DD/YYYY picker); still sends YYYY-MM-DD */}
          <DateDMYInput value={date} onChange={setDate} idPrefix="daily-date" separator="-" onEnterFromYear={() => focusById('daily-agent')} />

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Agents</span>
            <select
              id="daily-agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              onKeyDown={enterTo('daily-search-btn')}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 focus:bg-[#fde68a] cursor-pointer"
            >
              <option value="">-- ALL --</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
            </select>
          </div>

          <button id="daily-search-btn" type="submit" disabled={loading} className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
            Search
            {/* Spinner while the report loads, as on live */}
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </button>

          <div className="ml-auto flex items-center gap-2.5">
            {data && (
              <>
                <span className="px-2.5 py-1 bg-slate-100 border border-slate-300 rounded text-xs font-bold text-slate-700">
                  [K = {data.partyCount}]
                </span>
                <span className={`text-xs font-bold ${data.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  Profit: {fmt(data.profit)}
                </span>
              </>
            )}
            <button type="button" onClick={handleExportExcel} className="px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors">
              Excel
            </button>
          </div>
        </form>

        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap sticky top-0 z-10">
                <th className="py-2 px-2 border-r border-[#223b63] w-10 text-center">Sr</th>
                <th className="py-2 px-2 border-r border-[#223b63] text-center">-</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Party</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Agent</th>
                <th className="py-2 px-2 border-r border-[#223b63] text-right">Cap</th>
                <th className="py-2 px-2 border-r border-[#223b63] text-center">Rate</th>
                <th className="py-2 px-2 border-r border-[#223b63] text-right">S-Hissa</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Total Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">D-Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">A-Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Comm</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">O-Dara</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">O-Akhar</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">TPC</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Hissa</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Debit</th>
                <th className="py-2 px-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={17} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !data ? (
                <tr><td colSpan={17} className="py-14" /></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={17} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                data.rows.map((r, idx) => (
                  <tr key={r.partyId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-1.5 px-2 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-1.5 px-2 text-center border-r border-slate-200">
                      <button
                        type="button"
                        onClick={() => alert(`Party-level verification isn't wired to a specific backend action yet — visual placeholder only.`)}
                        className="px-2 py-0.5 bg-[#ca8a04] hover:bg-[#a16207] text-white text-[10px] font-bold rounded shadow-xs"
                      >
                        Verify
                      </button>
                    </td>
                    <td className="py-1.5 px-3 font-bold text-slate-900 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className="py-1.5 px-3 font-semibold uppercase text-slate-700 border-r border-slate-200">{r.agentName}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.cap)}</td>
                    <td className="py-1.5 px-2 text-center font-mono text-slate-700 border-r border-slate-200">{r.rate}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-slate-700 border-r border-slate-200">{r.sHissa}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{fmt(r.totalSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.dSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.aSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-rose-700 border-r border-slate-200">{fmt(r.comm)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.oDara)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.oAkhar)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-500 border-r border-slate-200">{fmt(r.tpc)}</td>
                    <td className={`py-1.5 px-3 text-right font-mono font-bold border-r border-slate-200 ${r.hissa >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.hissa)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-rose-700 border-r border-slate-200">{r.debit > 0 ? fmt(r.debit) : ''}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-emerald-700">{r.credit > 0 ? fmt(r.credit) : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
            {data && data.rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px] sticky bottom-0">
                  <td className="py-2 px-2 text-center border-r border-[#223b63]">{data.rows.length}</td>
                  <td className="py-2 px-2 text-center border-r border-[#223b63]">-</td>
                  <td className="py-2 px-3 border-r border-[#223b63]" colSpan={5}>Master Total</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.totalSale)}</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.dSale)}</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.aSale)}</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.comm)}</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.oDara)}</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.oAkhar)}</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.tpc)}</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.hissa)}</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-[#223b63]">{fmt(data.masterTotal.debit)}</td>
                  <td className="py-2 px-3 text-right font-mono">{fmt(data.masterTotal.credit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
