import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';

interface CashAgentLedger {
  id: number;
  partyName: string;
  agentId: number | null;
}

interface AgentOption {
  id: number;
  agentName: string;
}

interface LedgerBalanceRow {
  ledgerId: number;
  partyName: string;
  agentId: number | null;
  agentName: string;
  totalDr: number;
  totalCr: number;
  balance: number;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(Math.abs(n || 0)).toLocaleString('en-IN');

export const OutstandingReportPage: React.FC = () => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [cashAgentLedgers, setCashAgentLedgers] = useState<CashAgentLedger[]>([]);
  const [selectedLedgerId, setSelectedLedgerId] = useState<number | ''>('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<number | ''>('');
  const [rows, setRows] = useState<LedgerBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ledgerRes, agentRes] = await Promise.all([
          apiRequest<CashAgentLedger[]>('/vouchers/cash-agent-ledgers'),
          apiRequest<AgentOption[]>('/agents'),
        ]);
        if (ledgerRes.data) {
          setCashAgentLedgers(ledgerRes.data);
          if (ledgerRes.data.length > 0) setSelectedLedgerId(ledgerRes.data[0].id);
        }
        if (agentRes.data) setAgents(agentRes.data);
      } catch (err) {
        console.warn('Failed to load agent filters:', err);
      }
    })();
  }, []);

  // "Group" (agents master) overrides the "Agents" (Cash Agent ledger) selection when set —
  // both ultimately resolve to the same agentId used to scope the report.
  const effectiveAgentId = selectedAgentId || cashAgentLedgers.find(l => l.id === selectedLedgerId)?.agentId || '';

  const fetchList = async () => {
    if (!effectiveAgentId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ toDate: fromDate, agentId: String(effectiveAgentId) });
      const res = await apiRequest<LedgerBalanceRow[]>(`/vouchers/ledger-balances?${params.toString()}`);
      if (res.data) setRows(res.data);
    } catch (err) {
      console.warn('Failed to load outstanding report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, selectedLedgerId, selectedAgentId, cashAgentLedgers.length]);

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
      ['Agent Group,Party Name,Credit,Debit'].concat(
        rows.map(r => `"${r.agentName}","${r.partyName}",${r.totalCr},${r.totalDr}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'outstanding_report.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalCredit = rows.reduce((s, r) => s + r.totalCr, 0);
  const totalDebit = rows.reduce((s, r) => s + r.totalDr, 0);
  const finalNet = totalDebit - totalCredit;

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">OutStanding Report</span>
            <span className="text-slate-600 font-medium">From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
            <span className="text-slate-600 font-medium">Agents</span>
            <select
              value={selectedLedgerId}
              onChange={(e) => setSelectedLedgerId(e.target.value ? parseInt(e.target.value, 10) : '')}
              className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase min-w-32"
            >
              {cashAgentLedgers.map(l => <option key={l.id} value={l.id}>{l.partyName}</option>)}
            </select>
            <button type="submit" className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors">
              Search
            </button>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value ? parseInt(e.target.value, 10) : '')}
              className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase min-w-32"
            >
              <option value="">-- ALL GROUP --</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
            </select>
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
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party Name</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Credit</th>
                <th className="py-2.5 px-4 text-right">Debit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={5} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.ledgerId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.agentName}</td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{r.partyName}</td>
                    <td className="py-2 px-4 text-right font-mono text-emerald-700 border-r border-slate-200">{r.totalCr > 0 ? fmt(r.totalCr) : ''}</td>
                    <td className="py-2 px-4 text-right font-mono text-rose-700">{r.totalDr > 0 ? fmt(r.totalDr) : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td className="py-2 px-3 text-center border-r border-[#223b63]">{rows.length}</td>
                  <td className="py-2 px-4 border-r border-[#223b63]">Agent Group</td>
                  <td className="py-2 px-4 border-r border-[#223b63]">Final: {fmt(finalNet)}</td>
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
