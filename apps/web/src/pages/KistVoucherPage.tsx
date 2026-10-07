import React, { useState, useEffect, useMemo } from 'react';
import { LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { DateDMYInput } from '../components/DateDMYInput.js';
import { PartyNameInput } from '../components/PartyNameInput.js';
import { X, Edit2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { AutoKistModal } from '../components/AutoKistModal.js';

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

// One installment in the right-hand Party panel (GET /vouchers/kist-schedule)
interface KistScheduleItem {
  id: number;
  planId: number;
  kistNo: number;
  kistDate: string;
  amount: number;
  status: string;
  voucherId: number | null;
  kistType: string;
}

const KIST_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const pad2 = (n: number) => String(n).padStart(2, '0');

// Live list shows dates as 2026-09-05 and Updated Date as 2026-08-23 05:16:34.
const formatIsoDate = (dateVal?: string) => {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return dateVal;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const formatIsoDateTime = (dateVal?: string) => {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return dateVal;
  return `${formatIsoDate(dateVal)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

const messageToast = (kind: 'success' | 'error', text: string, toastId?: string) =>
  toast[kind](
    <div>
      <div className="font-bold text-base">Message</div>
      <div className="text-sm mt-0.5">{text}</div>
    </div>,
    toastId ? { toastId } : undefined
  );

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

  // "Create Kist Voucher" popup (Add F2) — the old single-voucher form above stays for Edit.
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [kistPartyId, setKistPartyId] = useState<number | null>(null);
  const [kistPartySearch, setKistPartySearch] = useState('');
  const [showKistPartyDropdown, setShowKistPartyDropdown] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [kistStartDate, setKistStartDate] = useState(todayInputDate());
  const [oneKistAmount, setOneKistAmount] = useState('');
  const [kistType, setKistType] = useState<(typeof KIST_TYPES)[number]>('DAILY');
  const [kistRemark, setKistRemark] = useState('');
  const [creatingKist, setCreatingKist] = useState(false);
  // Create Kist popup Enter flow (as live): Party Name (pick from its list) -> Credit Amount ->
  // Kist Start Date DD -> MM -> YYYY -> One Kist Amount -> Kist Type -> Remark -> Save
  const [kistPartyHi, setKistPartyHi] = useState(0);
  const focusKist = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  const kistEnterTo = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusKist(id);
  };
  // A click on the dimmed area outside a popup closes it (as Esc / X do); only a press that
  // starts AND ends there counts, so a drag from inside the box doesn't
  const backdropDownRef = React.useRef(false);
  const backdropProps = (close: () => void) => ({
    onMouseDown: (e: React.MouseEvent) => { backdropDownRef.current = e.target === e.currentTarget; },
    onClick: (e: React.MouseEvent) => {
      if (backdropDownRef.current && e.target === e.currentTarget) close();
      backdropDownRef.current = false;
    },
  });

  // Right-hand Party panel: installments of the party picked in the list (or just created).
  const [panelParty, setPanelParty] = useState<{ id: number; name: string } | null>(null);
  const [schedule, setSchedule] = useState<KistScheduleItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  // Auto Kist (F3) popup: pick a date, tick its due kists, Process Voucher
  const [showAutoKist, setShowAutoKist] = useState(false);

  // notifyEmpty: page open and the Party Enter show the live "Error / Record not avaliable!"
  // message when nothing comes back; date changes reload quietly.
  const fetchList = async (notifyEmpty = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ voucherType: VOUCHER_TYPE, fromDate, toDate });
      const res = await apiRequest<ManualVoucherItem[]>(`/vouchers/manual?${params.toString()}`);
      if (res.data) setList(res.data);
      if (notifyEmpty && (!res.data || res.data.length === 0)) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'kist-no-record' }
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

  const firstLoadRef = React.useRef(true);
  useEffect(() => {
    fetchList(firstLoadRef.current);
    firstLoadRef.current = false;
    fetchParties();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  // Page opens with the cursor on the From date's day part; Enter then walks
  // From DD -> MM -> YYYY -> To DD -> MM -> YYYY -> Party (Up/Down steps the focused part)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = document.getElementById('kv-from-dd') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        openCreateModal();
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setShowAutoKist(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc closes the Create Kist / Edit popup, the same as its X (Auto Kist handles its own)
  useEffect(() => {
    if (!showCreateModal && !showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setShowCreateModal(false);
      setShowModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreateModal, showModal]);

  const filteredList = useMemo(() => {
    if (!search.trim()) return list;
    const term = search.trim().toLowerCase();
    return list.filter(v =>
      v.partyName.toLowerCase().includes(term) || v.oppositePartyName.toLowerCase().includes(term)
    );
  }, [list, search]);

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
      // A deleted kist voucher goes back to PENDING in its party's schedule.
      if (panelParty) fetchSchedule(panelParty.id);
    } catch (err: any) {
      alert(err.message || 'Failed to delete voucher');
    }
  };

  const fetchSchedule = async (partyLedgerId: number) => {
    setScheduleLoading(true);
    try {
      const res = await apiRequest<KistScheduleItem[]>(`/vouchers/kist-schedule?partyLedgerId=${partyLedgerId}`);
      setSchedule(res.data || []);
    } catch (err) {
      console.warn('Failed to load kist schedule:', err);
      setSchedule([]);
    } finally {
      setScheduleLoading(false);
    }
  };

  const selectPanelParty = (id: number, name: string) => {
    if (!id) return;
    setPanelParty({ id, name });
    fetchSchedule(id);
  };

  const openCreateModal = () => {
    setKistPartyId(null);
    setKistPartySearch('');
    setCreditAmount('');
    setKistStartDate(todayInputDate());
    setOneKistAmount('');
    setKistType('DAILY');
    setKistRemark('');
    setShowCreateModal(true);
  };

  const handleCreateKist = async (e: React.FormEvent) => {
    e.preventDefault();
    const credit = parseFloat(creditAmount);
    const oneKist = parseFloat(oneKistAmount);
    let problem = '';
    if (!kistPartyId) {
      // Live: "Invalid Party / Please enter all valid Party!", cursor back on Party Name
      toast.error(
        <div>
          <div className="font-bold text-base">Invalid Party</div>
          <div className="text-sm mt-0.5">Please enter all valid Party!</div>
        </div>,
        { toastId: 'kist-invalid-party' }
      );
      focusKist('kv-c-party');
      return;
    }
    if (!(credit > 0)) problem = 'Please enter Credit Amount!';
    else if (!kistStartDate) problem = 'Please enter Kist Start Date!';
    else if (!(oneKist > 0)) problem = 'Please enter One Kist Amount!';
    else if (oneKist > credit) problem = 'One Kist Amount cannot be more than Credit Amount!';
    if (problem) {
      messageToast('error', problem, 'kist-invalid');
      return;
    }
    setCreatingKist(true);
    try {
      await apiRequest('/vouchers/kist-plans', {
        method: 'POST',
        body: JSON.stringify({
          partyLedgerId: kistPartyId,
          creditAmount: credit,
          oneKistAmount: oneKist,
          kistType,
          startDate: kistStartDate,
          remark: kistRemark.trim() || undefined,
        }),
      });
      messageToast('success', 'Kist Voucher has been created successfully!', `kist-created-${Date.now()}`);
      setShowCreateModal(false);
      // Show the new schedule straight away — its kists stay PENDING (not in the list on the
      // left) until they're processed from the Auto Kist (F3) popup.
      selectPanelParty(kistPartyId!, kistPartySearch);
    } catch (err: any) {
      messageToast('error', err.message || 'Failed to create kist voucher');
    } finally {
      setCreatingKist(false);
    }
  };

  // After Process Voucher: the posted kists show in the list and turn DONE in the panel.
  const handleAutoKistProcessed = () => {
    fetchList();
    if (panelParty) fetchSchedule(panelParty.id);
  };

  const filteredPartyOptions = useMemo(() => {
    if (!partySearch.trim()) return parties;
    return parties.filter(p => p.partyName.toLowerCase().includes(partySearch.trim().toLowerCase()));
  }, [parties, partySearch]);

  const filteredOppositeOptions = useMemo(() => {
    if (!oppositeSearch.trim()) return parties;
    return parties.filter(p => p.partyName.toLowerCase().includes(oppositeSearch.trim().toLowerCase()));
  }, [parties, oppositeSearch]);

  // Create popup's Party Name list: every party A-Z, filtered as you type.
  const kistPartyOptions = useMemo(() => {
    const sorted = [...parties].sort((a, b) => a.partyName.localeCompare(b.partyName));
    const term = kistPartySearch.trim().toLowerCase();
    return term ? sorted.filter(p => p.partyName.toLowerCase().includes(term)) : sorted;
  }, [parties, kistPartySearch]);

  const listTotal = filteredList.reduce((sum, v) => sum + (v.totalAmount || 0), 0);

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
            {/* DD / MM / YYYY (the browser picker showed MM/DD/YYYY); Enter on the year -> To */}
            <DateDMYInput
              value={fromDate}
              onChange={setFromDate}
              idPrefix="kv-from"
              onEnterFromYear={() => {
                const el = document.getElementById('kv-to-dd') as HTMLInputElement | null;
                el?.focus();
                el?.select();
              }}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">To</span>
            {/* Enter on the To year -> Party */}
            <DateDMYInput
              value={toDate}
              onChange={setToDate}
              idPrefix="kv-to"
              onEnterFromYear={() => (document.getElementById('kv-party') as HTMLInputElement | null)?.focus()}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Party</span>
            {/* Party list (every ledger, A-Z, narrowed as you type); Up/Down fills the highlighted
                party in, Enter keeps it and reloads the vouchers (spinner while loading) */}
            <div
              className="w-40 sm:w-56"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  fetchList(true);
                }
              }}
            >
              <PartyNameInput
                id="kv-party"
                value={search}
                onChange={setSearch}
                names={parties.map(p => p.partyName)}
                pickOnEmpty={false}
                fillOnArrow
                className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-[#fde68a] shadow-xs"
              />
            </div>
            {loading && (
              <span className="inline-block h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" title="Loading..." />
            )}
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="ml-auto px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors"
          >
            Add (F2)
          </button>
        </div>

        {/* Left: posted kist vouchers (live columns) | Right: selected party's kist schedule */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 p-0 lg:pr-0">
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63]">Date</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63]">Party</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63] text-right">Amount</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63] text-center">Cr/Dr</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63]">Opposite</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63]">Updated By</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63]">Updated Date</th>
                  <th className="py-2.5 px-3 text-center w-28">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
                {loading ? (
                  <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">Loading vouchers...</td></tr>
                ) : filteredList.length === 0 ? (
                  <tr><td colSpan={9} className="py-14 text-center text-slate-400 font-medium">No {PAGE_TITLE.toLowerCase()} records found.</td></tr>
                ) : (
                  filteredList.map((v, idx) => (
                    <tr
                      key={v.id}
                      onClick={() => selectPanelParty(v.partyLedgerId, v.partyName)}
                      title={v.narration || undefined}
                      className={`cursor-pointer transition-colors ${panelParty?.id === v.partyLedgerId ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}
                    >
                      <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono text-slate-700 border-r border-slate-200">{formatIsoDate(v.createdAt)}</td>
                      <td className="py-2 px-3 font-bold text-slate-900 uppercase border-r border-slate-200">{v.partyName}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                        {v.totalAmount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-2 px-3 text-center font-semibold text-slate-800 border-r border-slate-200">
                        {v.entrySide === 'CR' ? 'Cr' : 'Dr'}
                      </td>
                      <td className="py-2 px-3 font-semibold uppercase text-slate-800 border-r border-slate-200">{v.oppositePartyName}</td>
                      <td className="py-2 px-3 font-semibold uppercase text-slate-800 border-r border-slate-200">{v.updatedBy}</td>
                      <td className="py-2 px-3 font-mono text-slate-700 border-r border-slate-200">{formatIsoDateTime(v.updatedAt)}</td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEditModal(v); }}
                            title="Edit"
                            className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDelete(v.id); }}
                            className="px-2.5 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[10px] font-bold rounded shadow-xs transition-colors"
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
                  <td className="py-2.5 px-3 border-r border-[#223b63] text-center">{filteredList.length || 'Sr'}</td>
                  <td className="py-2.5 px-3 border-r border-[#223b63]">Date</td>
                  <td className="py-2.5 px-3 border-r border-[#223b63]">Party</td>
                  <td className="py-2.5 px-3 border-r border-[#223b63] text-right font-mono">{filteredList.length ? listTotal.toLocaleString('en-IN') : 'Amount'}</td>
                  <td className="py-2.5 px-3 border-r border-[#223b63] text-center">Cr/Dr</td>
                  <td className="py-2.5 px-3 border-r border-[#223b63]">Opposite</td>
                  <td className="py-2.5 px-3 border-r border-[#223b63]">Updated By</td>
                  <td className="py-2.5 px-3 border-r border-[#223b63]">Updated Date</td>
                  <td className="py-2.5 px-3 text-center">Action</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Right: Party kist schedule */}
          <div className="w-full lg:w-[34%] flex-shrink-0 overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <th colSpan={5} className="py-2.5 px-3 border-b border-[#223b63]">
                    Party{panelParty ? <span className="text-amber-300">: {panelParty.name.toUpperCase()}</span> : null}
                  </th>
                </tr>
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <th className="py-2.5 px-3 border-r border-[#223b63] w-10 text-center">Sr</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63]">Date</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63]">Type</th>
                  <th className="py-2.5 px-3 border-r border-[#223b63] text-right">Amount</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
                {!panelParty ? null : scheduleLoading ? (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-400 font-medium">Loading kists...</td></tr>
                ) : schedule.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-400 font-medium">No kist found for this party.</td></tr>
                ) : (
                  schedule.map((k, i) => (
                    <tr key={k.id} className="hover:bg-slate-50">
                      <td className="py-1.5 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{i + 1}</td>
                      <td className="py-1.5 px-3 font-mono text-slate-700 border-r border-slate-200">{k.kistDate}</td>
                      <td className="py-1.5 px-3 font-semibold text-slate-800 border-r border-slate-200">{k.kistType}</td>
                      <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                        {k.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-1.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${k.status === 'DONE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                          {k.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bottom bar: Auto Kist (F3) posts every due PENDING kist */}
      <div className="mt-2 bg-[#1f3a63] rounded-md px-4 py-2.5 flex items-center justify-between">
        <span className="text-amber-400 text-xs font-medium">Need Help?</span>
        <button
          type="button"
          onClick={() => setShowAutoKist(true)}
          className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors"
        >
          Auto Kist <span className="text-[10px] font-semibold">(F3)</span>
        </button>
      </div>

      <AutoKistModal
        open={showAutoKist}
        onClose={() => setShowAutoKist(false)}
        onProcessed={handleAutoKistProcessed}
      />

      {/* Create Kist Voucher popup (Add F2) */}
      {showCreateModal && (
        <div {...backdropProps(() => setShowCreateModal(false))} className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-start justify-center p-3 pt-16 z-50 animate-in fade-in duration-150">
          {/* overflow-visible so the Party Name list can drop past the popup's bottom edge */}
          <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full overflow-visible border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-3 flex items-center justify-between rounded-t-lg">
              <h2 className="text-base font-bold tracking-tight">Create {PAGE_TITLE}</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-white hover:text-slate-300 p-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateKist} className="text-xs">
              <div className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-x-4 gap-y-3">
                <div className="relative sm:col-span-2">
                  <label className="block text-slate-700 mb-1 text-[13px]">Party Name</label>
                  <input
                    id="kv-c-party"
                    type="text"
                    value={kistPartySearch}
                    onChange={(e) => { setKistPartySearch(e.target.value); setKistPartyId(null); setShowKistPartyDropdown(true); setKistPartyHi(0); }}
                    onFocus={() => setShowKistPartyDropdown(true)}
                    onBlur={() => setTimeout(() => setShowKistPartyDropdown(false), 150)}
                    onKeyDown={(e) => {
                      const n = kistPartyOptions.length;
                      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && showKistPartyDropdown && n > 0) {
                        e.preventDefault();
                        setKistPartyHi(i => e.key === 'ArrowDown' ? Math.min(i + 1, n - 1) : Math.max(i - 1, 0));
                      } else if (e.key === 'Enter') {
                        // Pick the highlighted party (typed text only), then on to Credit Amount
                        e.preventDefault();
                        const p = kistPartyOptions[kistPartyHi];
                        if (showKistPartyDropdown && p && kistPartySearch.trim()) {
                          setKistPartyId(p.id); setKistPartySearch(p.partyName);
                        }
                        setShowKistPartyDropdown(false);
                        focusKist('kv-c-credit');
                      }
                    }}
                    autoComplete="off"
                    autoFocus
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xs text-[13px] text-slate-900 focus:outline-none focus:bg-[#fde68a] focus:border-amber-400 uppercase font-semibold"
                  />
                  {showKistPartyDropdown && kistPartyOptions.length > 0 && (
                    <div className="absolute left-0 right-0 bg-white border border-slate-400 shadow-xl z-50 max-h-52 overflow-y-auto">
                      {kistPartyOptions.map((p, idx) => (
                        <div
                          key={p.id}
                          ref={idx === kistPartyHi ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                          onMouseDown={() => { setKistPartyId(p.id); setKistPartySearch(p.partyName); setShowKistPartyDropdown(false); }}
                          className={`px-2.5 py-0.5 text-[13px] uppercase cursor-pointer hover:bg-[#1e66d0] hover:text-white ${kistPartyId === p.id || (idx === kistPartyHi && kistPartySearch.trim()) ? 'bg-[#1e66d0] text-white' : 'text-slate-800'}`}
                        >
                          {p.partyName}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-slate-700 mb-1 text-[13px]">Credit Amount</label>
                  <input id="kv-c-credit" onKeyDown={kistEnterTo('kv-kist-start-dd')} type="number" min="0" step="any" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xs text-[13px] text-slate-900 focus:outline-none focus:bg-[#fde68a] focus:border-amber-400 font-mono font-bold" />
                </div>

                <div>
                  <label className="block text-slate-700 mb-1 text-[13px]">Kist Start Date</label>
                  {/* DD / MM / YYYY, same as the filter bar */}
                  <DateDMYInput value={kistStartDate} onChange={setKistStartDate} idPrefix="kv-kist-start" onEnterFromYear={() => focusKist('kv-c-onekist')} />
                </div>

                <div>
                  <label className="block text-slate-700 mb-1 text-[13px]">One Kist Amount</label>
                  <input id="kv-c-onekist" onKeyDown={kistEnterTo('kv-c-type')} type="number" min="0" step="any" value={oneKistAmount} onChange={(e) => setOneKistAmount(e.target.value)} className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xs text-[13px] text-slate-900 focus:outline-none focus:bg-[#fde68a] focus:border-amber-400 font-mono font-bold" />
                </div>

                <div>
                  <label className="block text-slate-700 mb-1 text-[13px]">Kist Type</label>
                  <select id="kv-c-type" onKeyDown={kistEnterTo('kv-c-remark')} value={kistType} onChange={(e) => setKistType(e.target.value as (typeof KIST_TYPES)[number])} className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xs text-[13px] text-slate-900 focus:outline-none focus:bg-[#fde68a] focus:border-amber-400 font-bold cursor-pointer">
                    {KIST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-slate-700 mb-1 text-[13px]">Remark</label>
                  <input id="kv-c-remark" onKeyDown={kistEnterTo('kv-c-save')} type="text" value={kistRemark} onChange={(e) => setKistRemark(e.target.value)} className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xs text-[13px] text-slate-900 focus:outline-none focus:bg-[#fde68a] focus:border-amber-400" />
                </div>
              </div>

              <div className="flex justify-end px-4 py-3 border-t border-slate-200">
                <button
                  id="kv-c-save"
                  type="submit"
                  disabled={creatingKist}
                  className="px-4 py-2 bg-[#1e3a8a] hover:bg-[#172554] active:bg-[#0f172a] text-white font-bold rounded text-xs shadow-xs disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#1e3a8a]"
                >
                  {creatingKist ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModal && (
        <div {...backdropProps(() => setShowModal(false))} className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full overflow-visible border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between rounded-t-lg">
              <h2 className="text-sm font-bold tracking-tight">{editingId ? `Edit ${PAGE_TITLE}` : `Add ${PAGE_TITLE}`}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-white hover:text-slate-300 p-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Date</label>
                  {/* DD / MM / YYYY, same as the filter bar */}
                  <DateDMYInput value={voucherDate} onChange={setVoucherDate} idPrefix="kv-voucher-date" />
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
