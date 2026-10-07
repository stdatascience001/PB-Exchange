import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { X, Edit2 } from 'lucide-react';
import { AutoHawaPattiModal } from '../components/AutoHawaPattiModal.js';
import { DateDMYInput } from '../components/DateDMYInput.js';
import { PartyPicker } from '../components/PartyPicker.js';
import { toast } from 'react-toastify';

const VOUCHER_TYPE = 'HAWA_PATTI';
const PAGE_TITLE = 'Hawa Patti Voucher';

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

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const formatTimestamp = (dateVal?: string) => {
  if (!dateVal) return '-';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return dateVal;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day}-${month}-${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  } catch {
    return dateVal;
  }
};

const formatDateOnly = (dateVal?: string) => {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return dateVal;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
};

export const HawaPattiVoucherPage: React.FC = () => {
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
  // Auto Hawa Patti (F3) popup
  const [showAutoHp, setShowAutoHp] = useState(false);

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [fromMonth, setFromMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [fromYear, setFromYear] = useState(new Date().getFullYear());
  const [pnl, setPnl] = useState('');
  const [hpPercent, setHpPercent] = useState('');
  const [finalHp, setFinalHp] = useState('');
  const [finalHpTouched, setFinalHpTouched] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ voucherType: VOUCHER_TYPE, fromDate, toDate });
      const res = await apiRequest<ManualVoucherItem[]>(`/vouchers/manual?${params.toString()}`);
      if (res.data) setList(res.data);
      // Live: no vouchers for the dates (null / empty response) -> red "Error / Record not
      // avaliable!" toast (one at a time), with the table left empty
      if (!res.data || res.data.length === 0) {
        setList([]);
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'hpv-empty' }
        );
      }
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

  // Live keyboard flow on the filter bar: the page opens with the cursor on From's day; Enter
  // walks From DD -> MM -> YYYY -> To DD -> MM -> YYYY -> Party (the list filters as you type).
  const focusFilter = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  };
  useEffect(() => {
    focusFilter('hpv-fromDate-dd');
  }, []);
  const filterPartyRef = useRef<HTMLInputElement>(null);

  // Create / Edit Hawa Patti popup Enter flow (as live): From Month -> From Year -> Party Name
  // (pick from its list) -> Voucher Date DD -> MM -> YYYY -> HP Party Name (pick) -> P&L ->
  // HP % -> Final HP -> Save (Enter saves)
  const [hpPartyHi, setHpPartyHi] = useState(0);
  const [hpOppHi, setHpOppHi] = useState(0);
  const focusHm = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  const hmEnterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusHm(id);
  };
  useEffect(() => {
    if (!showModal) return;
    const id = requestAnimationFrame(() => focusHm('hm-from-month'));
    return () => cancelAnimationFrame(id);
  }, [showModal]);
  // Esc (or a click on the dimmed area outside the box) closes the popup, as its X does
  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setShowModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showModal]);
  const hmBackdropDownRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        openAddModal();
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setShowAutoHp(true);
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
    setHpPercent('');
    setFinalHp('');
    setFinalHpTouched(false);
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
    // From Month/Year, P&L and HP% aren't stored fields on the voucher itself (this schema
    // only persists the final settled amount) — narration carries the period, so we parse it
    // back out on edit; P&L/HP% reset since they were only used to derive the saved amount.
    const monthYearMatch = (item.narration || '').match(/^([A-Za-z]+)\s+(\d{4})/);
    setFromMonth(monthYearMatch ? monthYearMatch[1] : MONTH_NAMES[new Date().getMonth()]);
    setFromYear(monthYearMatch ? parseInt(monthYearMatch[2], 10) : new Date().getFullYear());
    setPnl('');
    setHpPercent('');
    setFinalHp(String(item.totalAmount));
    setFinalHpTouched(true);
    setShowModal(true);
  };

  useEffect(() => {
    if (finalHpTouched) return;
    const p = parseFloat(pnl);
    const h = parseFloat(hpPercent);
    if (!isNaN(p) && !isNaN(h)) {
      setFinalHp((p * h / 100).toFixed(2));
    }
  }, [pnl, hpPercent, finalHpTouched]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyId || !oppositeId || !finalHp) return;
    setSaving(true);
    try {
      const payload = {
        voucherType: VOUCHER_TYPE,
        voucherDate,
        partyLedgerId: partyId,
        entrySide,
        oppositeLedgerId: oppositeId,
        amount: parseFloat(finalHp),
        narration: `${fromMonth} ${fromYear}${remark.trim() ? ' - ' + remark.trim() : ''}`,
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
            <DateDMYInput value={fromDate} onChange={setFromDate} idPrefix="hpv-fromDate" separator="-" onEnterFromYear={() => focusFilter('hpv-toDate-dd')} />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">To</span>
            <DateDMYInput value={toDate} onChange={setToDate} idPrefix="hpv-toDate" separator="-" onEnterFromYear={() => filterPartyRef.current?.focus()} />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Party</span>
            {/* Typing lists the parties whose name starts with it (live: DK -> DK ROHIT PAYMENT,
                DK ROHIT 20% …); arrows move, Enter / click picks. The list below filters on
                whatever is typed, as before. */}
            <div className="w-40 sm:w-56">
              <PartyPicker
                parties={parties}
                value={search}
                onChange={setSearch}
                onPick={(p) => setSearch(p.partyName)}
                onInvalid={() => {}}
                inputRef={filterPartyRef}
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
                    <td className="py-2 px-4 font-mono text-slate-600 border-r border-slate-200">{formatDateOnly(v.createdAt)}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{v.partyName}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                      {v.totalAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${v.entrySide === 'CR' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {v.entrySide}
                      </span>
                    </td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{v.oppositePartyName}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{v.updatedBy}</td>
                    <td className="py-2 px-4 font-mono text-slate-600 border-r border-slate-200">{formatTimestamp(v.updatedAt)}</td>
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
          </table>
        </div>
      </div>

      {/* Bottom bar: Auto Hawa Patti (F3) */}
      <div className="mt-2 bg-[#1f3a63] rounded-md px-4 py-2.5 flex items-center justify-between">
        <span className="text-amber-400 text-xs font-medium">Need Help?</span>
        <button
          type="button"
          onClick={() => setShowAutoHp(true)}
          className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs"
        >
          Auto Hawa Patti <span className="text-[10px] font-semibold">(F3)</span>
        </button>
      </div>

      <AutoHawaPattiModal open={showAutoHp} onClose={() => setShowAutoHp(false)} onProcessed={fetchList} />

      {showModal && (
        <div
          onMouseDown={(e) => { hmBackdropDownRef.current = e.target === e.currentTarget; }}
          onClick={(e) => {
            if (hmBackdropDownRef.current && e.target === e.currentTarget) setShowModal(false);
            hmBackdropDownRef.current = false;
          }}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">{editingId ? `Edit ${PAGE_TITLE}` : `Add ${PAGE_TITLE}`}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-white hover:text-slate-300 p-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">From Month</label>
                  <select
                    id="hm-from-month"
                    onKeyDown={hmEnterTo('hm-from-year')}
                    value={fromMonth}
                    onChange={(e) => setFromMonth(e.target.value)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
                  >
                    {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">From Year</label>
                  <input
                    id="hm-from-year"
                    onKeyDown={hmEnterTo('hm-party')}
                    type="number"
                    required
                    value={fromYear}
                    onChange={(e) => setFromYear(parseInt(e.target.value, 10) || fromYear)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono font-semibold text-slate-800 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
                  />
                </div>

                <div className="relative col-span-2 sm:col-span-1">
                  <label className="block text-slate-700 font-bold mb-1 whitespace-nowrap">
                    Party Name
                    <span className="font-normal text-blue-600"> &amp; Limit: {selectedPartyLimit}</span>
                  </label>
                  <input
                    id="hm-party"
                    type="text"
                    required
                    value={partySearch}
                    onChange={(e) => { setPartySearch(e.target.value); setPartyId(null); setShowPartyDropdown(true); setHpPartyHi(0); }}
                    onFocus={() => setShowPartyDropdown(true)}
                    onBlur={() => setTimeout(() => setShowPartyDropdown(false), 150)}
                    onKeyDown={(e) => {
                      const n = filteredPartyOptions.length;
                      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && showPartyDropdown && n > 0) {
                        e.preventDefault();
                        setHpPartyHi(i => e.key === 'ArrowDown' ? Math.min(i + 1, n - 1) : Math.max(i - 1, 0));
                      } else if (e.key === 'Enter') {
                        // Pick the highlighted party (typed text only), then on to Voucher Date
                        e.preventDefault();
                        const p = filteredPartyOptions[hpPartyHi];
                        if (showPartyDropdown && p && partySearch.trim()) {
                          setPartyId(p.id); setPartySearch(p.partyName);
                        }
                        setShowPartyDropdown(false);
                        focusHm('hpv-voucherDate-dd');
                      }
                    }}
                    autoComplete="off"
                    placeholder="Search party..."
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
                  />
                  {showPartyDropdown && filteredPartyOptions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-300 shadow-xl rounded z-50 max-h-40 overflow-y-auto">
                      {filteredPartyOptions.map((p, idx) => (
                        <div
                          key={p.id}
                          ref={idx === hpPartyHi ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                          onMouseDown={() => { setPartyId(p.id); setPartySearch(p.partyName); setShowPartyDropdown(false); }}
                          className={`px-3 py-1.5 text-xs uppercase cursor-pointer hover:bg-amber-50 font-semibold text-slate-800 ${idx === hpPartyHi && partySearch.trim() ? 'bg-[#f6c343]' : ''}`}
                        >
                          {p.partyName}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Voucher Date</label>
                  <DateDMYInput value={voucherDate} onChange={setVoucherDate} idPrefix="hpv-voucherDate" separator="-" onEnterFromYear={() => focusHm('hm-opp')} />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="relative">
                  <label className="block text-slate-700 font-bold mb-1">HP Party Name</label>
                  <input
                    id="hm-opp"
                    type="text"
                    required
                    value={oppositeSearch}
                    onChange={(e) => { setOppositeSearch(e.target.value); setOppositeId(null); setShowOppositeDropdown(true); setHpOppHi(0); }}
                    onFocus={() => setShowOppositeDropdown(true)}
                    onBlur={() => setTimeout(() => setShowOppositeDropdown(false), 150)}
                    onKeyDown={(e) => {
                      const n = filteredOppositeOptions.length;
                      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && showOppositeDropdown && n > 0) {
                        e.preventDefault();
                        setHpOppHi(i => e.key === 'ArrowDown' ? Math.min(i + 1, n - 1) : Math.max(i - 1, 0));
                      } else if (e.key === 'Enter') {
                        // Pick the highlighted HP party (typed text only), then on to P&L
                        e.preventDefault();
                        const p = filteredOppositeOptions[hpOppHi];
                        if (showOppositeDropdown && p && oppositeSearch.trim()) {
                          setOppositeId(p.id); setOppositeSearch(p.partyName);
                        }
                        setShowOppositeDropdown(false);
                        focusHm('hm-pnl');
                      }
                    }}
                    autoComplete="off"
                    placeholder="Search HP party..."
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
                  />
                  {showOppositeDropdown && filteredOppositeOptions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-300 shadow-xl rounded z-50 max-h-40 overflow-y-auto">
                      {filteredOppositeOptions.map((p, idx) => (
                        <div
                          key={p.id}
                          ref={idx === hpOppHi ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                          onMouseDown={() => { setOppositeId(p.id); setOppositeSearch(p.partyName); setShowOppositeDropdown(false); }}
                          className={`px-3 py-1.5 text-xs uppercase cursor-pointer hover:bg-amber-50 font-semibold text-slate-800 ${idx === hpOppHi && oppositeSearch.trim() ? 'bg-[#f6c343]' : ''}`}
                        >
                          {p.partyName}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">P&amp;L</label>
                  <input
                    id="hm-pnl"
                    onKeyDown={hmEnterTo('hm-hp-pct')}
                    type="number"
                    value={pnl}
                    onChange={(e) => setPnl(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">HP %</label>
                  <input
                    id="hm-hp-pct"
                    onKeyDown={hmEnterTo('hm-final')}
                    type="number"
                    value={hpPercent}
                    onChange={(e) => setHpPercent(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Final HP</label>
                  <input
                    id="hm-final"
                    onKeyDown={hmEnterTo('hm-save')}
                    type="number"
                    required
                    value={finalHp}
                    onChange={(e) => { setFinalHp(e.target.value); setFinalHpTouched(true); }}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:bg-[#fef08a] focus:border-amber-300"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-200">
                <button
                  id="hm-save"
                  type="submit"
                  disabled={saving}
                  className="px-6 py-1.5 bg-[#1e3a8a] hover:bg-[#172554] active:bg-[#0f172a] text-white font-bold rounded text-xs shadow-xs disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#1e3a8a]"
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
