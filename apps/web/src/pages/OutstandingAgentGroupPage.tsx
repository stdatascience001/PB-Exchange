import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { DateDMYInput } from '../components/DateDMYInput.js';
import { toast } from 'react-toastify';

interface AgentDto {
  id: number;
  agentName: string;
}

interface AgentGroupRow {
  agentId: number;
  agentGroup: string;
  agentName: string;
  credit: number;
  debit: number;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(Math.abs(n || 0)).toLocaleString('en-IN');

export const OutstandingAgentGroupPage: React.FC = () => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [agentId, setAgentId] = useState<number | ''>('');
  const [rows, setRows] = useState<AgentGroupRow[]>([]);
  const [loading, setLoading] = useState(false);

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

  const fetchRows = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ toDate: fromDate });
      if (agentId) params.append('agentId', String(agentId));
      const res = await apiRequest<AgentGroupRow[]>(`/vouchers/agent-group-balances?${params.toString()}`);
      if (res.data) setRows(res.data);
      // Live: a Search whose answer is empty / null says so in a red Error toast
      if (!res.data || res.data.length === 0) {
        setRows([]);
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'agentgroup-empty' }
        );
      }
    } catch (err) {
      console.warn('Failed to load agent group outstanding:', err);
    } finally {
      setLoading(false);
    }
  };

  // Live flow: the page opens on Agents with an empty table; Enter on Agents goes to Search
  // (Enter on the date's year to Agents), and the report loads on Search with a spinner.
  const [hasSearched, setHasSearched] = useState(false);
  useEffect(() => {
    document.getElementById('agentgroup-agent')?.focus();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setHasSearched(true);
    fetchRows();
  };

  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Agent Group,Agent,Credit,Debit'].concat(
        rows.map(r => `"${r.agentGroup}","${r.agentName}",${r.credit},${r.debit}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'outstanding_agent_group.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">OutStanding Agent-Group</span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-600 font-medium">From</span>
              <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="agentgroup-fromDate" separator="-" onEnterFromYear={() => document.getElementById('agentgroup-agent')?.focus()} />
            </div>
            <span className="text-slate-600 font-medium">Agents</span>
            <select
              id="agentgroup-agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value ? parseInt(e.target.value, 10) : '')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  document.getElementById('agentgroup-search-btn')?.focus();
                }
              }}
              className="min-w-40 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 uppercase focus:outline-none focus:bg-[#fde68a]"
            >
              <option value="">--CHOOSE--</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
            </select>
            <button id="agentgroup-search-btn" type="submit" disabled={loading} className="px-10 py-1.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
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
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr.</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Agent Group</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Agent</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Credit</th>
                <th className="py-2.5 px-4 text-right">Debit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={5} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={5} className="py-14" /></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.agentId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.agentGroup}</td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{r.agentName}</td>
                    <td className="py-2 px-4 text-right font-mono text-emerald-700 border-r border-slate-200">{fmt(r.credit)}</td>
                    <td className="py-2 px-4 text-right font-mono text-rose-700">{fmt(r.debit)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td colSpan={3} className="py-2 px-4 border-r border-[#223b63]">Total</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(totalCredit)}</td>
                  <td className="py-2 px-4 text-right font-mono">{fmt(totalDebit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <div className="pt-1.5 text-[10px] text-slate-500 font-medium">[F5 = Reload List]</div>
    </div>
  );
};
