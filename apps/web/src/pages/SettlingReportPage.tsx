import React, { useState, useEffect, useMemo } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';

interface SettlingReportPageProps {
  onNavigate?: (page: string) => void;
}

interface SettlingRow {
  date: string;
  opBal: number;
  totalSale: number;
  dSale: number;
  aSale: number;
  comm: number;
  dOpen: number;
  aOpen: number;
  hissa: number;
  tpc: number;
  hpAmt: number;
  rbt: number;
  pnl: number;
  payment: number;
  balance: number;
}

interface SettlingData {
  partyId: number;
  partyName: string;
  agentName: string;
  rate: string;
  limit: number;
  balance: number;
  rows: SettlingRow[];
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Math.round(Math.abs(n || 0)).toLocaleString('en-IN');
const crDr = (n: number) => (n >= 0 ? 'Cr' : 'Dr');

export const SettlingReportPage: React.FC<SettlingReportPageProps> = ({ onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [ledgers, setLedgers] = useState<LedgerDto[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedParty, setSelectedParty] = useState<LedgerDto | null>(null);
  const [data, setData] = useState<SettlingData | null>(null);
  const [loading, setLoading] = useState(false);

  const [saveDate, setSaveDate] = useState(todayInputDate());
  const [saveType, setSaveType] = useState<'Credit' | 'Debit'>('Credit');
  const [saveAmount, setSaveAmount] = useState('');
  const [saveRemark, setSaveRemark] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest<LedgerDto[]>('/ledgers');
        if (res.data) setLedgers(res.data);
      } catch {
        // ignore
      }
    })();
  }, []);

  const filteredParties = useMemo(() => {
    if (!partySearch.trim()) return [];
    const term = partySearch.trim().toLowerCase();
    return ledgers.filter(l => l.partyName.toLowerCase().includes(term)).slice(0, 10);
  }, [ledgers, partySearch]);

  const fetchReport = async (partyId: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ partyId: String(partyId), fromDate, toDate });
      const res = await apiRequest<SettlingData>(`/transactions/settling-report?${params.toString()}`);
      if (res.data) setData(res.data);
    } catch (err) {
      console.warn('Failed to load settling report:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectParty = (p: LedgerDto) => {
    setSelectedParty(p);
    setPartySearch(p.partyName);
    setShowDropdown(false);
    fetchReport(p.id);
  };

  useEffect(() => {
    if (selectedParty) fetchReport(selectedParty.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  const handleSaveSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedParty) {
      alert('Please select a party first.');
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
          partyLedgerId: selectedParty.id,
          entrySide: saveType === 'Credit' ? 'CR' : 'DR',
          amount: amt,
          narration: saveRemark.trim() || undefined,
          voucherDate: saveDate,
        }),
      });
      setSaveAmount('');
      setSaveRemark('');
      fetchReport(selectedParty.id);
    } catch (err: any) {
      alert(err.message || 'Failed to save settlement entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-center gap-2.5 relative">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mr-2">Settling Report</span>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-600 font-medium">From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
          <span className="text-slate-600 font-medium">To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
        </div>

        <div className="relative flex items-center gap-1.5">
          <span className="text-slate-600 font-medium">Party</span>
          <input
            type="text"
            value={partySearch}
            onChange={(e) => { setPartySearch(e.target.value); setShowDropdown(true); setSelectedParty(null); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="Search party..."
            className="w-56 px-2.5 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          {showDropdown && filteredParties.length > 0 && (
            <div className="absolute left-14 top-full mt-1 w-56 bg-white border border-slate-300 shadow-2xl rounded z-50 max-h-52 overflow-y-auto">
              {filteredParties.map((p, idx) => (
                <div
                  key={p.id}
                  onMouseDown={() => handleSelectParty(p)}
                  className={`px-3 py-1.5 text-xs uppercase cursor-pointer font-semibold ${idx === 0 ? 'bg-amber-400 text-white' : 'text-slate-800 hover:bg-amber-50'}`}
                >
                  {p.partyName}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="px-3 py-1 bg-[#ec897a] text-white rounded-full text-[11px] font-bold">Agent: {data?.agentName ?? 'null'}</span>
          <span className="px-3 py-1 bg-[#ec897a] text-white rounded-full text-[11px] font-bold">Rate: {data?.rate ?? '0/0 | 0/0'}</span>
          <span className="px-3 py-1 bg-[#ec897a] text-white rounded-full text-[11px] font-bold">
            Balance: {data ? fmt(data.balance) : 0} {data ? crDr(data.balance) : 'Cr'}
          </span>
          <span className="px-3 py-1 bg-[#ec897a] text-white rounded-full text-[11px] font-bold">Limit: {data ? fmt(data.limit) : 0} Cr</span>
        </div>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap sticky top-0 z-10">
                <th className="py-2 px-3 border-r border-[#223b63]">Date</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">OP-Bal</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Total Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Dara Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Akhar Sale</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Comm</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-center">D/A-Open</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Hissa</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">TPC</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">HP-Amt</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">RBT</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">P&amp;L</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Payment</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-right">Balance</th>
                <th className="py-2 px-3 text-center w-16">Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={15} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !data ? (
                <tr><td colSpan={15} className="py-14 text-center text-slate-400 font-medium">Search for a party to view their settling report.</td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={15} className="py-14 text-center text-slate-400 font-medium">No records found for this date range.</td></tr>
              ) : (
                data.rows.map(r => (
                  <tr key={r.date} className="hover:bg-slate-50 transition-colors">
                    <td className="py-1.5 px-3 font-mono text-slate-700 border-r border-slate-200">{r.date.split('-').reverse().join('-')}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.opBal)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-900 border-r border-slate-200">{fmt(r.totalSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.dSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.aSale)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-rose-700 border-r border-slate-200">{fmt(r.comm)}</td>
                    <td className="py-1.5 px-3 text-center font-mono text-slate-700 border-r border-slate-200">{fmt(r.dOpen)}/{fmt(r.aOpen)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.hissa)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-500 border-r border-slate-200">{fmt(r.tpc)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-500 border-r border-slate-200">{fmt(r.hpAmt)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-500 border-r border-slate-200">{fmt(r.rbt)}</td>
                    <td className={`py-1.5 px-3 text-right font-mono font-bold border-r border-slate-200 ${r.pnl >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>{fmt(r.pnl)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-slate-700 border-r border-slate-200">{fmt(r.payment)}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-200">{fmt(r.balance)}</td>
                    <td className="py-1.5 px-3 text-center">
                      {r.balance === 0 ? (
                        <span className="px-2 py-0.5 bg-[#00897b] text-white text-[10px] font-bold rounded">OK</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => alert(`OP-Bal ${fmt(r.opBal)} + P&L ${fmt(r.pnl)} - Payment ${fmt(r.payment)} = Balance ${fmt(r.balance)} ${crDr(r.balance)}`)}
                          className="w-6 h-6 bg-[#1e3a8a] hover:bg-[#172554] text-white text-[10px] font-bold rounded"
                        >
                          ?
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleSaveSettlement} className="border-t border-slate-300 p-2.5 flex flex-wrap items-end gap-3 bg-white">
          <div>
            <label className="block text-slate-600 font-semibold mb-1">Date</label>
            <input type="date" value={saveDate} onChange={(e) => setSaveDate(e.target.value)} className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs" />
          </div>
          <div>
            <label className="block text-slate-600 font-semibold mb-1">
              Party &amp; Balance: <span className="text-rose-600">{data ? fmt(data.balance) : 0}</span>
            </label>
            <input type="text" disabled value={selectedParty?.partyName || ''} className="w-40 px-2 py-1.5 bg-slate-100 border border-slate-300 rounded text-xs font-bold uppercase text-slate-700" />
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
            disabled={saving || !selectedParty}
            className="px-6 py-2 bg-[#1e3a8a] hover:bg-[#172554] text-white font-bold text-xs rounded shadow-xs disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save (F2)'}
          </button>
        </form>
      </div>
    </div>
  );
};
