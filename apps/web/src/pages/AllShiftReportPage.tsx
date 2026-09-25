import React, { useState, useEffect, useMemo } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft, ArrowUpDown } from 'lucide-react';

interface AllShiftReportPageProps {
  onNavigate?: (page: string) => void;
}

interface AgentOption {
  id: number;
  agentName: string;
}

interface PartyRow {
  partyId: number;
  partyName: string;
  mobile: string;
  agentName: string;
  limit: number;
  opening: number;
  totalSale: number;
  dSale: number;
  aSale: number;
  comm: number;
  dOpen: number;
  aOpen: number;
  tpc: number;
  hissa: number;
}

type SortKey = 'partyName' | 'limit' | 'opening' | 'comm' | 'dOpen' | 'tpc';

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => (n || 0).toLocaleString('en-IN');

export const AllShiftReportPage: React.FC<AllShiftReportPageProps> = ({ onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState('');
  const [ledgers, setLedgers] = useState<LedgerDto[]>([]);
  const [groupName, setGroupName] = useState('');
  const [partyId, setPartyId] = useState('');
  const [searchMode, setSearchMode] = useState<'START_WITH' | 'CONTAINS'>('START_WITH');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const groupOptions = useMemo(() => {
    const set = new Set(ledgers.map(l => l.groupName).filter(Boolean));
    return Array.from(set) as string[];
  }, [ledgers]);

  useEffect(() => {
    (async () => {
      try {
        const [agentRes, ledgerRes] = await Promise.all([
          apiRequest<AgentOption[]>('/agents'),
          apiRequest<LedgerDto[]>('/ledgers'),
        ]);
        if (agentRes.data) setAgents(agentRes.data);
        if (ledgerRes.data) setLedgers(ledgerRes.data);
      } catch {
        // ignore
      }
    })();
  }, []);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate, searchMode });
      if (agentId) params.append('agentId', agentId);
      if (groupName) params.append('groupName', groupName);
      if (partyId) params.append('partyId', partyId);
      if (search.trim()) params.append('search', search.trim());
      const res = await apiRequest<{ rows: PartyRow[] }>(`/transactions/all-shift-report?${params.toString()}`);
      if (res.data) setRows(res.data.rows);
      setSelected(new Set());
    } catch (err) {
      console.warn('Failed to load all-shift report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReport();
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggleSelectAll = () => {
    if (selected.size === sortedRows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedRows.map(r => r.partyId)));
    }
  };

  const toggleSelectRow = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSms = () => {
    if (selected.size === 0) {
      alert('Please select at least one party.');
      return;
    }
    alert(`${selected.size} part${selected.size > 1 ? 'ies' : 'y'} selected. No SMS gateway is configured in this system yet, so this is a UI-only placeholder.`);
  };

  const handleExportExcel = () => {
    if (sortedRows.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['Party,Mobile,Agent,Limit,Opening,Total Sale,Dara Sale,Akhar Sale,Comm,Dara Open,Akhar Open,TPC,Hissa'].concat(
        sortedRows.map(r => `"${r.partyName}",${r.mobile},"${r.agentName}",${r.limit},${r.opening},${r.totalSale},${r.dSale},${r.aSale},${r.comm},${r.dOpen},${r.aOpen},${r.tpc},${r.hissa}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `all_shift_report_${fromDate}_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const SortIcon: React.FC<{ col: SortKey }> = ({ col }) => (
    <button type="button" onClick={() => handleSort(col)} className="ml-1 inline-flex align-middle text-slate-300 hover:text-white">
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white">
          <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />

          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 cursor-pointer">
            <option value="">ALL AGENTS</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
          </select>

          <select value={groupName} onChange={(e) => setGroupName(e.target.value)} className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 cursor-pointer">
            <option value="">ALL DEAL</option>
            {groupOptions.map(g => <option key={g} value={g}>{g.toUpperCase()}</option>)}
          </select>

          <button type="submit" className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Search
          </button>

          <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 cursor-pointer">
            <option value="">ALL PARTY</option>
            {ledgers.map(l => <option key={l.id} value={l.id}>{l.partyName}</option>)}
          </select>

          <select value={searchMode} onChange={(e) => setSearchMode(e.target.value as 'START_WITH' | 'CONTAINS')} className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 cursor-pointer">
            <option value="START_WITH">START-WITH</option>
            <option value="CONTAINS">CONTAINS</option>
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SEARCH"
            className="w-32 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 uppercase placeholder:text-slate-400"
          />

          <button type="button" onClick={handleSms} className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors">
            SMS
          </button>
          <button type="button" onClick={handleExportExcel} className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap sticky top-0 z-10">
                <th className="py-2 px-2 border-r border-[#223b63] w-10 text-center">Sr.</th>
                <th className="py-2 px-2 border-r border-[#223b63]">Asign</th>
                <th className="py-2 px-2 border-r border-[#223b63]">Feedback</th>
                <th className="py-2 px-2 border-r border-[#223b63]">
                  <input type="checkbox" checked={selected.size > 0 && selected.size === sortedRows.length} onChange={toggleSelectAll} className="mr-1.5 align-middle" />
                  Party<SortIcon col="partyName" />
                </th>
                <th className="py-2 px-2 border-r border-[#223b63]">Mobile</th>
                <th className="py-2 px-2 border-r border-[#223b63]">Agent</th>
                <th className="py-2 px-2 border-r border-[#223b63] text-right">Limit<SortIcon col="limit" /></th>
                <th className="py-2 px-2 border-r border-[#223b63] text-right">Opening<SortIcon col="opening" /></th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Total Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Dara Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Akhar Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Comm<SortIcon col="comm" /></th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Dara Open<SortIcon col="dOpen" /></th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Akhar Open</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">TPC<SortIcon col="tpc" /></th>
                <th className="py-2 px-3 text-right">Hissa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={16} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : sortedRows.length === 0 ? (
                <tr><td colSpan={16} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                sortedRows.map((r, idx) => (
                  <tr key={r.partyId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-1.5 px-2 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-1.5 px-2 text-center text-slate-400 border-r border-slate-200">-</td>
                    <td className="py-1.5 px-2 text-center text-slate-400 border-r border-slate-200">-</td>
                    <td className="py-1.5 px-2 font-bold text-slate-900 uppercase border-r border-slate-200">
                      <input type="checkbox" checked={selected.has(r.partyId)} onChange={() => toggleSelectRow(r.partyId)} className="mr-1.5 align-middle" />
                      {r.partyName}
                    </td>
                    <td className="py-1.5 px-2 font-mono text-slate-700 border-r border-slate-200">{r.mobile}</td>
                    <td className="py-1.5 px-2 font-semibold uppercase text-slate-700 border-r border-slate-200">{r.agentName}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.limit)}</td>
                    <td className={`py-1.5 px-2 text-right font-mono border-r border-slate-200 ${r.opening >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(r.opening)}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{fmt(r.totalSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.dSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.aSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-rose-700 border-r border-slate-200">{fmt(r.comm)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.dOpen)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.aOpen)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-500 border-r border-slate-200">{fmt(r.tpc)}</td>
                    <td className={`py-1.5 px-3 text-right font-mono font-bold ${r.hissa >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.hissa)}</td>
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
