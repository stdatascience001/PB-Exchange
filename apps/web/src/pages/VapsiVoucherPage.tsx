import React, { useState, useEffect, useMemo } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { X, Edit2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { AutoVapsiModal, vapsiYears, VapsiSummaryRow } from '../components/AutoVapsiModal.js';
import { PartyPicker } from '../components/PartyPicker.js';

const VOUCHER_TYPE = 'VAPSI';
const PAGE_TITLE = 'Vapsi Voucher';

interface ManualVoucherItem {
  id: number;
  voucherNumber: string;
  totalAmount: number;
  narration: string | null;
  auditStatus: string;
  partyLedgerId: number;
  partyName: string;
  entrySide: string;
  oppositeLedgerId: number;
  oppositePartyName: string;
  createdByUsername: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

// Browser-local today (toISOString() is UTC and gave yesterday before 05:30 IST).
const todayInputDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Live list prints 2026-08-31 and 2026-08-31 08:25:37 (stored wall-clock values).
const isoDay = (iso: string) => iso.slice(0, 10);
const isoStamp = (iso: string) => iso.slice(0, 19).replace('T', ' ');

const notify = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

// Create Vapsi Voucher inputs: white, light border, soft yellow while focused (live).
const VIN = 'w-full h-[30px] px-2.5 bg-white border border-[#c9d3e0] rounded-xs text-[13px] text-slate-800 focus:outline-none focus:bg-[#fde68a] focus:border-amber-300';

export const VapsiVoucherPage: React.FC = () => {
  const [list, setList] = useState<ManualVoucherItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [parties, setParties] = useState<LedgerDto[]>([]);
  const [voucherDate, setVoucherDate] = useState(todayInputDate());
  const [partyId, setPartyId] = useState<number | null>(null);
  const [partySearch, setPartySearch] = useState('');
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);
  const [entrySide, setEntrySide] = useState<'DR' | 'CR'>('CR');
  const [oppositeId, setOppositeId] = useState<number | null>(null);
  const [oppositeSearch, setOppositeSearch] = useState('');
  const [showOppositeDropdown, setShowOppositeDropdown] = useState(false);
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [fromMonth, setFromMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [fromYear, setFromYear] = useState(new Date().getFullYear());
  const [pnl, setPnl] = useState('');
  const [payment, setPayment] = useState('');
  const [vapsiPercent, setVapsiPercent] = useState('');
  const [vapsiOn, setVapsiOn] = useState<'PL' | 'PAYMENT'>('PL');
  const [finalVapsi, setFinalVapsi] = useState('');
  const [finalVapsiTouched, setFinalVapsiTouched] = useState(false);
  const [thirdParties, setThirdParties] = useState<{ ledgerId: number; partyName: string; vapsiPercent: string }[]>([]);
  // Auto Vapsi (F3) popup
  const [showAutoVapsi, setShowAutoVapsi] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ voucherType: VOUCHER_TYPE, fromDate, toDate });
      const res = await apiRequest<ManualVoucherItem[]>(`/vouchers/manual?${params.toString()}`);
      if (res.data) setList(res.data);
    } catch (err) {
      console.warn('Failed to load vouchers:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchParties = async () => {
    try {
      const res = await apiRequest<LedgerDto[]>('/ledgers');
      if (res.data) setParties(res.data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchList();
    fetchParties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        openAddModal();
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setShowAutoVapsi(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filteredList = useMemo(() => {
    if (!search.trim()) return list;
    const term = search.trim().toLowerCase();
    return list.filter(v =>
      v.partyName.toLowerCase().includes(term) || v.oppositePartyName.toLowerCase().includes(term)
    );
  }, [list, search]);

  const openAddModal = () => {
    setEditingId(null);
    setVoucherDate(todayInputDate());
    setPartyId(null);
    setPartySearch('');
    setOppositeId(null);
    setOppositeSearch('');
    setEntrySide('CR');
    setAmount('');
    setRemark('');
    setFromMonth(MONTH_NAMES[new Date().getMonth()]);
    setFromYear(new Date().getFullYear());
    setPnl('');
    setPayment('');
    setVapsiPercent('');
    setVapsiOn('PL');
    setFinalVapsi('');
    setFinalVapsiTouched(false);
    setThirdParties([]);
    setShowModal(true);
  };

  const openEditModal = (item: ManualVoucherItem) => {
    setEditingId(item.id);
    setVoucherDate(item.createdAt.slice(0, 10));
    setPartyId(item.partyLedgerId);
    setPartySearch(item.partyName);
    setOppositeId(item.oppositeLedgerId);
    setOppositeSearch(item.oppositePartyName);
    setEntrySide(item.entrySide === 'CR' ? 'CR' : 'DR');
    setAmount(String(item.totalAmount));
    setRemark(item.narration || '');
    // From Month/Year, P&L, Payment and Vapsi % aren't stored fields on the voucher itself
    // (this schema only persists the final settled amount) — narration carries the period,
    // so we parse it back out on edit; the 3rd Party table seeds from the single opposite
    // ledger this voucher was actually saved against.
    const monthYearMatch = (item.narration || '').match(/^([A-Za-z]+)\s+(\d{4})/);
    setFromMonth(monthYearMatch ? monthYearMatch[1] : MONTH_NAMES[new Date().getMonth()]);
    setFromYear(monthYearMatch ? parseInt(monthYearMatch[2], 10) : new Date().getFullYear());
    setPnl('');
    setPayment('');
    setVapsiPercent('');
    setVapsiOn('PL');
    setFinalVapsi(String(item.totalAmount));
    setFinalVapsiTouched(true);
    setThirdParties([{ ledgerId: item.oppositeLedgerId, partyName: item.oppositePartyName, vapsiPercent: '' }]);
    setShowModal(true);
  };

  // Create (not Edit): picking the party / month fills P&L (= Final-PL), Payment, Vapsi % and
  // the party's 3rd Party Rebate rows from the month's real data; everything stays editable.
  useEffect(() => {
    if (!showModal || editingId || !partyId) return;
    const monthNo = MONTH_NAMES.indexOf(fromMonth) + 1;
    if (monthNo < 1) return;
    let cancelled = false;
    (async () => {
      setSummaryLoading(true);
      try {
        const params = new URLSearchParams({ month: String(monthNo), year: String(fromYear), partyId: String(partyId), withHp: '1' });
        const res = await apiRequest<{ rows: VapsiSummaryRow[] }>(`/transactions/vapsi-summary?${params.toString()}`);
        const r = res.data?.rows?.[0];
        if (cancelled) return;
        setPnl(r ? String(Math.round(r.finalPl * 100) / 100) : '0');
        setPayment(r ? String(Math.round(r.payment * 100) / 100) : '0');
        setVapsiPercent(r ? String(r.vapsiPct) : '');
        setThirdParties((r?.thirdParties || [])
          .filter(t => t.ledgerId)
          .map(t => ({ ledgerId: t.ledgerId as number, partyName: t.partyName, vapsiPercent: String(t.percent) })));
        setFinalVapsiTouched(false);
        if (r?.done) notify('error', `Vapsi for ${fromMonth} ${fromYear} is already posted for this party!`, 'vapsi-done');
      } catch (err: any) {
        if (!cancelled) notify('error', err.message || 'Failed to load party month', 'vapsi-summary');
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, editingId, partyId, fromMonth, fromYear]);

  // 3rd party share = the same base as Final Vapsi (P&L or Payment) × its Vapsi %.
  const vapsiBase = () => {
    const b = vapsiOn === 'PL' ? parseFloat(pnl) : parseFloat(payment);
    return isNaN(b) ? 0 : Math.max(0, b);
  };
  const thirdPartyAmount = (pct: string) => Math.round(vapsiBase() * (parseFloat(pct) || 0)) / 100;

  useEffect(() => {
    if (finalVapsiTouched) return;
    const base = vapsiOn === 'PL' ? parseFloat(pnl) : parseFloat(payment);
    const pct = parseFloat(vapsiPercent);
    if (!isNaN(base) && !isNaN(pct)) {
      setFinalVapsi((Math.max(0, base) * pct / 100).toFixed(2));
    }
  }, [pnl, payment, vapsiPercent, vapsiOn, finalVapsiTouched]);

  const handleAddThirdParty = () => {
    if (!oppositeId || !oppositeSearch.trim()) return;
    if (thirdParties.some(t => t.ledgerId === oppositeId)) {
      setOppositeId(null);
      setOppositeSearch('');
      return;
    }
    setThirdParties(prev => [...prev, { ledgerId: oppositeId, partyName: oppositeSearch, vapsiPercent }]);
    setOppositeId(null);
    setOppositeSearch('');
  };

  const handleRemoveThirdParty = (ledgerId: number) => {
    setThirdParties(prev => prev.filter(t => t.ledgerId !== ledgerId));
  };

  const handleThirdPartyPercentChange = (ledgerId: number, value: string) => {
    setThirdParties(prev => prev.map(t => t.ledgerId === ledgerId ? { ...t, vapsiPercent: value } : t));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) {
      const amt = parseFloat(finalVapsi);
      if (!partyId) return notify('error', 'Please select Party Name from the list!', 'vapsi-party');
      if (!(amt > 0) && !thirdParties.some(t => thirdPartyAmount(t.vapsiPercent) > 0)) {
        return notify('error', 'Final Vapsi must be more than 0!', 'vapsi-amt');
      }
      setSaving(true);
      try {
        await apiRequest('/transactions/vapsi-process', {
          method: 'POST',
          body: JSON.stringify({
            month: MONTH_NAMES.indexOf(fromMonth) + 1,
            year: fromYear,
            voucherDate,
            items: [{
              partyId,
              amount: amt > 0 ? amt : 0,
              thirdParties: thirdParties.map(t => ({ ledgerId: t.ledgerId, amount: thirdPartyAmount(t.vapsiPercent) })),
            }],
          }),
        });
        notify('success', 'Vapsi Voucher has been created successfully!', `vapsi-saved-${Date.now()}`);
        setShowModal(false);
        fetchList();
      } catch (err: any) {
        notify('error', err.message || 'Failed to save voucher');
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!partyId || thirdParties.length === 0 || !finalVapsi) {
      alert('Please select a Party and add at least one 3rd Party before saving.');
      return;
    }
    setSaving(true);
    try {
      // Schema only supports one opposite ledger per voucher, so when multiple 3rd Party
      // rows are added, the first one carries the actual ledger entry — same reuse-the-
      // existing-endpoint approach used for Hawa Patti Voucher.
      const payload = {
        voucherType: VOUCHER_TYPE,
        voucherDate,
        partyLedgerId: partyId,
        entrySide,
        oppositeLedgerId: thirdParties[0].ledgerId,
        amount: parseFloat(finalVapsi),
        narration: `${fromMonth} ${fromYear}`,
      };
      if (editingId) {
        await apiRequest(`/vouchers/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiRequest('/vouchers', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowModal(false);
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Failed to save voucher');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this voucher?')) return;
    try {
      await apiRequest(`/vouchers/${id}`, { method: 'DELETE' });
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Failed to delete voucher');
    }
  };

  const filteredPartyOptions = useMemo(() => {
    if (!partySearch.trim()) return parties;
    return parties.filter(p => p.partyName.toLowerCase().includes(partySearch.trim().toLowerCase()));
  }, [parties, partySearch]);

  const filteredOppositeOptions = useMemo(() => {
    if (!oppositeSearch.trim()) return parties;
    return parties.filter(p => p.partyName.toLowerCase().includes(oppositeSearch.trim().toLowerCase()));
  }, [parties, oppositeSearch]);

  // Live ledger running-balance isn't tracked anywhere in this system yet, so it always
  // shows 0 here, same as the reference screenshot; Limit is real data from the ledger.
  const selectedPartyLimit = parties.find(p => p.id === partyId)?.betLimit ?? 0;

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <div className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">{PAGE_TITLE}</span>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Party</span>
            <div className="w-40 sm:w-56">
              <PartyPicker
                parties={parties}
                value={search}
                onChange={setSearch}
                onPick={(p) => setSearch(p.partyName)}
                onInvalid={() => {}}
                className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:bg-[#fde68a] shadow-xs"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={openAddModal}
            className="ml-auto px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors"
          >
            Add (F2)
          </button>
        </div>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr.No</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Date</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">C/D</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Opposite Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Updated By</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Updated Date</th>
                <th className="py-2.5 px-4 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">Loading vouchers...</td></tr>
              ) : filteredList.length === 0 ? (
                <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">No {PAGE_TITLE.toLowerCase()} records found.</td></tr>
              ) : (
                filteredList.map((v, idx) => (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-semibold text-slate-700 border-r border-slate-200">{isoDay(v.createdAt)}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{v.partyName}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                      {Math.round(v.totalAmount)}
                    </td>
                    <td className="py-2 px-4 text-center font-semibold text-slate-700 border-r border-slate-200">
                      {v.entrySide === 'CR' ? 'Cr' : 'Dr'}
                    </td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{v.oppositePartyName}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{v.updatedBy}</td>
                    <td className="py-2 px-4 font-semibold text-slate-700 border-r border-slate-200">{isoStamp(v.updatedAt)}</td>
                    <td className="py-2 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(v)}
                          title="Edit"
                          className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(v.id)}
                          className="px-2.5 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[10px] font-bold rounded-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <td className="py-2.5 px-3 border-r border-[#223b63] text-center">{filteredList.length || 'Sr.No'}</td>
                <td className="py-2.5 px-4 border-r border-[#223b63]">Date</td>
                <td className="py-2.5 px-4 border-r border-[#223b63]">Party</td>
                <td className="py-2.5 px-4 border-r border-[#223b63] text-right">
                  {filteredList.length ? Math.round(filteredList.reduce((s, v) => s + v.totalAmount, 0)) : 'Amount'}
                </td>
                <td className="py-2.5 px-3 border-r border-[#223b63] text-center">C/D</td>
                <td className="py-2.5 px-4 border-r border-[#223b63]">Opposite Party</td>
                <td className="py-2.5 px-4 border-r border-[#223b63]">Updated By</td>
                <td className="py-2.5 px-4 border-r border-[#223b63]">Updated Date</td>
                <td className="py-2.5 px-4 text-center">Action</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Bottom bar: Auto Vapsi (F3) */}
      <div className="mt-2 bg-[#1f3a63] rounded-md px-4 py-2.5 flex items-center justify-between">
        <span className="text-amber-400 text-xs font-medium">Need Help?</span>
        <button
          type="button"
          onClick={() => setShowAutoVapsi(true)}
          className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs"
        >
          Auto Vapsi <span className="text-[10px] font-semibold">(F3)</span>
        </button>
      </div>

      <AutoVapsiModal open={showAutoVapsi} onClose={() => setShowAutoVapsi(false)} onProcessed={fetchList} />

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-3 pt-5 z-50 animate-in fade-in duration-150">
          {/* Live "Create Vapsi Voucher" layout: 115 | 115 | wide Party | Voucher Date, then
              P&L | Payment | narrow Vapsi % | Vapsi On | Final Vapsi, then the 3rd Party table. */}
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-[800px] overflow-visible border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-4 flex items-center justify-between rounded-t-lg">
              <h2 className="text-base font-bold tracking-tight">{editingId ? `Edit ${PAGE_TITLE}` : `Create ${PAGE_TITLE}`}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-300 hover:text-white p-0.5" title="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="text-[13px] text-slate-700">
              <div className="px-4 pt-4 pb-4 space-y-3">
                <div className="grid grid-cols-[115px_115px_1fr_180px] gap-4">
                  <div>
                    <label className="block mb-1">From Month</label>
                    <select
                      value={fromMonth}
                      onChange={(e) => setFromMonth(e.target.value)}
                      className={`${VIN} font-bold cursor-pointer`}
                    >
                      {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1">From Year</label>
                    <select
                      value={fromYear}
                      onChange={(e) => setFromYear(parseInt(e.target.value, 10) || fromYear)}
                      className={`${VIN} font-bold cursor-pointer`}
                    >
                      {(vapsiYears().includes(fromYear) ? vapsiYears() : [...vapsiYears(), fromYear]).map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1" title={`Limit: ${selectedPartyLimit}`}>Party Name</label>
                    <PartyPicker
                      parties={parties}
                      value={partySearch}
                      onChange={(t) => { setPartySearch(t); setPartyId(null); }}
                      onPick={(p) => { setPartyId(p.id); setPartySearch(p.partyName); }}
                      onInvalid={() => notify('error', 'Please select Party Name from the list!', 'vapsi-party')}
                      className={`${VIN} font-bold uppercase`}
                    />
                  </div>
                  <div>
                    <label className="block mb-1">Voucher Date</label>
                    <input type="date" required value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} className={`${VIN} font-bold`} />
                  </div>
                </div>

                <div className="grid grid-cols-[180px_180px_50px_115px_180px] gap-4">
                  <div>
                    <label className="block mb-1">P&amp;L</label>
                    <input type="number" value={pnl} onChange={(e) => setPnl(e.target.value)} className={VIN} />
                  </div>
                  <div>
                    <label className="block mb-1">Payment</label>
                    <input type="number" value={payment} onChange={(e) => setPayment(e.target.value)} className={VIN} />
                  </div>
                  <div>
                    <label className="block mb-1 whitespace-nowrap">Vapsi %</label>
                    <input type="number" value={vapsiPercent} onChange={(e) => setVapsiPercent(e.target.value)} className={`${VIN} !px-1 text-center`} />
                  </div>
                  <div>
                    <label className="block mb-1">Vapsi On</label>
                    <select value={vapsiOn} onChange={(e) => setVapsiOn(e.target.value as 'PL' | 'PAYMENT')} className={`${VIN} font-bold cursor-pointer`}>
                      <option value="PL">PL</option>
                      <option value="PAYMENT">PAYMENT</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1">Final Vapsi</label>
                    <input
                      type="number"
                      required
                      value={finalVapsi}
                      onChange={(e) => { setFinalVapsi(e.target.value); setFinalVapsiTouched(true); }}
                      className={VIN}
                    />
                  </div>
                </div>

                {/* 3rd Party (TPV) table — fills from the party's 3rd Party Rebate links */}
                <div className="w-[570px] max-w-full">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#152847] text-white font-bold text-[12px]">
                        <th className="py-3 px-2.5 border-r border-[#2b446f] w-9">Sr</th>
                        <th className="py-3 px-3 border-r border-[#2b446f]">3rd Party</th>
                        <th className="py-3 px-3 border-r border-[#2b446f] w-20">Vapsi %</th>
                        <th className="py-3 px-3 w-24">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="text-[12px]">
                      {summaryLoading && (
                        <tr><td colSpan={4} className="py-2 px-3 text-center text-slate-400 border border-slate-200">Loading...</td></tr>
                      )}
                      {thirdParties.map((t, idx) => (
                        <tr key={t.ledgerId} className="border-b border-slate-200">
                          <td className="py-1 px-2.5 font-semibold border-x border-slate-200">{idx + 1}</td>
                          <td className="py-1 px-3 font-bold uppercase border-r border-slate-200">
                            <div className="flex items-center justify-between gap-2">
                              <span>{t.partyName}</span>
                              <button type="button" onClick={() => handleRemoveThirdParty(t.ledgerId)} className="text-red-500 hover:text-red-700" title="Remove">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                          <td className="py-0.5 px-1 border-r border-slate-200">
                            <input
                              type="number"
                              value={t.vapsiPercent}
                              onChange={(e) => handleThirdPartyPercentChange(t.ledgerId, e.target.value)}
                              className="w-full px-1.5 py-0.5 bg-white border border-slate-200 rounded-xs text-center focus:outline-none focus:bg-[#fde68a]"
                            />
                          </td>
                          <td className="py-1 px-3 text-right font-bold border-r border-slate-200">{thirdPartyAmount(t.vapsiPercent)}</td>
                        </tr>
                      ))}
                      {/* add a 3rd party by hand (kept from the earlier form) */}
                      <tr className="border-b border-slate-200">
                        <td className="border-x border-slate-200"></td>
                        <td className="py-1 px-1 border-r border-slate-200" colSpan={2}>
                          <PartyPicker
                            parties={parties}
                            value={oppositeSearch}
                            onChange={(t) => { setOppositeSearch(t); setOppositeId(null); }}
                            onPick={(p) => { setOppositeId(p.id); setOppositeSearch(p.partyName); }}
                            onInvalid={() => {}}
                            className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded-xs text-[11px] uppercase placeholder:text-slate-400 focus:outline-none focus:bg-[#fde68a]"
                          />
                        </td>
                        <td className="py-1 px-1 border-r border-slate-200 text-center">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={handleAddThirdParty}
                            disabled={!oppositeId}
                            className="px-3 py-0.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-[11px] rounded-xs disabled:opacity-40"
                            title="Add 3rd party"
                          >
                            +
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end px-4 py-3.5 border-t border-slate-200">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-[#1f3f7a] hover:bg-[#172f5c] text-white font-bold rounded-xs text-[13px] shadow-xs disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
