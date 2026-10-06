import React, { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { DateDMYInput } from '../components/DateDMYInput.js';

// One agents-master row (GET /agents): `group` is the Group column, `agent` the Agent column.
interface AgentRow {
  id: number;
  group: string;
  agent: string;
}

// GET /transactions/outstanding (TransactionService.getOutstandingReport)
interface OutstandingRow {
  ledgerId: number;
  partyName: string;
  agentGroup: string;
  credit: number;
  debit: number;
}

interface OutstandingData {
  rows: OutstandingRow[];
  totalCredit: number;
  totalDebit: number;
  final: number;
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, signed, as the live report prints them (21897, -5406103).
const fmt = (n: number) => String(Math.round(n || 0));

const messageToast = (text: string, toastId: string) =>
  toast.error(
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    { toastId }
  );

export const OutstandingReportPage: React.FC = () => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [agentRows, setAgentRows] = useState<AgentRow[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>('');
  const [data, setData] = useState<OutstandingData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<AgentRow[]>('/agents');
        if (res.data) setAgentRows(res.data);
      } catch (err) {
        console.warn('Failed to load agents:', err);
      }
    })();
  }, []);

  // "Agents" = the Agent column of the agents master, each name once, A-Z.
  const agentNames = useMemo(
    () => Array.from(new Set(agentRows.map(a => (a.agent || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [agentRows]
  );

  useEffect(() => {
    if (!selectedAgent && agentNames.length > 0) setSelectedAgent(agentNames[0]);
  }, [agentNames, selectedAgent]);

  // Group dropdown = only the groups that belong to the chosen agent.
  const groupOptions = useMemo(
    () => agentRows
      .filter(a => (a.agent || '').trim() === selectedAgent)
      .sort((a, b) => a.group.localeCompare(b.group)),
    [agentRows, selectedAgent]
  );

  const fetchList = async () => {
    if (!fromDate) return messageToast('Please select Date!', 'outstanding-date');
    // One group if chosen, otherwise every group under the agent.
    const ids = selectedGroupId ? [selectedGroupId] : groupOptions.map(g => g.id);
    if (ids.length === 0) return messageToast('Please select Agent!', 'outstanding-agent');
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: fromDate, agentIds: ids.join(',') });
      const res = await apiRequest<OutstandingData>(`/transactions/outstanding?${params.toString()}`);
      setData(res.data || null);
      // Live: a Search that finds nothing says so in a red Error toast
      if (!res.data || res.data.rows.length === 0) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'outstanding-empty' }
        );
      }
    } catch (err: any) {
      console.warn('Failed to load outstanding report:', err);
      messageToast(err.message || 'Failed to load outstanding report', 'outstanding-load');
    } finally {
      setLoading(false);
    }
  };

  // Live page opens empty and loads only on Search (or F5 = Reload List).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        fetchList();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, selectedGroupId, groupOptions]);

  // Live keyboard flow: the page opens on Agents; Enter on the date's year goes to Agents, Enter
  // on Agents to Search, whose Enter loads the report (spinner on the button).
  useEffect(() => {
    document.getElementById('outstanding-agent')?.focus();
  }, []);
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.getElementById(id)?.focus();
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    fetchList();
  };

  const handleExportExcel = () => {
    if (!data || data.rows.length === 0) {
      messageToast('Record not found!', 'outstanding-excel');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Sr,Agent Group,Party Name,Credit,Debit'].concat(
        data.rows.map((r, i) => `${i + 1},"${r.agentGroup}","${r.partyName}",${r.credit ? fmt(r.credit) : ''},${r.debit ? fmt(r.debit) : ''}`),
        [`${data.rows.length},,Final: ${fmt(data.final)},${fmt(data.totalCredit)},${fmt(data.totalDebit)}`]
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `outstanding_report_${selectedAgent}_${fromDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const th = 'py-2.5 px-3 border-r border-[#223b63] text-center';
  const td = 'py-2 px-3 border-r border-slate-200 font-semibold text-slate-700';
  const select = 'px-2.5 py-1.5 bg-white border border-slate-300 rounded-xs text-xs font-bold text-slate-900 uppercase cursor-pointer focus:outline-none focus:bg-[#fde68a]';

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-700 tracking-tight mx-3">OutStanding Report</span>
          <span className="text-slate-600 font-semibold text-[11px] ml-4">From</span>
          <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="outstanding-fromDate" separator="-" onEnterFromYear={() => document.getElementById('outstanding-agent')?.focus()} />
          <span className="text-slate-600 font-semibold text-[11px]">Agents</span>
          <select
            id="outstanding-agent"
            value={selectedAgent}
            onChange={(e) => { setSelectedAgent(e.target.value); setSelectedGroupId(''); setData(null); }}
            onKeyDown={enterTo('outstanding-search-btn')}
            className={`${select} min-w-40`}
          >
            {agentNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button id="outstanding-search-btn" type="submit" disabled={loading} className="px-10 py-1.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded-xs shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
            Search
            {/* Spinner while the report loads, as on live */}
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </button>
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value ? parseInt(e.target.value, 10) : '')}
            onKeyDown={enterTo('outstanding-search-btn')}
            className={`${select} min-w-36`}
          >
            <option value="">-- ALL GROUP --</option>
            {groupOptions.map(g => <option key={g.id} value={g.id}>{g.group}</option>)}
          </select>
          <button type="button" onClick={handleExportExcel} className="ml-auto px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded-xs shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="overflow-auto flex-1 max-h-[calc(100vh-200px)]">
          <table className="w-auto min-w-[740px] text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[12px] whitespace-nowrap">
                <th className={`${th} w-12 !text-left`}>Sr.</th>
                <th className={`${th} w-36`}>Agent Group</th>
                <th className={`${th} w-72`}>Party Name</th>
                <th className={`${th} w-28`}>Credit</th>
                <th className={`${th} w-28`}>Debit</th>
              </tr>
            </thead>
            <tbody className="whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={5} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : (
                (data?.rows || []).map((r, idx) => (
                  <tr key={r.ledgerId} className="even:bg-slate-50/60 hover:bg-slate-50 [&>td]:border-b [&>td]:border-slate-200">
                    <td className={td}>{idx + 1}</td>
                    <td className={`${td} text-center uppercase`}>{r.agentGroup}</td>
                    <td className={`${td} text-center uppercase`}>{r.partyName}</td>
                    <td className={`${td} text-right`}>{r.credit ? fmt(r.credit) : ''}</td>
                    <td className={`${td} text-right`}>{r.debit ? fmt(r.debit) : ''}</td>
                  </tr>
                ))
              )}
            </tbody>
            {!loading && data && data.rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#152847] text-white font-bold text-[12px] whitespace-nowrap">
                  <td className={`${th} !text-left`}>{data.rows.length}</td>
                  <td className={th}>Agent Group</td>
                  <td className={th}>Final: {fmt(data.final)}</td>
                  <td className={`${th} !text-right`}>{fmt(data.totalCredit)}</td>
                  <td className={`${th} !text-right`}>{fmt(data.totalDebit)}</td>
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
