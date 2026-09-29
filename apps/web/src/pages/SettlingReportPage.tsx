import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';
import { PartyPicker } from '../components/PartyPicker.js';

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

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Signed whole numbers, as the live report prints them (-579067, -17165, 3303).
const fmt = (n: number) => String(Math.round(n || 0));
// Balance badges: positive = Dr (party owes), negative = Cr — "Balance: 592278 Cr".
const crDr = (n: number) => `${Math.abs(Math.round(n || 0))} ${n < 0 ? 'Cr' : 'Dr'}`;

const notify = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">{kind === 'error' ? 'Error' : 'Message'}</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

export const SettlingReportPage: React.FC<SettlingReportPageProps> = ({ onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [ledgers, setLedgers] = useState<LedgerDto[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [selectedParty, setSelectedParty] = useState<LedgerDto | null>(null);
  const [data, setData] = useState<SettlingData | null>(null);
  const [loading, setLoading] = useState(false);

  // Payment form (bottom bar) — its own Party box and that party's balance.
  const [saveDate, setSaveDate] = useState(todayInputDate());
  const [payPartySearch, setPayPartySearch] = useState('');
  const [payParty, setPayParty] = useState<LedgerDto | null>(null);
  const [payBalance, setPayBalance] = useState<number | null>(null);
  const [saveType, setSaveType] = useState<'Credit' | 'Debit'>('Credit');
  const [saveAmount, setSaveAmount] = useState('');
  const [saveRemark, setSaveRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const payFormRef = useRef<HTMLFormElement>(null);
  const reportPartyRef = useRef<HTMLInputElement>(null);
  const payPartyRef = useRef<HTMLInputElement>(null);

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

  const loadSettling = async (partyId: number, from: string, to: string) => {
    const params = new URLSearchParams({ partyId: String(partyId), fromDate: from, toDate: to });
    const res = await apiRequest<SettlingData>(`/transactions/settling-report?${params.toString()}`);
    return res.data || null;
  };

  // Latest request wins: a slow reply for a party that has since been cleared/changed must
  // not refill the table.
  const reportReqRef = useRef(0);

  const fetchReport = async (partyId: number) => {
    if (!fromDate || !toDate) return notify('error', 'Please select both Dates!', 'settling-date');
    if (fromDate > toDate) return notify('error', 'From Date cannot be after To Date!', 'settling-date');
    const reqId = ++reportReqRef.current;
    setLoading(true);
    try {
      const result = await loadSettling(partyId, fromDate, toDate);
      if (reqId === reportReqRef.current) setData(result);
    } catch (err: any) {
      console.warn('Failed to load settling report:', err);
      setData(null);
      notify('error', err.message || 'Failed to load settling report', 'settling-load');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectParty = (p: LedgerDto) => {
    setSelectedParty(p);
    setPartySearch(p.partyName);
    fetchReport(p.id);
  };

  useEffect(() => {
    if (selectedParty) fetchReport(selectedParty.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  // Payment form's "Party & Balance": that party's balance up to the payment date.
  const loadPayBalance = async (p: LedgerDto, date: string) => {
    try {
      const d = await loadSettling(p.id, date, date);
      setPayBalance(d ? d.balance : null);
    } catch {
      setPayBalance(null);
    }
  };

  const handlePickPayParty = (p: LedgerDto) => {
    setPayParty(p);
    setPayPartySearch(p.partyName);
    loadPayBalance(p, saveDate || todayInputDate());
  };

  useEffect(() => {
    if (payParty && saveDate) loadPayBalance(payParty, saveDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveDate]);

  const handleSaveSettlement = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    if (!payParty || payParty.partyName.toUpperCase() !== payPartySearch.trim().toUpperCase()) {
      notify('error', 'Please enter a valid party!', 'settling-pay-party');
      return;
    }
    if (!saveDate) {
      notify('error', 'Please select Date!', 'settling-pay-date');
      return;
    }
    const amt = parseFloat(saveAmount);
    if (!amt || amt <= 0) {
      notify('error', 'Please enter a valid amount!', 'settling-pay-amt');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/vouchers/settlement', {
        method: 'POST',
        body: JSON.stringify({
          partyLedgerId: payParty.id,
          entrySide: saveType === 'Credit' ? 'CR' : 'DR',
          amount: amt,
          narration: saveRemark.trim() || undefined,
          voucherDate: saveDate,
        }),
      });
      notify('success', 'Payment has been saved successfully!', `settling-saved-${Date.now()}`);
      setSaveAmount('');
      setSaveRemark('');
      loadPayBalance(payParty, saveDate);
      if (selectedParty) fetchReport(selectedParty.id);
    } catch (err: any) {
      notify('error', err.message || 'Failed to save settlement entry');
    } finally {
      setSaving(false);
    }
  };

  // F2 = Save the payment form, as the button says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        payFormRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const badge = 'px-4 py-1 text-white rounded-full text-[13px] font-semibold whitespace-nowrap';
  const th = 'py-2 px-3 border-r border-[#223b63]';
  const td = 'py-2 px-3 text-right font-semibold text-slate-700 border-r border-slate-200';

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-start gap-4">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 mt-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mt-1.5 mr-auto">Settling Report</span>

        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2.5 gap-y-1.5">
          <span className="text-slate-700 font-bold text-[13px] text-right">From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded-xs text-xs font-semibold text-slate-800" />
          <span className="text-slate-700 font-bold text-[13px]">To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded-xs text-xs font-semibold text-slate-800" />
          <span className="text-slate-700 font-bold text-[13px] text-right">Party</span>
          <div className="col-span-3">
            <PartyPicker
              parties={ledgers}
              value={partySearch}
              onChange={(t) => {
                setPartySearch(t);
                // Clearing or retyping the party drops the old report: empty table and the
                // badges back to Agent - / Rate 0/0 | 0/0 / Balance 0 / Limit 0, as live.
                if (selectedParty && t.trim().toUpperCase() !== selectedParty.partyName.toUpperCase()) {
                  reportReqRef.current++;
                  setSelectedParty(null);
                  setData(null);
                  setLoading(false);
                } else if (!selectedParty) {
                  setData(null);
                }
              }}
              onPick={handleSelectParty}
              onInvalid={() => notify('error', 'Please enter a valid party!', 'settling-party')}
              onInvalidName={() => {
                notify('error', 'Please enter a valid party name!', 'settling-party-name');
                reportReqRef.current++;
                setPartySearch('');
                setSelectedParty(null);
                setData(null);
                setLoading(false);
                setTimeout(() => reportPartyRef.current?.focus(), 0);
              }}
              inputRef={reportPartyRef}
              className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded-xs text-xs font-bold text-slate-900 uppercase focus:outline-none focus:bg-[#fde68a]"
            />
          </div>
        </div>

        <div className="ml-auto flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <span className={`${badge} bg-[#f0936f]`}>Agent: {data?.agentName ?? '-'}</span>
            <span className={`${badge} bg-[#f0936f]`}>Rate: {data?.rate ?? '0/0 | 0/0'}</span>
          </div>
          <div className="flex gap-2">
            <span className={`${badge} bg-[#ee6a6a]`}>Balance: {data ? crDr(data.balance) : 0}</span>
            <span className={`${badge} bg-[#ee6a6a]`}>Limit: {data ? `${Math.round(data.limit)} Cr` : 0}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[12px] whitespace-nowrap sticky top-0 z-10">
                <th className={th}>Date</th>
                <th className={`${th} text-right`}>OP-Bal</th>
                <th className={`${th} text-right`}>Total Sale</th>
                <th className={`${th} text-right`}>Dara Sale</th>
                <th className={`${th} text-right`}>Akhar Sale</th>
                <th className={`${th} text-right`}>Comm</th>
                <th className={`${th} text-center`}>D/A-Open</th>
                <th className={`${th} text-right`}>Hissa</th>
                <th className={`${th} text-right`}>TPC</th>
                <th className={`${th} text-right`}>HP-Amt</th>
                <th className={`${th} text-right`}>RBT</th>
                <th className={`${th} text-right`}>P&amp;L</th>
                <th className={`${th} text-center`}>Payment</th>
                <th className={`${th} text-center`}>Balance</th>
                <th className="py-2 px-3 text-center w-16">Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={15} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !data ? null : data.rows.length === 0 ? (
                <tr><td colSpan={15} className="py-14 text-center text-slate-400 font-medium">No records found for this date range.</td></tr>
              ) : (
                data.rows.map(r => (
                  <tr key={r.date} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-200 bg-[#f1f1f1]">{r.date.split('-').reverse().join('-')}</td>
                    <td className={td}>{fmt(r.opBal)}</td>
                    <td className={td}>{fmt(r.totalSale)}</td>
                    <td className={td}>{fmt(r.dSale)}</td>
                    <td className={td}>{fmt(r.aSale)}</td>
                    <td className={td}>{fmt(r.comm)}</td>
                    <td className={`${td} !text-center`}>{fmt(r.dOpen)}/{fmt(r.aOpen)}</td>
                    <td className={td}>{fmt(r.hissa)}</td>
                    <td className={td}>{fmt(r.tpc)}</td>
                    <td className={td}>{fmt(r.hpAmt)}</td>
                    <td className={td}>{fmt(r.rbt)}</td>
                    <td className={td}>{fmt(r.pnl)}</td>
                    <td className={`${td} bg-[#f1f1f1]`}>{fmt(r.payment)}</td>
                    <td className={td}>{fmt(r.balance)}</td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => notify('success', `OP-Bal ${fmt(r.opBal)} + P&L ${fmt(r.pnl)} - Payment ${fmt(r.payment)} = Balance ${fmt(r.balance)} (${crDr(r.balance)})`, `settling-check-${r.date}`)}
                        className="w-6 h-5 bg-[#1e3a8a] hover:bg-[#172554] text-white text-[10px] font-bold rounded-xs"
                        title="How this balance adds up"
                      >
                        ?
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Payment form */}
        <form ref={payFormRef} onSubmit={handleSaveSettlement} className="border-t-2 border-[#152847] p-2.5 flex flex-wrap items-end gap-5 bg-white">
          <div>
            <label className="block text-slate-600 mb-1 text-[10px]">Date</label>
            <input type="date" value={saveDate} onChange={(e) => setSaveDate(e.target.value)} className="px-2 py-1.5 bg-white border border-slate-300 rounded-xs text-xs font-semibold" />
          </div>
          <div className="w-64">
            <label className="block text-slate-600 mb-1 text-[10px]">
              Party &amp; Balance: <span className="text-rose-600">{payBalance !== null ? crDr(payBalance) : 0}</span>
            </label>
            <PartyPicker
              parties={ledgers}
              value={payPartySearch}
              onChange={(t) => { setPayPartySearch(t); setPayParty(null); setPayBalance(null); }}
              onPick={handlePickPayParty}
              onInvalid={() => notify('error', 'Please enter a valid party!', 'settling-pay-party')}
              onInvalidName={() => {
                notify('error', 'Please enter a valid party name!', 'settling-pay-party-name');
                setPayPartySearch('');
                setPayParty(null);
                setPayBalance(null);
                setTimeout(() => payPartyRef.current?.focus(), 0);
              }}
              inputRef={payPartyRef}
              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-xs text-xs font-bold uppercase text-slate-900 focus:outline-none focus:bg-[#fde68a]"
            />
          </div>
          <div>
            <label className="block text-slate-600 mb-1 text-[10px]">Type</label>
            <select value={saveType} onChange={(e) => setSaveType(e.target.value as 'Credit' | 'Debit')} className="w-28 px-2 py-1.5 bg-white border border-slate-300 rounded-xs text-xs font-bold focus:outline-none focus:bg-[#fde68a]">
              <option value="Credit">Credit</option>
              <option value="Debit">Debit</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-600 mb-1 text-[10px]">Amount</label>
            <input type="number" min="0" step="any" value={saveAmount} onChange={(e) => setSaveAmount(e.target.value)} className="w-32 px-2 py-1.5 bg-white border border-slate-300 rounded-xs text-xs font-bold focus:outline-none focus:bg-[#fde68a]" />
          </div>
          <div className="w-56">
            <label className="block text-slate-600 mb-1 text-[10px]">Remark</label>
            <input type="text" value={saveRemark} onChange={(e) => setSaveRemark(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-xs text-xs focus:outline-none focus:bg-[#fde68a]" />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-9 py-2 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded-xs shadow-xs disabled:opacity-50"
          >
            {saving ? 'Saving...' : <>Save <span className="text-[10px] font-semibold">(F2)</span></>}
          </button>
        </form>
      </div>
    </div>
  );
};
