import React, { useState, useEffect, useMemo } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { X, Edit2, Trash2 } from 'lucide-react';

const VOUCHER_TYPE = 'KIST';
const PAGE_TITLE = 'Kist Voucher';

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

export const KistVoucherPage: React.FC = () => {
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
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyId || !oppositeId || !amount) return;
    setSaving(true);
    try {
      const payload = {
        voucherType: VOUCHER_TYPE,
        voucherDate,
        partyLedgerId: partyId,
        entrySide,
        oppositeLedgerId: oppositeId,
        amount: parseFloat(amount),
        narration: remark.trim() || undefined,
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
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Date</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Party</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">Cr/Dr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Opposite Party</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Remark</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Added</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Updated</th>
                <th className="py-2.5 px-4 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">Loading vouchers...</td></tr>
              ) : filteredList.length === 0 ? (
                <tr><td colSpan={10} className="py-14 text-center text-slate-400 font-medium">No {PAGE_TITLE.toLowerCase()} records found.</td></tr>
              ) : (
                filteredList.map((v, idx) => (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono text-slate-600 border-r border-slate-200">{formatDateOnly(v.createdAt)}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{v.partyName}</td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${v.entrySide === 'CR' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {v.entrySide}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                      {v.totalAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{v.oppositePartyName}</td>
                    <td className="py-2 px-4 text-slate-600 border-r border-slate-200 whitespace-normal max-w-xs">{v.narration || '-'}</td>
                    <td className="py-1 px-4 border-r border-slate-200 leading-snug">
                      <div className="font-bold text-slate-900 uppercase text-[11px]">{v.createdByUsername}</div>
                      <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(v.createdAt)}</div>
                    </td>
                    <td className="py-1 px-4 border-r border-slate-200 leading-snug">
                      <div className="font-bold text-slate-900 uppercase text-[11px]">{v.updatedBy}</div>
                      <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(v.updatedAt)}</div>
                    </td>
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
                  <label className="block text-slate-700 font-bold mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={voucherDate}
                    onChange={(e) => setVoucherDate(e.target.value)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="relative col-span-2 sm:col-span-1">
                  <label className="block text-slate-700 font-bold mb-1 whitespace-nowrap">
                    Party
                    <span className="font-normal text-rose-600">, Balance: 0</span>
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
                  <label className="block text-slate-700 font-bold mb-1">Cr/Dr</label>
                  <select
                    value={entrySide}
                    onChange={(e) => setEntrySide(e.target.value as 'DR' | 'CR')}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800"
                  >
                    <option value="CR">Cr</option>
                    <option value="DR">Dr</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Amount</label>
                  <input
                    type="number"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="relative">
                  <label className="block text-slate-700 font-bold mb-1">Opposite Party</label>
                  <input
                    type="text"
                    required
                    value={oppositeSearch}
                    onChange={(e) => { setOppositeSearch(e.target.value); setOppositeId(null); setShowOppositeDropdown(true); }}
                    onFocus={() => setShowOppositeDropdown(true)}
                    onBlur={() => setTimeout(() => setShowOppositeDropdown(false), 150)}
                    placeholder="Search opposite party..."
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:border-blue-500"
                  />
                  {showOppositeDropdown && filteredOppositeOptions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-300 shadow-xl rounded z-50 max-h-40 overflow-y-auto">
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

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Remark</label>
                  <input
                    type="text"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                  />
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
