import React, { useState, useEffect, useRef } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';
import { PartyPicker } from '../components/PartyPicker.js';
import { DateDMYInput } from '../components/DateDMYInput.js';

interface AdminCashPageProps {
  onNavigate?: (page: string) => void;
}

// GET /transactions/admin-cash (TransactionService.getAdminCash)
interface AdminCashRow {
  date: string;
  partyName: string;
  credit: number;
  debit: number;
  balance: number;
  remark: string;
  updatedBy: string;
  updatedAt: string;
  voucherId: number | null;
  deletable: boolean;
}

interface AdminCashData {
  partyId: number;
  partyName: string;
  agentName: string;
  rate: string;
  balance: number;
  limit: number;
  opening: number;
  current: number;
  closing: number;
  totalCredit: number;
  totalDebit: number;
  rows: AdminCashRow[];
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const round = (n: number) => Math.round(n || 0);
// Balances are Dr − Cr: negative reads "… Cr", positive "… Dr" (live "610128 Cr").
const crDr = (n: number) => (round(n) === 0 ? '0' : `${Math.abs(round(n))} ${n < 0 ? 'Cr' : 'Dr'}`);
const crDr2 = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : `${Math.abs(n).toFixed(0)} ${n < 0 ? 'Cr' : 'Dr'}`);
const dmy = (ymd: string) => ymd.split('-').reverse().join('-');
// Stored timestamps are wall-clock values; print them as stored (2026-09-28 15:55:53).
const stamp = (iso: string) => iso.slice(0, 19).replace('T', ' ');

const notify = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">{kind === 'error' ? 'Error' : 'Message'}</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

