import React, { useState, useEffect, useMemo } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { X, Edit2, Trash2 } from 'lucide-react';

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

  useEffect(() => {
    if (finalVapsiTouched) return;
    const base = vapsiOn === 'PL' ? parseFloat(pnl) : parseFloat(payment);
    const pct = parseFloat(vapsiPercent);
    if (!isNaN(base) && !isNaN(pct)) {
      setFinalVapsi((base * pct / 100).toFixed(2));
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
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder=""
              className="w-40 sm:w-56 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 shadow-xs"
            />
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
                          title="Delete"
                          className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-300">
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
                    value={fromMonth}
                    onChange={(e) => setFromMonth(e.target.value)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800"
                  >
                    {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">From Year</label>
                  <input
                    type="number"
                    required
                    value={fromYear}
                    onChange={(e) => setFromYear(parseInt(e.target.value, 10) || fromYear)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono font-semibold text-slate-800"
                  />
                </div>

                <div className="relative col-span-2 sm:col-span-1">
                  <label className="block text-slate-700 font-bold mb-1 whitespace-nowrap">
                    Party Name
                    <span className="font-normal text-blue-600"> &amp; Limit: {selectedPartyLimit}</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={partySearch}
                    onChange={(e) => { setPartySearch(e.target.value); setPartyId(null); setShowPartyDropdown(true); }}
                    onFocus={() => setShowPartyDropdown(true)}
                    onBlur={() => setTimeout(() => setShowPartyDropdown(false), 150)}
                    placeholder="Search party..."
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:border-blue-500"
                  />
                  {showPartyDropdown && filteredPartyOptions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-300 shadow-xl rounded z-50 max-h-40 overflow-y-auto">
                      {filteredPartyOptions.map(p => (
                        <div
                          key={p.id}
                          onMouseDown={() => { setPartyId(p.id); setPartySearch(p.partyName); setShowPartyDropdown(false); }}
                          className="px-3 py-1.5 text-xs uppercase cursor-pointer hover:bg-amber-50 font-semibold text-slate-800"
                        >
                          {p.partyName}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Voucher Date</label>
                  <input
                    type="date"
                    required
                    value={voucherDate}
                    onChange={(e) => setVoucherDate(e.target.value)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">P&amp;L</label>
                  <input
                    type="number"
                    value={pnl}
                    onChange={(e) => setPnl(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Payment</label>
                  <input
                    type="number"
                    value={payment}
                    onChange={(e) => setPayment(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Vapsi %</label>
                  <input
                    type="number"
                    value={vapsiPercent}
                    onChange={(e) => setVapsiPercent(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Vapsi On</label>
                  <select
                    value={vapsiOn}
                    onChange={(e) => setVapsiOn(e.target.value as 'PL' | 'PAYMENT')}
                    className="w-full px-3 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900"
                  >
                    <option value="PL">PL</option>
                    <option value="PAYMENT">PAYMENT</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Final Vapsi</label>
                  <input
                    type="number"
                    required
                    value={finalVapsi}
                    onChange={(e) => { setFinalVapsi(e.target.value); setFinalVapsiTouched(true); }}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">3rd Party</label>
                <div className="border border-slate-300 rounded overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#152847] text-white font-bold text-[11px]">
                        <th className="py-1.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                        <th className="py-1.5 px-3 border-r border-[#223b63]">3rd Party</th>
                        <th className="py-1.5 px-3 border-r border-[#223b63] w-28 text-center">Vapsi %</th>
                        <th className="py-1.5 px-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {thirdParties.length === 0 ? (
                        <tr><td colSpan={4} className="py-3 px-3 text-center text-slate-400">No 3rd party added yet.</td></tr>
                      ) : (
                        thirdParties.map((t, idx) => (
                          <tr key={t.ledgerId}>
                            <td className="py-1.5 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                            <td className="py-1.5 px-3 font-bold text-slate-900 uppercase border-r border-slate-200">{t.partyName}</td>
                            <td className="py-1 px-2 border-r border-slate-200">
                              <input
                                type="number"
                                value={t.vapsiPercent}
                                onChange={(e) => handleThirdPartyPercentChange(t.ledgerId, e.target.value)}
                                className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono text-center"
                              />
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <button type="button" onClick={() => handleRemoveThirdParty(t.ledgerId)} className="text-red-500 hover:text-red-700">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <div className="relative flex items-center gap-2 p-2 border-t border-slate-200 bg-slate-50">
                    <input
                      type="text"
                      value={oppositeSearch}
                      onChange={(e) => { setOppositeSearch(e.target.value); setOppositeId(null); setShowOppositeDropdown(true); }}
                      onFocus={() => setShowOppositeDropdown(true)}
                      onBlur={() => setTimeout(() => setShowOppositeDropdown(false), 150)}
                      placeholder="Search 3rd party to add..."
                      className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleAddThirdParty}
                      disabled={!oppositeId}
                      className="px-3 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded disabled:opacity-50"
                    >
                      Add
                    </button>
                    {showOppositeDropdown && filteredOppositeOptions.length > 0 && (
                      <div className="absolute left-2 right-20 top-full mt-1 bg-white border border-slate-300 shadow-xl rounded z-50 max-h-40 overflow-y-auto">
                        {filteredOppositeOptions.map(p => (
                          <div
                            key={p.id}
                            onMouseDown={() => { setOppositeId(p.id); setOppositeSearch(p.partyName); setShowOppositeDropdown(false); }}
                            className="px-3 py-1.5 text-xs uppercase cursor-pointer hover:bg-amber-50 font-semibold text-slate-800"
                          >
                            {p.partyName}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-200">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-1.5 bg-[#1e3a8a] hover:bg-[#172554] active:bg-[#0f172a] text-white font-bold rounded text-xs shadow-xs disabled:opacity-50"
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
