import React, { useState, useEffect, useMemo, useRef } from 'react';
import { apiRequest } from '../api/client.js';
import { DateDMYInput } from '../components/DateDMYInput.js';
import { toast } from 'react-toastify';

// One agents-master row (GET /agents): `group` is the Group column, `agent` the Agent column
interface AgentDto {
  id: number;
  agentName: string;
  group?: string;
  agent?: string;
}

// GET /transactions/outstanding-agent-group (TransactionService.getOutstandingAgentGroup)
interface AgentGroupRow {
  agentId: number;
  agentGroup: string;
  agentName: string;
  credit: number;
  debit: number;
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST)
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, as live prints them (1013146; Final signed: 1011766 / -5280277)
const fmt = (n: number) => String(Math.round(Math.abs(n || 0)));
const fmtSigned = (n: number) => String(Math.round(n || 0) + 0);

export const OutstandingAgentGroupPage: React.FC = () => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [agents, setAgents] = useState<AgentDto[]>([]);
  // Agents (live, as on OutStanding Report): every Cash Agent ledger (CASH ASLAM …) plus the
  // agents master's Agent names, A-Z; the page then lists that agent's groups (ASLAM 40, ASLAM 60)
  const [cashAgentNames, setCashAgentNames] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [rows, setRows] = useState<AgentGroupRow[]>([]);
  const [final, setFinal] = useState(0);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<AgentDto[]>('/agents');
        if (res.data) setAgents(res.data);
      } catch {
        // ignore
      }
    })();
    (async () => {
      try {
        const res = await apiRequest<Array<{ id: number; partyName: string }>>('/vouchers/cash-agent-ledgers');
        if (res.data) setCashAgentNames(res.data.map(l => (l.partyName || '').trim()).filter(Boolean));
      } catch {
        // ignore
      }
    })();
  }, []);

  const agentNames = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const n of [...cashAgentNames, ...agents.map(a => (a.agent || '').trim())]) {
      if (n && !byKey.has(n.toUpperCase())) byKey.set(n.toUpperCase(), n);
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [agents, cashAgentNames]);
  useEffect(() => {
    if (!selectedAgent && agentNames.length > 0) setSelectedAgent(agentNames[0]);
  }, [agentNames, selectedAgent]);
  // the chosen Agent's groups (agents master rows whose Agent column is it)
  const groupIds = useMemo(
    () => agents.filter(a => (a.agent || '').trim().toUpperCase() === selectedAgent.trim().toUpperCase()).map(a => a.id),
    [agents, selectedAgent]
  );

  const fetchRows = async () => {
    if (!fromDate) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: fromDate, agentIds: groupIds.join(',') });
      const res = await apiRequest<{ rows: AgentGroupRow[]; final: number }>(`/transactions/outstanding-agent-group?${params.toString()}`);
      if (reqId !== reqRef.current) return;
      const list = groupIds.length > 0 ? (res.data?.rows || []) : [];
      setRows(list);
      setFinal(res.data?.final || 0);
      // Live: a Search whose answer is empty / null says so in a red Error toast
      if (list.length === 0) {
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
      if (reqId !== reqRef.current) return;
      console.warn('Failed to load agent group outstanding:', err);
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  };

  // F5 = Reload List (the footer note), as on OutStanding Report
  const fetchRef = useRef(fetchRows);
  fetchRef.current = fetchRows;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F5') return;
      e.preventDefault();
      setHasSearched(true);
      fetchRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);

  const handleExportExcel = () => {
    if (rows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Sr,Agent Group,Agent,Credit,Debit'].concat(
        rows.map((r, i) => `${i + 1},"${r.agentGroup}","${r.agentName}",${r.credit ? fmt(r.credit) : ''},${r.debit ? fmt(r.debit) : ''}`),
        [`${rows.length},Agent Group,Final: ${fmtSigned(final)},${fmt(totalCredit)},${fmt(totalDebit)}`]
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'outstanding_agent_group.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
              value={selectedAgent}
              onChange={(e) => { reqRef.current++; setLoading(false); setSelectedAgent(e.target.value); setRows([]); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  document.getElementById('agentgroup-search-btn')?.focus();
                }
              }}
              className="min-w-40 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 uppercase focus:outline-none focus:bg-[#fde68a]"
            >
              {agentNames.map(n => <option key={n} value={n}>{n}</option>)}
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
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Agent Group</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Agent</th>
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
                    <td className="py-2 px-4 text-center font-semibold text-slate-700 uppercase border-r border-slate-200 bg-[#f1f1f1]">{r.agentGroup}</td>
                    <td className="py-2 px-4 text-center font-semibold uppercase text-slate-700 border-r border-slate-200">{r.agentName}</td>
                    <td className="py-2 px-4 text-right font-semibold text-slate-700 border-r border-slate-200">{r.credit ? fmt(r.credit) : ''}</td>
                    <td className="py-2 px-4 text-right font-semibold text-slate-700">{r.debit ? fmt(r.debit) : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                {/* Live footer: count | Agent Group | Final: Σ Debit − Σ Credit | Σ Credit | Σ Debit */}
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td className="py-2 px-3 border-r border-[#223b63] text-center">{rows.length}</td>
                  <td className="py-2 px-4 border-r border-[#223b63] text-center">Agent Group</td>
                  <td className="py-2 px-4 border-r border-[#223b63] text-center">Final: {fmtSigned(totalDebit - totalCredit)}</td>
                  <td className="py-2 px-4 text-right border-r border-[#223b63]">{fmt(totalCredit)}</td>
                  <td className="py-2 px-4 text-right">{fmt(totalDebit)}</td>
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
