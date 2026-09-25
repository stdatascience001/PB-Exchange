import React, { useState, useEffect, useMemo } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';

interface SettlementAgentPageProps {
  onNavigate?: (page: string) => void;
}

interface AgentDto {
  id: number;
  agentName: string;
}

interface SettlementRow {
  ledgerId: number;
  partyName: string;
  agentId: number | null;
  agentName: string;
  credit: number;
  debit: number;
  balance: number;
  updatedBy: string;
  updatedAt: string | null;
}

const CALENDAR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_INDEX: Record<string, number> = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 };
const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(Math.abs(n || 0)).toLocaleString('en-IN');
const formatTimestamp = (val: string | null) => {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}-${d.getFullYear()} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
};

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
  const [saveBalance, setSaveBalance] = useState(0);
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
        if (agentRes.data) setAgents(agentRes.data);
      } catch {
        // ignore
      }
    })();
  }, []);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { fromDate, toDate } = monthRange(month, year);
      const params = new URLSearchParams({ fromDate, toDate });
      if (agentId) params.append('agentId', String(agentId));
      const res = await apiRequest<SettlementRow[]>(`/vouchers/settlement-rows?${params.toString()}`);
      if (res.data) setRows(res.data);
      setChecked(new Set());
    } catch (err) {
      console.warn('Failed to load settlement rows:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredRows = useMemo(() => {
    if (!settleFilter.trim()) return rows;
    const term = settleFilter.trim().toLowerCase();
    return rows.filter(r => r.partyName.toLowerCase().includes(term));
  }, [rows, settleFilter]);

  const toggleCheck = (ledgerId: number) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(ledgerId)) next.delete(ledgerId); else next.add(ledgerId);
      return next;
    });
  };

  const applyPartyToSaveForm = (row: SettlementRow) => {
    const ledger = ledgers.find(l => l.id === row.ledgerId) || null;
    setSaveParty(ledger);
    setSaveBalance(row.balance);
  };

  const handleGoSettle = () => {
    const firstChecked = filteredRows.find(r => checked.has(r.ledgerId));
    if (!firstChecked) {
      alert('Please check a party row first.');
      return;
    }
    applyPartyToSaveForm(firstChecked);
  };

  const handleSaveSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saveParty) {
      alert('Please select a party first (use Go-Settle or pick one below).');
      return;
    }
    const amt = parseFloat(saveAmount);
    if (!amt || amt <= 0) {
      alert('Please enter a valid amount.');
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
      setSaveAmount('');
      setSaveRemark('');
      fetchRows();
    } catch (err: any) {
      alert(err.message || 'Failed to save settlement entry');
    } finally {
      setSaving(false);
    }
  };

  const totalCredit = filteredRows.reduce((s, r) => s + r.credit, 0);
  const totalDebit = filteredRows.reduce((s, r) => s + r.debit, 0);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Settlement Agent</span>

        <select value={month} onChange={(e) => setMonth(e.target.value)} className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900">
          {Object.keys(MONTH_INDEX).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900">
          {Array.from({ length: 8 }, (_, i) => now.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value ? parseInt(e.target.value, 10) : '')}
          className="px-2 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase"
        >
          <option value="">-CHOOSE AGENT-</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
        </select>

        <button
          type="button"
          onClick={fetchRows}
          className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs"
        >
          Search
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-600 font-medium">Settle Party</span>
          <input
            type="text"
            value={settleFilter}
            onChange={(e) => setSettleFilter(e.target.value)}
            placeholder="ENTER SETTLE A/C"
            className="w-48 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={handleGoSettle}
          className="ml-auto px-4 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded shadow-xs"
        >
          Go-Settle
        </button>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap sticky top-0 z-10">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-10 text-center">SR</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] w-10 text-center"></th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party Name</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Credit</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Debit</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Balance</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Updated By</th>
                <th className="py-2.5 px-4">Updated Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8} className="py-14 text-center text-slate-400 font-medium">Choose an agent and search to view records.</td></tr>
              ) : (
                filteredRows.map((r, idx) => (
                  <tr key={r.ledgerId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-3 text-center border-r border-slate-200">
                      <input type="checkbox" checked={checked.has(r.ledgerId)} onChange={() => toggleCheck(r.ledgerId)} />
                    </td>
                    <td
                      className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200 cursor-pointer hover:text-blue-700"
                      onClick={() => applyPartyToSaveForm(r)}
                    >
                      {r.partyName}
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-emerald-700 border-r border-slate-200">{fmt(r.credit)}</td>
                    <td className="py-2 px-4 text-right font-mono text-rose-700 border-r border-slate-200">{fmt(r.debit)}</td>
                    <td className={`py-2 px-4 text-right font-mono font-bold border-r border-slate-200 ${r.balance >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.balance)}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.updatedBy}</td>
                    <td className="py-2 px-4 font-mono text-slate-600">{formatTimestamp(r.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td colSpan={3} className="py-2 px-4 border-r border-[#223b63]">Total ({filteredRows.length})</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(totalCredit)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(totalDebit)}</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">{fmt(totalCredit - totalDebit)}</td>
                  <td colSpan={2} className="py-2 px-4"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <form onSubmit={handleSaveSettlement} className="border-t border-slate-300 p-2.5 flex flex-wrap items-end gap-3 bg-white">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Date</label>
            <input type="date" value={saveDate} onChange={(e) => setSaveDate(e.target.value)} className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs" />
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">
              Party &amp; Balance: <span className="text-rose-600">{fmt(saveBalance)}</span>
            </label>
            <input type="text" disabled value={saveParty?.partyName || ''} className="w-40 px-2 py-1.5 bg-slate-100 border border-slate-300 rounded text-xs font-bold uppercase text-slate-700" />
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
            <input type="number" value={saveAmount} onChange={(e) => setSaveAmount(e.target.value)} className="w-28 px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono font-bold" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-slate-600 font-semibold mb-1">Remark</label>
            <input type="text" value={saveRemark} onChange={(e) => setSaveRemark(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs" />
          </div>
          <button
            type="submit"
            disabled={saving || !saveParty}
            className="px-6 py-2 bg-[#1e3a8a] hover:bg-[#172554] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save (F2)'}
          </button>
        </form>
      </div>
    </div>
  );
};
