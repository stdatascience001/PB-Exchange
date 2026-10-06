import React, { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../api/client.js';
import { ArrowLeft, ListOrdered } from 'lucide-react';
import { toast } from 'react-toastify';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface AllShiftReportPageProps {
  onNavigate?: (page: string) => void;
}

interface AgentOption {
  id: number;
  agentName: string;
}

// One ledger row of GET /transactions/all-shift-report?view=full
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
  tProfit: number;
  kist: number;
  rebate: number;
  hpAmt: number;
  payment: number;
  closing: number;
  dayAv: number;
}

type NumKey = Exclude<keyof PartyRow, 'partyId' | 'partyName' | 'mobile' | 'agentName'>;
type SortKey = NumKey | 'partyName';
type SearchMode = 'START_WITH' | 'CONTAINS' | 'END_WITH';

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers, no grouping — the live report prints 1289368, -3132, 302.
const fmt = (n: number) => String(Math.round(n || 0));

const messageToast = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

// Money columns after Agent, in the live report's order, with their cell tint.
const MONEY_COLS: { key: NumKey; label: string; tint?: string }[] = [
  { key: 'limit', label: 'Limit' },
  { key: 'opening', label: 'Opening', tint: 'bg-[#bbf7c4]' },
  { key: 'totalSale', label: 'Total Sale' },
  { key: 'dSale', label: 'Dara Sale' },
  { key: 'aSale', label: 'Akhar Sale' },
  { key: 'comm', label: 'Comm' },
  { key: 'dOpen', label: 'Dara Open' },
  { key: 'aOpen', label: 'Akhar Open' },
  { key: 'tpc', label: 'TPC' },
  { key: 'hissa', label: 'Hissa' },
  { key: 'tProfit', label: 'T-Profit', tint: 'bg-[#f0f5c4]' },
  { key: 'kist', label: 'Kist' },
  { key: 'rebate', label: 'Rebate' },
  { key: 'hpAmt', label: 'HP-Amt' },
  { key: 'payment', label: 'Payment' },
  { key: 'closing', label: 'Closing', tint: 'bg-[#fbd5e5]' },
];

