import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';
import { PartyPicker } from '../components/PartyPicker.js';
import { toast } from 'react-toastify';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface SettlementAgentPageProps {
  onNavigate?: (page: string) => void;
}

interface AgentDto {
  id: number;
  agentName: string;
}

// GET /transactions/settlement-agent-rows (TransactionService.getSettlementAgentRows): every
// party of the agent group, A-Z — Credit / Debit = its balance on that side, Balance = the
// running total down the list (Dr − Cr), Updated By / Date = the ledger's own
interface SettlementRow {
  ledgerId: number;
  partyName: string;
  agentId: number | null;
  credit: number;
  debit: number;
  partyBalance: number;
  balance: number;
  periodCredit?: number;
  periodDebit?: number;
  updatedBy: string;
  updatedAt: string | null;
}

const CALENDAR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_INDEX: Record<string, number> = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 };
// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST)
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Whole numbers without grouping, as live prints them (17388, 100559)
const fmt = (n: number) => String(Math.round(Math.abs(n || 0)));
// Balance as live: "19993 Cr" / "80566 Dr" (Dr − Cr; negative = Cr)
const crDr = (n: number) => (Math.round(n || 0) === 0 ? '0' : `${fmt(n)} ${n < 0 ? 'Cr' : 'Dr'}`);
// Live Updated Date: "13-10-2025 04:46" (stored wall-clock value, printed as stored)
const formatTimestamp = (val: string | null) => {
  if (!val) return '-';
  const [d, t] = val.slice(0, 16).split('T');
  if (!d) return '-';
  return `${d.split('-').reverse().join('-')} ${t || ''}`.trim();
};
const notify = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

function monthRange(month: string, year: number) {
  const m = MONTH_INDEX[month] ?? new Date().getMonth();
  const from = new Date(Date.UTC(year, m, 1));
  const to = new Date(Date.UTC(year, m + 1, 0));
  return { fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) };
}