export const AdminCashPage: React.FC<AdminCashPageProps> = ({ onNavigate }) => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [ledgers, setLedgers] = useState<LedgerDto[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [selectedParty, setSelectedParty] = useState<LedgerDto | null>(null);
  const [data, setData] = useState<AdminCashData | null>(null);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);
  const reportPartyRef = useRef<HTMLInputElement>(null);

  // Payment form — its own Party box and that party's balance.
  const [saveDate, setSaveDate] = useState(todayInputDate());
  const [payPartySearch, setPayPartySearch] = useState('');
  const [payParty, setPayParty] = useState<LedgerDto | null>(null);
  const [payBalance, setPayBalance] = useState<number | null>(null);
  const [saveType, setSaveType] = useState<'Credit' | 'Debit'>('Credit');
  const [saveAmount, setSaveAmount] = useState('');
  const [saveRemark, setSaveRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const payFormRef = useRef<HTMLFormElement>(null);
  const payPartyRef = useRef<HTMLInputElement>(null);

  // Live keyboard flow: the page opens with the cursor on From's day; Enter walks From DD ->
  // MM -> YYYY -> To DD -> MM -> YYYY -> Party, where typing lists the parties and Enter picks
  // one (or warns "Please enter a valid party!") — the Party box's own behaviour.
  const focusDatePart = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };
  useEffect(() => {
    focusDatePart('admincash-fromDate-dd');
  }, []);

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

  const loadCash = async (partyId: number, from: string, to: string) => {
    const params = new URLSearchParams({ partyId: String(partyId), fromDate: from, toDate: to });
    const res = await apiRequest<AdminCashData>(`/transactions/admin-cash?${params.toString()}`);
    return res.data || null;
  };

  const fetchReport = async (partyId: number) => {
    if (!fromDate || !toDate) return notify('error', 'Please select both Dates!', 'admin-cash-date');
    if (fromDate > toDate) return notify('error', 'From Date cannot be after To Date!', 'admin-cash-date');
    const reqId = ++reqRef.current;
    setLoading(true);
    try {
      const result = await loadCash(partyId, fromDate, toDate);
      if (reqId === reqRef.current) setData(result);
    } catch (err: any) {
      if (reqId === reqRef.current) setData(null);
      notify('error', err.message || 'Failed to load admin cash', 'admin-cash-load');
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  };

  const clearReport = () => {
    reqRef.current++;
    setSelectedParty(null);
    setData(null);
    setLoading(false);
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

  const loadPayBalance = async (p: LedgerDto, date: string) => {
    try {
      const d = await loadCash(p.id, date, date);
      setPayBalance(d ? d.closing : null);
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

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    if (!payParty || payParty.partyName.toUpperCase() !== payPartySearch.trim().toUpperCase()) {
      notify('error', 'Please enter a valid party!', 'admin-cash-pay-party');
      return;
    }
    if (!saveDate) {
      notify('error', 'Please select Date!', 'admin-cash-pay-date');
      return;
    }
    const amt = parseFloat(saveAmount);
    if (!amt || amt <= 0) {
      notify('error', 'Please enter a valid amount!', 'admin-cash-pay-amt');
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
      notify('success', 'Entry has been saved successfully!', `admin-cash-saved-${Date.now()}`);
      setSaveAmount('');
      setSaveRemark('');
      loadPayBalance(payParty, saveDate);
      if (selectedParty) fetchReport(selectedParty.id);
    } catch (err: any) {
      notify('error', err.message || 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: AdminCashRow) => {
    if (!r.voucherId || !window.confirm('Are you sure you want to delete this entry?')) return;
    try {
      await apiRequest(`/vouchers/${r.voucherId}`, { method: 'DELETE' });
      notify('success', 'Entry has been deleted successfully!', `admin-cash-del-${r.voucherId}`);
      if (selectedParty) fetchReport(selectedParty.id);
      if (payParty) loadPayBalance(payParty, saveDate);
    } catch (err: any) {
      notify('error', err.message || 'Failed to delete entry');
    }
  };

  // F2 = Save the entry form, as the button says.
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

  const handleExportExcel = () => {
    if (!data || data.rows.length === 0) {
      notify('error', 'Record not found!', 'admin-cash-excel');
      return;
    }
    const lines = ['Date,Party Name,Credit,Debit,Balance,Remark,Updated By,Updated Date'];
    lines.push(`${dmy(fromDate)},OPENING,,,${crDr(data.opening)},,OPENING,${fromDate} 00:00:00`);
    for (const r of data.rows) {
      lines.push(`${dmy(r.date)},"${r.partyName}",${r.credit ? round(r.credit) : ''},${r.debit ? round(r.debit) : ''},${crDr(r.balance)},"${r.remark}",${r.updatedBy},${stamp(r.updatedAt)}`);
    }
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI('data:text/csv;charset=utf-8,' + lines.join('\n')));
    link.setAttribute('download', `admin_cash_${data.partyName}_${fromDate}_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const th = 'py-2.5 px-3 border-r border-[#223b63]';
  const td = 'py-2 px-3 border-r border-slate-200 font-semibold text-slate-700';
  const moneyTone = (n: number) => (n < 0 ? 'text-emerald-600' : n > 0 ? 'text-rose-600' : 'text-slate-900');

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col gap-2.5 text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 p-2.5 flex flex-wrap items-start gap-4">
        <button type="button" onClick={() => onNavigate && onNavigate('dashboard')} className="p-1 mt-1 text-slate-800 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm text-slate-900 tracking-tight mt-1.5 mr-auto">Admin Cash</span>

        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2.5 gap-y-1.5">
          <span className="text-slate-700 font-bold text-[13px] text-right">From</span>
          <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="admincash-fromDate" separator="-" onEnterFromYear={() => focusDatePart('admincash-toDate-dd')} />
          <span className="text-slate-700 font-bold text-[13px]">To</span>
          <DateDMYInput value={toDate} onChange={setToDate} idPrefix="admincash-toDate" separator="-" onEnterFromYear={() => reportPartyRef.current?.focus()} />
          <span className="text-slate-700 font-bold text-[13px] text-right">Party</span>
          <div className="col-span-3">
            <PartyPicker
              parties={ledgers}
              value={partySearch}
              onChange={(t) => {
                setPartySearch(t);
                if (!selectedParty || t.trim().toUpperCase() !== selectedParty.partyName.toUpperCase()) clearReport();
              }}
              onPick={handleSelectParty}
              onInvalid={() => notify('error', 'Please enter a valid party!', 'admin-cash-party')}
              onInvalidName={() => {
                notify('error', 'Please enter a valid party name!', 'admin-cash-party-name');
                setPartySearch('');
                clearReport();
                setTimeout(() => reportPartyRef.current?.focus(), 0);
              }}
              inputRef={reportPartyRef}
              className="w-full px-2.5 py-1 bg-[#fde68a] border border-amber-300 rounded-xs text-xs font-bold text-slate-900 uppercase focus:outline-none"
            />
          </div>
        </div>

        {/* [ AGENT ] [ RATE ] / [ BAL | LMT ] */}
        <div className="ml-6 text-[13px] text-slate-800 text-center leading-6">
          <div>[ AGENT: &nbsp;{data?.agentName ?? '-'} ] [ RATE: &nbsp;{data?.rate ?? '0/0 | 0/0'} ]</div>
          <div>[ BAL: &nbsp;{data ? crDr(data.balance) : 0} | LMT: &nbsp;{data ? `${round(data.limit)} Cr` : 0} ]</div>
        </div>

        {/* OPENING / CURRENT / CLOSING */}
        <div className="ml-auto flex items-center gap-5">
          <div className="grid grid-cols-[auto_auto] gap-x-2.5 text-[13px] leading-5">
            <span className="text-right text-slate-800">OPENING:</span>
            <span className={`font-semibold ${data ? moneyTone(data.opening) : 'text-slate-900'}`}>{data ? crDr2(data.opening) : '0.00'}</span>
            <span className="text-right text-slate-800">CURRENT:</span>
            <span className={`font-semibold ${data ? moneyTone(data.current) : 'text-slate-900'}`}>{data ? crDr2(data.current) : '0.00'}</span>
            <span className="text-right text-slate-800">CLOSING:</span>
            <span className={`font-semibold ${data ? moneyTone(data.closing) : 'text-slate-900'}`}>{data ? crDr2(data.closing) : '0.00'}</span>
          </div>
          <button type="button" onClick={handleExportExcel} className="px-11 py-2 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded-xs shadow-xs transition-colors">
            Excel
          </button>
        </div>
      </div>

      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[12px] whitespace-nowrap sticky top-0 z-10">
                <th className={`${th} w-24 text-center`}>Date</th>
                <th className={`${th} w-64 text-center`}>Party Name</th>
                <th className={`${th} w-24 text-right`}>Credit</th>
                <th className={`${th} w-24 text-right`}>Debit</th>
                <th className={`${th} w-36 text-right`}>Balance</th>
                <th className={`${th} w-36 text-center`}>Remark</th>
                <th className={`${th} w-36 text-center`}>Updated By</th>
                <th className={`${th} w-36 text-center`}>Updated Date</th>
                <th className="py-2.5 px-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : !data ? null : (
                <>
                  <tr>
                    <td className={`${td} text-center`}>{dmy(fromDate)}</td>
                    <td className={`${td} text-center`}>OPENING</td>
                    <td className={td}></td>
                    <td className={td}></td>
                    <td className={`${td} text-right`}>{crDr(data.opening)}</td>
                    <td className={td}></td>
                    <td className={`${td} text-center`}>OPENING</td>
                    <td className={`${td} text-center`}>{fromDate} 00:00:00</td>
                    <td className="py-2 px-3 font-semibold text-slate-700">-</td>
                  </tr>
                  {data.rows.map((r, i) => (
                    <tr key={`${r.date}-${i}`} className="even:bg-slate-50/60 hover:bg-slate-50">
                      <td className={`${td} text-center`}>{dmy(r.date)}</td>
                      <td className={`${td} text-center uppercase bg-[#f1f1f1]`}>{r.partyName}</td>
                      <td className={`${td} text-right`}>{r.credit ? round(r.credit) : ''}</td>
                      <td className={`${td} text-right`}>{r.debit ? round(r.debit) : ''}</td>
                      <td className={`${td} text-right`}>{crDr(r.balance)}</td>
                      <td className={`${td} text-center whitespace-normal`}>{r.remark}</td>
                      <td className={`${td} text-center uppercase`}>{r.updatedBy}</td>
                      <td className={`${td} text-center`}>{stamp(r.updatedAt)}</td>
                      <td className="py-2 px-3">
                        {r.deletable && (
                          <button
                            type="button"
                            onClick={() => handleDelete(r)}
                            className="px-2.5 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[10px] font-bold rounded-xs"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
            {!loading && data && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[12px] whitespace-nowrap">
                  <td className={`${th} text-center`}>Date</td>
                  <td className={`${th} text-center`}>Total</td>
                  <td className={`${th} text-right`}>{round(data.totalCredit)}</td>
                  <td className={`${th} text-right`}>{round(data.totalDebit)}</td>
                  <td className={`${th} text-right`}>{crDr(data.closing)}</td>
                  <td className={`${th} text-center`}>Remark</td>
                  <td className={`${th} text-center`}>Updated By</td>
                  <td className={`${th} text-center`}>Updated Date</td>
                  <td className="py-2.5 px-3">Action</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Entry form */}
        <form ref={payFormRef} onSubmit={handleSave} className="border-t-2 border-[#152847] p-2.5 flex flex-wrap items-end gap-5 bg-white">
          <div>
            <label className="block text-slate-600 mb-1 text-[10px]">Date</label>
            <DateDMYInput value={saveDate} onChange={setSaveDate} idPrefix="admincash-saveDate" separator="-" />
          </div>
          <div className="w-64">
            <label className="block text-slate-600 mb-1 text-[10px]">
              Party &amp; <span className="text-rose-600">Balance: {payBalance !== null ? crDr(payBalance) : 0}</span>
            </label>
            <PartyPicker
              parties={ledgers}
              value={payPartySearch}
              onChange={(t) => { setPayPartySearch(t); setPayParty(null); setPayBalance(null); }}
              onPick={handlePickPayParty}
              onInvalid={() => notify('error', 'Please enter a valid party!', 'admin-cash-pay-party')}
              onInvalidName={() => {
                notify('error', 'Please enter a valid party name!', 'admin-cash-pay-party-name');
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
          <button type="submit" disabled={saving} className="px-9 py-2 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded-xs shadow-xs disabled:opacity-50">
            {saving ? 'Saving...' : <>Save <span className="text-[10px] font-semibold">(F2)</span></>}
          </button>
        </form>
      </div>
      <div className="px-1 text-[11px] text-amber-600">Need Help?</div>
    </div>
  );
};