export const AllShiftReportPage: React.FC<AllShiftReportPageProps> = ({ onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState('');
  const [dealOptions, setDealOptions] = useState<string[]>([]);
  const [dealing, setDealing] = useState('');
  const [partyStatus, setPartyStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [searchMode, setSearchMode] = useState<SearchMode>('START_WITH');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Sms column tick boxes (header box ticks all) and the Asign column's own tick boxes.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [assigned, setAssigned] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    (async () => {
      try {
        const agentRes = await apiRequest<AgentOption[]>('/agents');
        if (agentRes.data) setAgents([...agentRes.data].sort((a, b) => a.agentName.localeCompare(b.agentName)));
      } catch {
        // ignore
      }
    })();
  }, []);

  const fetchReport = async () => {
    if (!fromDate || !toDate) return messageToast('error', 'Please select both Dates!', 'all-shift-date');
    if (fromDate > toDate) return messageToast('error', 'From Date cannot be after To Date!', 'all-shift-date');
    setLoading(true);
    try {
      const params = new URLSearchParams({ view: 'full', fromDate, toDate, searchMode });
      if (agentId) params.append('agentId', agentId);
      if (dealing) params.append('dealing', dealing);
      if (partyStatus) params.append('partyStatus', partyStatus);
      if (search.trim()) params.append('search', search.trim());
      const res = await apiRequest<{ rows: PartyRow[]; dealOptions?: string[] }>(`/transactions/all-shift-report?${params.toString()}`);
      setRows(res.data?.rows || []);
      if (res.data?.dealOptions) setDealOptions(res.data.dealOptions);
      setSelected(new Set());
      setAssigned(new Set());
    } catch (err: any) {
      console.warn('Failed to load all-shift report:', err);
      messageToast('error', err.message || 'Failed to load report', 'all-shift-load');
    } finally {
      setLoading(false);
    }
  };

  // Live flow: the page opens with the cursor on From's day and an empty table; Enter walks
  // From DD -> MM -> YYYY -> To DD -> MM -> YYYY -> Agents -> Deal -> Search, and the report
  // loads on Search (Enter or click) with a spinner on the button.
  const [hasSearched, setHasSearched] = useState(false);
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
  useEffect(() => {
    focusById('allshift-fromDate-dd');
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setHasSearched(true);
    fetchReport();
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    else {
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

  const totals = useMemo(() => {
    const t = {} as Record<NumKey, number>;
    for (const c of MONEY_COLS) t[c.key] = sortedRows.reduce((s, r) => s + (r[c.key] || 0), 0);
    return t;
  }, [sortedRows]);

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) =>
    setter(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = sortedRows.length > 0 && selected.size === sortedRows.length;
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(sortedRows.map(r => r.partyId)));

  const handleSms = () => {
    if (selected.size === 0) {
      messageToast('error', 'Please select at least one party!', 'all-shift-sms');
      return;
    }
    messageToast('error', `${selected.size} part${selected.size > 1 ? 'ies' : 'y'} selected. No SMS gateway is configured in this system yet.`, 'all-shift-sms');
  };

  const handleFeedback = (r: PartyRow) => {
    messageToast('error', `Feedback for ${r.partyName}: no feedback service is configured in this system yet.`, `all-shift-fb-${r.partyId}`);
  };

  const handleExportExcel = () => {
    if (sortedRows.length === 0) {
      messageToast('error', 'Record not found!', 'all-shift-excel');
      return;
    }
    const header = ['Sr', 'Party', 'Mobile', 'Agent', ...MONEY_COLS.map(c => c.label), 'DayAv'];
    const csvContent = 'data:text/csv;charset=utf-8,' + [header.join(',')].concat(
      sortedRows.map((r, i) => [
        i + 1, `"${r.partyName}"`, r.mobile, `"${r.agentName}"`,
        ...MONEY_COLS.map(c => fmt(r[c.key])), r.dayAv,
      ].join(','))
    ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `all_shift_report_${fromDate}_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const SortIcon: React.FC<{ col: SortKey }> = ({ col }) => (
    <button type="button" onClick={() => handleSort(col)} className="ml-1.5 inline-flex align-middle text-slate-300 hover:text-white" title="Sort">
      <ListOrdered className="w-3 h-3" />
    </button>
  );

  // Sr. / Asign / Feedback / Sms tick / Party stay pinned on the left while every column
  // from Mobile on scrolls sideways under them (live rpt_all_shift). Fixed widths so each
  // pinned column knows its left offset; the Party edge carries a shadow over the scroll.
  const PIN_W = [64, 88, 128, 56, 280];
  const pin = (i: number): React.CSSProperties => ({
    position: 'sticky',
    left: PIN_W.slice(0, i).reduce((a, b) => a + b, 0),
    width: PIN_W[i],
    minWidth: PIN_W[i],
    maxWidth: PIN_W[i],
    ...(i === PIN_W.length - 1 ? { boxShadow: '4px 0 6px -2px rgba(15, 23, 42, 0.25)' } : {}),
  });
  const th = 'py-2 px-2 border-r border-[#223b63] whitespace-nowrap';
  const td = 'py-1.5 px-2 border-r border-slate-200';
  const ft = 'py-2 px-2 border-r border-[#223b63] whitespace-nowrap';
  const select = 'px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 cursor-pointer uppercase focus:outline-none focus:bg-[#fde68a]';
  const partyLabel = partyStatus || 'ALL PARTY';

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white">
          <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="allshift-fromDate" separator="-" onEnterFromYear={() => focusById('allshift-toDate-dd')} />
          <DateDMYInput value={toDate} onChange={setToDate} idPrefix="allshift-toDate" separator="-" onEnterFromYear={() => focusById('allshift-agent')} />

          <select id="allshift-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} onKeyDown={enterTo('allshift-deal')} className={`${select} min-w-40`}>
            <option value="">ALL AGENTS</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
          </select>

          <select id="allshift-deal" value={dealing} onChange={(e) => setDealing(e.target.value)} onKeyDown={enterTo('allshift-search-btn')} className={`${select} min-w-40`}>
            <option value="">ALL DEAL</option>
            {dealOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <button id="allshift-search-btn" type="submit" disabled={loading} className="px-12 py-1.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5">
            Search
            {/* Spinner while the report loads, as on live */}
            {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          </button>

          <select value={partyStatus} onChange={(e) => setPartyStatus(e.target.value as '' | 'ACTIVE' | 'INACTIVE')} className={`${select} min-w-36`}>
            <option value="">ALL PARTY</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>

          <select value={searchMode} onChange={(e) => setSearchMode(e.target.value as SearchMode)} className={select}>
            <option value="START_WITH">START-WITH</option>
            <option value="CONTAINS">CONTAINS-WITH</option>
            <option value="END_WITH">END-WITH</option>
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SEARCH"
            className="w-48 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-900 uppercase placeholder:text-slate-400"
          />

          <button type="button" onClick={handleSms} className="ml-auto px-7 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors">
            SMS
          </button>
          <button type="button" onClick={handleExportExcel} className="px-7 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Excel
          </button>
        </form>

        <div className="overflow-auto flex-1 max-h-[calc(100vh-190px)]">
          <table className="min-w-max w-full text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-40">
              <tr className="bg-[#152847] text-white font-bold text-[11px]">
                <th style={pin(0)} className={`${th} z-30 bg-[#152847]`}>Sr.</th>
                <th style={pin(1)} className={`${th} z-30 bg-[#152847] text-center`}>Asign</th>
                <th style={pin(2)} className={`${th} z-30 bg-[#152847] text-center`}>Feedback</th>
                <th style={pin(3)} className={`${th} z-30 bg-[#152847] text-center`}>
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 align-middle cursor-pointer" title="Tick all" />
                </th>
                <th style={pin(4)} className={`${th} z-30 bg-[#152847]`}>
                  <div className="flex items-center justify-between">
                    <span>Party</span>
                    <SortIcon col="partyName" />
                  </div>
                  <div className="text-[9px] text-amber-300 font-semibold leading-none">{partyLabel}</div>
                </th>
                <th className={`${th} text-center`}>Mobile</th>
                <th className={`${th} text-center min-w-40`}>Agent</th>
                {MONEY_COLS.map(c => (
                  <th key={c.key} className={`${th} text-right`}>
                    {c.label}<SortIcon col={c.key} />
                  </th>
                ))}
                <th className={`${th} text-center`}>DayAv<SortIcon col="dayAv" /></th>
                <th className="py-2 px-2 whitespace-nowrap min-w-48">Party</th>
              </tr>
            </thead>
            <tbody className="font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={MONEY_COLS.length + 9} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !hasSearched ? (
                <tr><td colSpan={MONEY_COLS.length + 9} className="py-14" /></tr>
              ) : sortedRows.length === 0 ? (
                <tr><td colSpan={MONEY_COLS.length + 9} className="py-14 text-center text-slate-400 font-medium">No records found for this filter.</td></tr>
              ) : (
                sortedRows.map((r, idx) => (
                  <tr key={r.partyId} className="group hover:bg-slate-50 transition-colors [&>td]:border-b [&>td]:border-slate-200">
                    <td style={pin(0)} className={`${td} z-20 bg-white group-hover:bg-slate-50 font-mono text-slate-600`}>{idx + 1}</td>
                    <td style={pin(1)} className={`${td} z-20 bg-white group-hover:bg-slate-50 text-center`}>
                      <input type="checkbox" checked={assigned.has(r.partyId)} onChange={() => toggleSet(setAssigned, r.partyId)} className="h-3.5 w-3.5 cursor-pointer" />
                    </td>
                    <td style={pin(2)} className={`${td} z-20 bg-white group-hover:bg-slate-50 text-center`}>
                      <button type="button" onClick={() => handleFeedback(r)} className="px-2.5 py-0.5 bg-[#ca9a1c] hover:bg-[#b3861a] text-white text-[10px] font-bold rounded-xs">
                        Feedback
                      </button>
                    </td>
                    <td style={pin(3)} className={`${td} z-20 bg-white group-hover:bg-slate-50 text-center`}>
                      <input type="checkbox" checked={selected.has(r.partyId)} onChange={() => toggleSet(setSelected, r.partyId)} className="h-3.5 w-3.5 cursor-pointer" />
                    </td>
                    <td style={pin(4)} className={`${td} z-20 font-bold text-slate-800 uppercase bg-[#f1f1f1] truncate`} title={r.partyName}>{r.partyName}</td>
                    <td className={`${td} text-center font-semibold text-slate-700`}>{r.mobile}</td>
                    <td className={`${td} text-center font-semibold uppercase text-slate-700`}>{r.agentName}</td>
                    {MONEY_COLS.map(c => (
                      <td key={c.key} className={`${td} text-right font-semibold text-slate-800 ${c.tint || ''}`}>{fmt(r[c.key])}</td>
                    ))}
                    <td className={`${td} text-center font-semibold text-slate-800 bg-[#f0f5c4]`}>{r.dayAv}</td>
                    <td className="py-1.5 px-2 font-bold text-slate-800 uppercase bg-[#f1f1f1]">{r.partyName}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="sticky bottom-0 z-40">
              <tr className="bg-[#152847] text-white font-bold text-[11px]">
                <td style={pin(0)} className={`${ft} z-30 bg-[#152847]`}>{sortedRows.length}</td>
                <td style={pin(1)} className={`${ft} z-30 bg-[#152847] text-center`}>Asign</td>
                <td style={pin(2)} className={`${ft} z-30 bg-[#152847] text-center`}>Feedback</td>
                <td style={pin(3)} className={`${ft} z-30 bg-[#152847] text-center`}>Sms</td>
                <td style={pin(4)} className={`${ft} z-30 bg-[#152847]`}>Party</td>
                <td className={`${ft} text-center`}>Mobile</td>
                <td className={`${ft} text-center`}>Agent</td>
                {MONEY_COLS.map(c => (
                  <td key={c.key} className={`${ft} text-right`}>{fmt(totals[c.key])}</td>
                ))}
                <td className={`${ft} text-center`}>DayAv</td>
                <td className="py-2 px-2">Party</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