export const SettlementAgentPage: React.FC<SettlementAgentPageProps> = ({ onNavigate }) => {
  const now = new Date();
  const [month, setMonth] = useState(CALENDAR_MONTHS[now.getMonth()]);
  const [year, setYear] = useState(now.getFullYear());
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [agentId, setAgentId] = useState<number | ''>('');
  const [settleFilter, setSettleFilter] = useState('');
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  const [ledgers, setLedgers] = useState<LedgerDto[]>([]);
  const [saveDate, setSaveDate] = useState(todayInputDate());
  const [saveParty, setSaveParty] = useState<LedgerDto | null>(null);
  const [savePartySearch, setSavePartySearch] = useState('');
  const savePartyRef = useRef<HTMLInputElement>(null);
  const [saveBalance, setSaveBalance] = useState(0);
  // Go-Settle's own date (live: the box beside it)
  const [settleDate, setSettleDate] = useState(todayInputDate());
  // Only the latest Search may fill the table
  const reqRef = useRef(0);
  const [saveType, setSaveType] = useState<'Credit' | 'Debit'>('Credit');
  const [saveAmount, setSaveAmount] = useState('');
  const [saveRemark, setSaveRemark] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ledgerRes, agentRes] = await Promise.all([
          apiRequest<LedgerDto[]>('/ledgers'),
          apiRequest<AgentDto[]>('/agents'),
        ]);
        if (ledgerRes.data) setLedgers(ledgerRes.data);
        // Live lists the agent groups A-Z (AAHIL DL, AARIT KARNAL, AHAAN …)
        if (agentRes.data) setAgents([...agentRes.data].sort((a, b) => a.agentName.localeCompare(b.agentName)));
      } catch {
        // ignore
      }
    })();
  }, []);

  // Live filter bar: Month | Year | --CHOOSE AGENT-- | Search | Settle Party. The page opens on
  // Month; Enter walks Month -> Year -> Agent -> Search (Enter there loads, spinner on the
  // button). Settle Party lists the parties as you type and narrows the table to the pick.
  const settlePartyRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.getElementById('sagent-month')?.focus();
  }, []);
  const enterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.getElementById(id)?.focus();
  };

  // fromSearch: the Search button's own load — an empty / null answer says so in a red toast
  const fetchRows = async (fromSearch = false) => {
    if (!agentId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      const { fromDate, toDate } = monthRange(month, year);
      const params = new URLSearchParams({ fromDate, toDate, agentId: String(agentId) });
      const res = await apiRequest<{ rows: SettlementRow[] }>(`/transactions/settlement-agent-rows?${params.toString()}`);
      if (reqId !== reqRef.current) return;
      const list = res.data?.rows || [];
      setRows(list);
      if (fromSearch && list.length === 0) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'sagent-empty' }
        );
      }
      setChecked(new Set());
    } catch (err: any) {
      if (reqId !== reqRef.current) return;
      console.warn('Failed to load settlement rows:', err);
      notify('error', err?.message || 'Failed to load settlement', 'sagent-load');
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  };

  // Search needs an agent first — live: "Please enter a valid agent!" with --CHOOSE AGENT--
  // still selected. (Reloads after a save keep loading as before.)
  const handleSearch = () => {
    if (!agentId) {
      toast.error(
        <div>
          <div className="font-bold text-base">Message</div>
          <div className="text-sm mt-0.5">Please enter a valid agent!</div>
        </div>,
        { toastId: 'sagent-no-agent' }
      );
      document.getElementById('sagent-agent')?.focus();
      return;
    }
    fetchRows(true);
  };

  // Settle Party narrows the list as you type; Balance runs down the rows on screen
  const filteredRows = useMemo(() => {
    const term = settleFilter.trim().toLowerCase();
    const list = term ? rows.filter(r => r.partyName.toLowerCase().includes(term)) : rows;
    let running = 0;
    return list.map(r => {
      running += r.debit - r.credit;
      return { ...r, balance: running };
    });
  }, [rows, settleFilter]);
  const allChecked = filteredRows.length > 0 && filteredRows.every(r => checked.has(r.ledgerId));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filteredRows.map(r => r.ledgerId)));

  const toggleCheck = (ledgerId: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(ledgerId)) next.delete(ledgerId); else next.add(ledgerId);
      return next;
    });
  };

  // A party's own balance (Dr − Cr) for the Save form: from the loaded list, else the party's
  // Admin Cash balance up to the form's date
  const loadSaveBalance = async (p: LedgerDto, date: string) => {
    const row = rows.find(r => r.ledgerId === p.id);
    if (row) { setSaveBalance(row.partyBalance); return; }
    try {
      const params = new URLSearchParams({ partyId: String(p.id), fromDate: date, toDate: date });
      const res = await apiRequest<{ closing: number }>(`/transactions/admin-cash?${params.toString()}`);
      setSaveBalance(res.data?.closing || 0);
    } catch {
      setSaveBalance(0);
    }
  };

  const applyPartyToSaveForm = (row: SettlementRow) => {
    const ledger = ledgers.find(l => l.id === row.ledgerId) || null;
    setSaveParty(ledger);
    setSavePartySearch(ledger?.partyName || row.partyName);
    setSaveBalance(row.partyBalance);
    // Go-Settle puts the party's balance in the form, on its own side, dated as the Go-Settle box
    setSaveType(row.partyBalance > 0 ? 'Credit' : 'Debit');
    setSaveAmount(row.partyBalance ? String(Math.round(Math.abs(row.partyBalance))) : '');
    setSaveDate(settleDate);
    setTimeout(() => document.getElementById('sagent-amount')?.focus(), 0);
  };

  const handleGoSettle = () => {
    const firstChecked = filteredRows.find(r => checked.has(r.ledgerId));
    if (!firstChecked) {
      notify('error', 'Please check a party row first!', 'sagent-tick');
      return;
    }
    applyPartyToSaveForm(firstChecked);
  };

  const handleSaveSettlement = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    if (!saveParty || saveParty.partyName.toUpperCase() !== savePartySearch.trim().toUpperCase()) {
      notify('error', 'Please enter a valid party!', 'sagent-save-party');
      return;
    }
    if (!saveDate) {
      notify('error', 'Please select Date!', 'sagent-save-date');
      return;
    }
    const amt = parseFloat(saveAmount);
    if (!amt || amt <= 0) {
      notify('error', 'Please enter a valid amount!', 'sagent-save-amt');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/vouchers/settlement', {
        method: 'POST',
        body: JSON.stringify({
          partyLedgerId: saveParty.id,
          entrySide: saveType === 'Credit' ? 'CR' : 'DR',
          amount: amt,
          narration: saveRemark.trim() || undefined,
          voucherDate: saveDate,
        }),
      });
      notify('success', 'Entry has been saved successfully!', `sagent-saved-${Date.now()}`);
      setSaveAmount('');
      setSaveRemark('');
      fetchRows();
    } catch (err: any) {
      notify('error', err.message || 'Failed to save settlement entry');
    } finally {
      setSaving(false);
    }
  };

  // F2 = Save, as the button says
  const saveRef = useRef(handleSaveSettlement);
  saveRef.current = handleSaveSettlement;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2') return;
      e.preventDefault();
      saveRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const totalCredit = filteredRows.reduce((s, r) => s + r.credit, 0);
  const totalDebit = filteredRows.reduce((s, r) => s + r.debit, 0);
  const th = 'py-2.5 px-3 border-r border-[#223b63]';
  const td = 'py-2 px-3 font-semibold text-slate-700 border-r border-slate-200';

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Settlement Agent</span>

        <span className="font-bold text-sm text-slate-900">Month</span>
        <select id="sagent-month" value={month} onChange={(e) => setMonth(e.target.value)} onKeyDown={enterTo('sagent-year')} className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400">
          {Object.keys(MONTH_INDEX).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select id="sagent-year" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} onKeyDown={enterTo('sagent-agent')} className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400">
          {Array.from({ length: 8 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <select
          id="sagent-agent"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value ? parseInt(e.target.value, 10) : '')}
          onKeyDown={enterTo('sagent-search-btn')}
          className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <option value="">--CHOOSE AGENT--</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
        </select>

        <button
          id="sagent-search-btn"
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="px-10 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-80 inline-flex items-center gap-1.5"
        >
          Search
          {loading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-600 font-medium">Settle Party</span>
          <div className="w-60">
            <PartyPicker
              parties={ledgers}
              value={settleFilter}
              onChange={setSettleFilter}
              onPick={(p) => setSettleFilter(p.partyName)}
              onInvalid={() => {}}
              inputRef={settlePartyRef}
              placeholder="ENTER SETTLE A/C"
              className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase placeholder:text-slate-300 focus:outline-none focus:bg-[#fde68a]"
            />
          </div>
        </div>

      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1 max-h-[calc(100vh-250px)]">
          <table className="w-auto min-w-[840px] text-left text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className={`${th} w-10 text-center`}>SR</th>
                <th className={`${th} w-10 text-center`}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={filteredRows.length === 0} />
                </th>
                <th className={`${th} w-72`}>Party Name</th>
                <th className={`${th} w-20 text-right`}>Credit</th>
                <th className={`${th} w-20 text-right`}>Debit</th>
                <th className={`${th} w-20 text-right`}>Balance</th>
                <th className={`${th} w-28 text-center`}>Updated By</th>
                <th className={`${th} w-32 text-center`}>Updated Date</th>
              </tr>
            </thead>
            <tbody className="font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">Choose an agent and search to view records.</td></tr>
              ) : (
                filteredRows.map((r, idx) => (
                  <tr key={r.ledgerId} className="even:bg-slate-50/60 hover:bg-slate-50 [&>td]:border-b [&>td]:border-slate-200">
                    <td className={`${td} text-center`}>{idx + 1}</td>
                    <td className={`${td} text-center`}>
                      <input type="checkbox" checked={checked.has(r.ledgerId)} onChange={() => toggleCheck(r.ledgerId)} />
                    </td>
                    <td
                      className={`${td} uppercase bg-[#f1f1f1] cursor-pointer hover:text-blue-700`}
                      onClick={() => applyPartyToSaveForm(r)}
                      title="Put this party in the Save form"
                    >
                      {r.partyName}
                    </td>
                    <td className={`${td} text-right`}>{r.credit ? fmt(r.credit) : ''}</td>
                    <td className={`${td} text-right`}>{r.debit ? fmt(r.debit) : ''}</td>
                    <td className={`${td} text-right`}>{crDr(r.balance)}</td>
                    <td className={`${td} text-center uppercase`}>{r.updatedBy}</td>
                    <td className={`${td} text-center`}>{formatTimestamp(r.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {/* Footer as live: SR | Tik | Total | ΣCredit | ΣDebit | Balance (= ΣDebit − ΣCredit) */}
            {!loading && filteredRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className={`${th} text-center`} title={`${filteredRows.length} parties`}>SR</td>
                  <td className={`${th} text-center`} title={`${checked.size} ticked`}>Tik</td>
                  <td className={th}>Total</td>
                  <td className={`${th} text-right`}>{fmt(totalCredit)}</td>
                  <td className={`${th} text-right`}>{fmt(totalDebit)}</td>
                  <td className={`${th} text-right`}>{crDr(totalDebit - totalCredit)}</td>
                  <td className={`${th} text-center`}>Updated By</td>
                  <td className={`${th} text-center`}>Updated Date</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="border-t border-slate-300 bg-white flex flex-wrap items-stretch">
        {/* Live: a Go-Settle box on the left — its date, then Go-Settle (the first ticked party into the form) */}
        <div className="p-2.5 flex flex-col gap-1.5 border-r border-slate-200">
          <DateDMYInput value={settleDate} onChange={setSettleDate} idPrefix="sagent-settleDate" />
          <button
            type="button"
            onClick={handleGoSettle}
            className="px-6 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded shadow-xs"
          >
            Go-Settle
          </button>
        </div>
        <form onSubmit={handleSaveSettlement} className="p-2.5 flex flex-wrap items-end gap-3 flex-1">
          <div>
            <label className="block text-slate-600 font-semibold mb-1 text-[10px]">Date</label>
            <DateDMYInput value={saveDate} onChange={setSaveDate} idPrefix="sagent-saveDate" onEnterFromYear={() => savePartyRef.current?.focus()} />
          </div>
          <div className="w-60">
            <label className="block text-slate-600 font-semibold mb-1 text-[10px]">
              Party &amp; <span className="text-rose-600">Balance: {crDr(saveBalance)}</span>
            </label>
            <PartyPicker
              parties={ledgers}
              value={savePartySearch}
              onChange={(t) => { setSavePartySearch(t); setSaveParty(null); setSaveBalance(0); }}
              onPick={(p) => { setSaveParty(p); setSavePartySearch(p.partyName); loadSaveBalance(p, saveDate); }}
              onInvalid={() => notify('error', 'Please enter a valid party!', 'sagent-save-party')}
              inputRef={savePartyRef}
              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold uppercase text-slate-900 focus:outline-none focus:bg-[#fde68a]"
            />
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Type</label>
            <select value={saveType} onChange={(e) => setSaveType(e.target.value as 'Credit' | 'Debit')} className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold">
              <option value="Credit">Credit</option>
              <option value="Debit">Debit</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Amount</label>
            <input id="sagent-amount" type="number" min="0" step="any" value={saveAmount} onChange={(e) => setSaveAmount(e.target.value)} className="w-28 px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono font-bold focus:outline-none focus:bg-[#fde68a]" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-slate-600 font-semibold mb-1">Remark</label>
            <input type="text" value={saveRemark} onChange={(e) => setSaveRemark(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs" />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-[#1e3a8a] hover:bg-[#172554] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
          >
            {saving ? 'Saving...' : <>Save <span className="text-[10px] font-semibold">(F2)</span></>}
          </button>
        </form>
        </div>
      </div>
    </div>
  );
};
