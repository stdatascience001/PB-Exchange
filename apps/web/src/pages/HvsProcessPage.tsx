import React, { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';

interface HvsProcessPageProps {
  onNavigate?: (page: string) => void;
}

interface AgentDto {
  id: number;
  agentName: string;
}

interface HvsRow {
  partyId: number;
  partyName: string;
  agentName: string;
  mobile: string;
  pnl: number;
  total: number;
  closing: number;
  tSettleAmt: number;
}

const CALENDAR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_INDEX: Record<string, number> = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 };
const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(Math.abs(n || 0)).toLocaleString('en-IN');

function monthRange(month: string, year: number) {
  const m = MONTH_INDEX[month] ?? new Date().getMonth();
  const from = new Date(Date.UTC(year, m, 1));
  const to = new Date(Date.UTC(year, m + 1, 0));
  return { fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) };
}

export const HvsProcessPage: React.FC<HvsProcessPageProps> = ({ onNavigate }) => {
  const now = new Date();
  const [month, setMonth] = useState(CALENDAR_MONTHS[now.getMonth()]);
  const [year, setYear] = useState(now.getFullYear());
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [agentId, setAgentId] = useState<number | ''>('');
  const [rows, setRows] = useState<HvsRow[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [processDate, setProcessDate] = useState(todayInputDate());
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<AgentDto[]>('/agents');
        if (res.data) setAgents(res.data);
      } catch {
        // ignore
      }
    })();
  }, []);

  const handleLoadData = async () => {
    setLoading(true);
    try {
      const { fromDate, toDate } = monthRange(month, year);
      const params = new URLSearchParams({ fromDate, toDate });
      if (agentId) params.append('agentId', String(agentId));
      const res = await apiRequest<HvsRow[]>(`/transactions/hvs-process?${params.toString()}`);
      if (res.data) setRows(res.data);
      setChecked(new Set());
      setLoaded(true);
    } catch (err) {
      console.warn('Failed to load HVS process data:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCheck = (partyId: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(partyId)) next.delete(partyId); else next.add(partyId);
      return next;
    });
  };

  const toggleAll = () => {
    if (checked.size === rows.length) setChecked(new Set());
    else setChecked(new Set(rows.map(r => r.partyId)));
  };

  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Party,Agent,Mobile,P&L,Total,Closing,T-Settle-Amt'].concat(
        rows.map(r => `"${r.partyName}","${r.agentName}","${r.mobile}",${r.pnl},${r.total},${r.closing},${r.tSettleAmt}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'hvs_process.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGoProcess = async () => {
    const targets = rows.filter(r => checked.has(r.partyId) && r.closing !== 0);
    if (targets.length === 0) {
      alert('Please check at least one party with a non-zero closing amount.');
      return;
    }
    if (!window.confirm(`Settle ${targets.length} checked part(ies) for their Closing amount?`)) return;
    setProcessing(true);
    try {
      for (const t of targets) {
        await apiRequest('/vouchers/settlement', {
          method: 'POST',
          body: JSON.stringify({
            partyLedgerId: t.partyId,
            entrySide: t.closing >= 0 ? 'CR' : 'DR',
            amount: Math.abs(t.closing),
            narration: `HVS Process ${month} ${year}`,
            voucherDate: processDate,
          }),
        });
      }
      alert('Selected parties processed successfully.');
      handleLoadData();
    } catch (err: any) {
      alert(err.message || 'Failed to process selected parties');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">HVS Process</span>

        <select value={month} onChange={(e) => setMonth(e.target.value)} className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900">
          {Object.keys(MONTH_INDEX).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900">
          {Array.from({ length: 8 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <button
          type="button"
          onClick={handleLoadData}
          className="px-4 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded shadow-xs"
        >
          Load Data
        </button>

        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value ? parseInt(e.target.value, 10) : '')}
          className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase"
        >
          <option value="">-- ALL AGENT --</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
        </select>

        <button type="button" onClick={handleExportExcel} className="ml-auto px-4 py-1 bg-[#15803d] hover:bg-[#166534] text-white font-bold text-xs rounded shadow-xs">
          Excel
        </button>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap sticky top-0 z-10">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-10 text-center">SR</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] w-10 text-center">
                  <input type="checkbox" checked={rows.length > 0 && checked.size === rows.length} onChange={toggleAll} />
                </th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party Name</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Agent</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Mobile</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">P&amp;L</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Total</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Closing</th>
                <th className="py-2.5 px-4 text-right">T-Settle-Amt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !loaded ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">Choose Month/Year and click Load Data.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">No records found for this period.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.partyId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-3 text-center border-r border-slate-200">
                      <input type="checkbox" checked={checked.has(r.partyId)} onChange={() => toggleCheck(r.partyId)} />
                    </td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.partyName}</td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-700 border-r border-slate-200">{r.agentName}</td>
                    <td className="py-2 px-4 font-mono text-slate-600 border-r border-slate-200">{r.mobile}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold border-r border-slate-200 ${r.pnl >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.pnl)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.total)}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold border-r border-slate-200 ${r.closing >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.closing)}</td>
                    <td className="py-2 px-4 text-right font-mono text-slate-700">{fmt(r.tSettleAmt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-300 p-2.5 flex flex-wrap items-end gap-3 bg-white">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Date</label>
            <input type="date" value={processDate} onChange={(e) => setProcessDate(e.target.value)} className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs" />
          </div>
          <button
            type="button"
            onClick={handleGoProcess}
            disabled={processing}
            className="px-6 py-2 bg-[#1e3a8a] hover:bg-[#172554] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
          >
            {processing ? 'Processing...' : 'Go-Process'}
          </button>
        </div>
      </div>
    </div>
  );
};
