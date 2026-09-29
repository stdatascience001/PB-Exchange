import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShiftDto, UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { displayNumber, harufOf } from '../utils/entryDisplay.js';
import { isOwnDataOnlyRole } from '../config/roleAccess.js';
import { X, Search as SearchIcon, Eye, Copy, Trash2, Plus, Edit } from 'lucide-react';

export interface TransactionItem {
  id: number;
  slipNumber: string;
  shiftId: number;
  shiftName: string;
  partyId: number;
  partyName: string;
  totalAmount: number;
  status: string;
  rateStr?: string;
  ujType?: string;
  addedBy?: string;
  updatedBy?: string;
  isD?: boolean;
  auditStatus?: string;
  mistakeRemark?: string | null;
  // Slip was edited after the auditor marked it MISTAKE — Updated column shows in red
  mistakeEdited?: boolean;
  isAudited?: boolean;
  createdAt: string;
  updatedAt: string;
  entries?: { numberValue: string; amount: number; rate?: number; entryType?: string }[];
}

interface TransactionListPageProps {
  shifts?: ShiftDto[];
  user?: UserSession | null;
  onNavigate?: (page: string) => void;
}

export const TransactionListPage: React.FC<TransactionListPageProps> = ({ shifts = [], user, onNavigate }) => {
  const [list, setList] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('3'); // Default to Faridabad (id: 3) matching Screenshot 1
  // Was a hardcoded, non-editable stale date (never wired into the fetch at all) — now a real
  // filter defaulting to today, matching the same "today" convention used elsewhere in the app.
  const [dateStr, setDateStr] = useState<string>(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  // Picking a shift sets the date filter to that shift's own open_date from the API (its live
  // cycle — e.g. an undeclared HYDRABAD NIGHT still on 23-09 while the calendar says 24-09),
  // same as the live panel. Runs once per selected shift (including the initial default once
  // the shift list has loaded), so a date typed in by hand afterwards is left alone and the
  // periodic shift refreshes don't overwrite it.
  const dateSyncedForShiftRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedShiftId || dateSyncedForShiftRef.current === selectedShiftId) return;
    const shift = shifts.find(s => String(s.id) === selectedShiftId);
    if (!shift?.openDate) return;
    dateSyncedForShiftRef.current = selectedShiftId;
    if (/^\d{4}-\d{2}-\d{2}$/.test(shift.openDate)) {
      setDateStr(shift.openDate);
    }
  }, [selectedShiftId, shifts]);
  const [searchParty, setSearchParty] = useState('');
  // A DATA ENTRY OPERATOR's Live Transactions bar on the live reference has neither the
  // "-- ALL STAFF --" nor the status dropdown — the list is already narrowed to their own
  // active slips by the API, so both filters would be no-ops. SUPER ADMIN's bar keeps both.
  const ownDataOnly = isOwnDataOnlyRole(user?.roleName);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  // Bottom-bar Active / Deleted switch (live): Active = live slips, Deleted = slips someone
  // deleted (kept as VOIDED; Updated shows who and when).
  const [listMode, setListMode] = useState<'ACTIVE' | 'DELETED'>('ACTIVE');
  
  // Selected transaction for right-hand panel live preview
  const [selectedTx, setSelectedTx] = useState<TransactionItem | null>(null);

  // Modals (View modal removed - clicking View shows details directly in right-hand panel)
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionItem | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [showJantriModal, setShowJantriModal] = useState(false);
  const [isConsolidated, setIsConsolidated] = useState(false);
  const [isCutConsolidated, setIsCutConsolidated] = useState(false);
  const [showKwadaModal, setShowKwadaModal] = useState(false);
  const [showAbsPartyModal, setShowAbsPartyModal] = useState(false);
  const [showDistributorModal, setShowDistributorModal] = useState(false);
  const [showHPLModal, setShowHPLModal] = useState(false);

  // Kwada Transaction popup: find parties who hit an exact Amount an exact Count of times
  const [kwadaAmount, setKwadaAmount] = useState('');
  const [kwadaCount, setKwadaCount] = useState('');
  const [kwadaResults, setKwadaResults] = useState<{ sr: number; partyId: number; party: string; amount: number }[]>([]);
  const [kwadaLoading, setKwadaLoading] = useState(false);
  const [kwadaSearched, setKwadaSearched] = useState(false);

  // Abs Party (Party Not Working) popup
  const [absentParties, setAbsentParties] = useState<{ sr: number; id: number; party: string; mobile: string; work: number }[]>([]);
  const [absentPartiesLoading, setAbsentPartiesLoading] = useState(false);

  // Jantri Distributor popup
  const [selectedDistributorId, setSelectedDistributorId] = useState<number | ''>('');
  const [distributorJantri, setDistributorJantri] = useState<{
    grid: { number: string; totalAmount: number }[];
    haruf: { digit: string; andarAmount: number; baharAmount: number }[];
  } | null>(null);
  const [distributorJantriLoading, setDistributorJantriLoading] = useState(false);

  // Add Slip Form State
  const [addParty, setAddParty] = useState('');
  const [addShift, setAddShift] = useState<number>(3);
  const [addNumber, setAddNumber] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [partiesList, setPartiesList] = useState<{ id: number; partyName: string; mobile?: string; groupName?: string }[]>([]);

  // Format timestamp helper to produce "10 - 06:33 PM" format matching pbmax1.com reference
  const formatTimestamp = (dateVal?: string) => {
    if (!dateVal) return '10 - 06:33 PM';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return dateVal;
      const day = String(d.getDate()).padStart(2, '0');
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const strHours = String(hours).padStart(2, '0');
      return `${day} - ${strHours}:${minutes} ${ampm}`;
    } catch {
      return dateVal;
    }
  };

  // View transaction handler: selects the transaction for the right-side panel and loads entries if needed
  const handleViewTransaction = async (tx: TransactionItem) => {
    setSelectedTx(tx);
    if (!tx.entries || tx.entries.length === 0) {
      try {
        const res = await apiRequest<{ numberValue: string; amount: number; rate?: number }[]>(`/transactions/${tx.id}/entries`);
        if (res.data) {
          const updated = { ...tx, entries: res.data };
          setSelectedTx(updated);
          setList(prev => prev.map(t => t.id === tx.id ? updated : t));
        }
      } catch (err) {
        console.warn('Failed to fetch entries for transaction:', err);
      }
    }
  };

  // Open Add Slip (F2) in a new window/tab with selected shift ID
  const handleOpenAddSlipPage = (shiftIdParam?: string | number) => {
    const targetShiftId = shiftIdParam || selectedShiftId || (shifts[0]?.id) || (list[0]?.shiftId) || 3;
    const targetUrl = `/transaction_add/${targetShiftId}`;
    window.open(targetUrl, '_blank');
  };

  // Keyboard shortcut F2 to open Add Slip for selected shift
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        handleOpenAddSlipPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShiftId, shifts, list]);

  // Open Jantri View Modal (F3): loads entries if not cached and opens modal
  const handleOpenJantriView = async (tx?: TransactionItem) => {
    const target = tx || selectedTx || (list.length > 0 ? list[0] : null);
    if (target) {
      if (!target.entries || target.entries.length === 0) {
        try {
          const res = await apiRequest<{ numberValue: string; amount: number; rate?: number }[]>(`/transactions/${target.id}/entries`);
          if (res.data) {
            const updated = { ...target, entries: res.data };
            setSelectedTx(updated);
            setList(prev => prev.map(t => t.id === target.id ? updated : t));
          }
        } catch (err) {
          console.warn('Failed to load entries for Jantri view:', err);
        }
      } else if (!selectedTx || selectedTx.id !== target.id) {
        setSelectedTx(target);
      }
    }
    setShowJantriModal(true);
  };

  // Kwada Transaction: find parties who hit the given exact Amount an exact number of times
  const handleKwadaFind = async () => {
    if (!kwadaAmount.trim()) return;
    setKwadaLoading(true);
    setKwadaSearched(true);
    try {
      const params = new URLSearchParams();
      if (selectedShiftId) params.append('shiftId', selectedShiftId);
      if (dateStr) params.append('date', dateStr);
      params.append('amount', kwadaAmount.trim());
      if (kwadaCount.trim()) params.append('count', kwadaCount.trim());
      const res = await apiRequest<{ sr: number; partyId: number; party: string; amount: number }[]>(
        `/transactions/kwada?${params.toString()}`
      );
      setKwadaResults(res.data || []);
    } catch (err) {
      console.warn('Failed to load Kwada transactions:', err);
      setKwadaResults([]);
    } finally {
      setKwadaLoading(false);
    }
  };

  // Abs Party (Party Not Working): parties normally active in this shift who are absent today
  const fetchAbsentParties = async () => {
    if (!selectedShiftId) return;
    setAbsentPartiesLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('shiftId', selectedShiftId);
      params.append('date', dateStr);
      const res = await apiRequest<{ sr: number; id: number; party: string; mobile: string; work: number }[]>(
        `/transactions/absent-parties?${params.toString()}`
      );
      setAbsentParties(res.data || []);
    } catch (err) {
      console.warn('Failed to load absent parties:', err);
      setAbsentParties([]);
    } finally {
      setAbsentPartiesLoading(false);
    }
  };

  useEffect(() => {
    if (showAbsPartyModal) {
      fetchAbsentParties();
    }
  }, [showAbsPartyModal]);

  // Jantri Distributor: fetches the same-shape Jantri grid scoped to that distributor's parties
  const fetchDistributorJantri = async (distributorId: number) => {
    if (!selectedShiftId || !distributorId) return;
    setDistributorJantriLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateStr) params.append('date', dateStr);
      const res = await apiRequest<{
        grid: { number: string; totalAmount: number }[];
        haruf: { digit: string; andarAmount: number; baharAmount: number }[];
      }>(`/jantri/${selectedShiftId}/distributor/${distributorId}?${params.toString()}`);
      setDistributorJantri(res.data || null);
    } catch (err) {
      console.warn('Failed to load distributor Jantri:', err);
      setDistributorJantri(null);
    } finally {
      setDistributorJantriLoading(false);
    }
  };

  const handleSubmitDistributorJantri = () => {
    if (!selectedDistributorId) return;
    fetchDistributorJantri(selectedDistributorId);
  };

  const distributorOptions = partiesList.filter(p => p.groupName === 'Distributor');

  // Matches the live reference: opening the popup already has the first Distributor picked
  // and its Jantri loaded, rather than starting blank until Submit is clicked.
  useEffect(() => {
    if (showDistributorModal && distributorOptions.length > 0) {
      const firstId = distributorOptions[0].id;
      setSelectedDistributorId(firstId);
      fetchDistributorJantri(firstId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDistributorModal]);

  const getDistributorAmountForNum = (n: number) => {
    const numStr = n === 100 ? '00' : String(n).padStart(2, '0');
    return distributorJantri?.grid.find(g => g.number === numStr)?.totalAmount || 0;
  };
  const getDistributorHaruf = (digit: number) => {
    const dStr = String(digit % 10);
    const cell = distributorJantri?.haruf.find(h => h.digit === dStr);
    return { andar: cell?.andarAmount || 0, bahar: cell?.baharAmount || 0 };
  };
  const distributorGrandTotal = distributorJantri
    ? distributorJantri.grid.reduce((s, g) => s + g.totalAmount, 0) +
      distributorJantri.haruf.reduce((s, h) => s + h.andarAmount + h.baharAmount, 0)
    : 0;

  // Active entries for Jantri modal based on consolidation toggle
  const jantriEntries = useMemo(() => {
    if (isConsolidated) {
      if (selectedTx?.partyName) {
        return list
          .filter(t => t.partyName.toLowerCase() === selectedTx.partyName.toLowerCase())
          .flatMap(t => t.entries || []);
      }
      return list.flatMap(t => t.entries || []);
    }
    return selectedTx?.entries || [];
  }, [isConsolidated, selectedTx, list]);

  const getAmountForNum = (n: number) => {
    const numStr = String(n);
    const numPadded = n < 100 ? String(n).padStart(2, '0') : '00';
    const matches = jantriEntries.filter(e => {
      // Haruf (stored as one digit) never counts as a number.
      if (harufOf(e)) return false;
      const val = (e.numberValue || '').trim();
      return val === numStr || val === numPadded || (n === 100 && (val === '100' || val === '00'));
    });
    const raw = matches.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return isCutConsolidated ? Math.round(raw * 0.9) : raw;
  };

  const getAmountForBahar = (digit: number) => {
    const dStr = String(digit % 10);
    const matches = jantriEntries.filter(e => {
      const h = harufOf(e);
      if (h) return h.side === 'B' && h.digit === dStr;
      const val = (e.numberValue || '').trim().toUpperCase();
      return (
        val === `B${dStr}` ||
        val === `BH${dStr}` ||
        val === `B-${dStr}` ||
        val === `B0${dStr}` ||
        (val.startsWith('B') && val.endsWith(dStr))
      );
    });
    const raw = matches.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return isCutConsolidated ? Math.round(raw * 0.9) : raw;
  };

  const getAmountForAndar = (digit: number) => {
    const dStr = String(digit % 10);
    const matches = jantriEntries.filter(e => {
      const h = harufOf(e);
      if (h) return h.side === 'A' && h.digit === dStr;
      const val = (e.numberValue || '').trim().toUpperCase();
      return (
        val === `A${dStr}` ||
        val === `AH${dStr}` ||
        val === `A-${dStr}` ||
        val === `A0${dStr}` ||
        (val.startsWith('A') && val.endsWith(dStr))
      );
    });
    const raw = matches.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    return isCutConsolidated ? Math.round(raw * 0.9) : raw;
  };

  const getRowTotal = (r: number) => {
    let sum = 0;
    for (let c = 1; c <= 10; c++) {
      sum += getAmountForNum(r * 10 + c);
    }
    return sum;
  };

  const getColTotal = (col: number) => {
    let sum = 0;
    for (let r = 0; r < 10; r++) {
      sum += getAmountForNum(r * 10 + col);
    }
    return sum;
  };

  const numbersTotal = useMemo(() => {
    let sum = 0;
    for (let i = 1; i <= 100; i++) {
      sum += getAmountForNum(i);
    }
    return sum;
  }, [jantriEntries, isCutConsolidated]);

  const baharTotal = useMemo(() => {
    let sum = 0;
    for (let i = 0; i <= 9; i++) {
      sum += getAmountForBahar(i);
    }
    return sum;
  }, [jantriEntries, isCutConsolidated]);

  const andarTotal = useMemo(() => {
    let sum = 0;
    for (let i = 0; i <= 9; i++) {
      sum += getAmountForAndar(i);
    }
    return sum;
  }, [jantriEntries, isCutConsolidated]);

  const grandTotal = numbersTotal + baharTotal + andarTotal;

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedShiftId) params.append('shiftId', selectedShiftId);
      if (searchParty.trim()) params.append('search', searchParty.trim());
      if (selectedStatus && selectedStatus !== 'ALL') params.append('status', selectedStatus);
      if (dateStr) params.append('date', dateStr);
      params.append('listMode', listMode);

      const res = await apiRequest<TransactionItem[]>(`/transactions?${params.toString()}`);
      if (res.data) {
        setList(res.data);
        if (res.data.length > 0) {
          // If no selectedTx or selectedTx is not in current list, select first
          if (!selectedTx || !res.data.some(t => t.id === selectedTx.id)) {
            handleViewTransaction(res.data[0]);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load live transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchParties = async () => {
    try {
      const res = await apiRequest<{ id: number; partyName: string; mobile?: string; groupName?: string }[]>('/ledgers');
      if (res.data) {
        setPartiesList(res.data);
        if (res.data.length > 0 && !addParty) {
          setAddParty(res.data[0].partyName);
        }
      }
    } catch (err) {}
  };

  useEffect(() => {
    fetchTransactions();
    fetchParties();
  }, [selectedShiftId, selectedStatus, dateStr, listMode]);

  // Keyboard Shortcuts: F2 -> Add Slip, F3 -> Jantri View, F4 -> Distributor, F5 -> Search, F7 -> Main Jantri
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        handleOpenAddSlipPage();
      }
      if (e.key === 'F3') {
        e.preventDefault();
        handleOpenJantriView();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setShowDistributorModal(true);
      }
      if (e.key === 'F5') {
        e.preventDefault();
        fetchTransactions();
      }
      if (e.key === 'F7') {
        e.preventDefault();
        if (onNavigate) onNavigate('jantri');
        else setShowJantriModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShiftId, searchParty, selectedStatus, listMode, onNavigate]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTransactions();
  };

  const handleCopySlip = async (tx: TransactionItem) => {
    try {
      await apiRequest(`/transactions/${tx.id}/copy-next-shift`, {
        method: 'POST',
        body: JSON.stringify({ targetShiftId: tx.shiftId }),
      });
      alert(`Slip ${tx.slipNumber} copied successfully!`);
      fetchTransactions();
    } catch (err: any) {
      alert(err.message || 'Copy failed');
    }
  };

  const handleDeleteSlip = async (tx: TransactionItem) => {
    if (!window.confirm(`Are you sure you want to delete slip ${tx.slipNumber} for ${tx.partyName}?`)) return;
    try {
      await apiRequest(`/transactions/${tx.id}`, { method: 'DELETE' });
      fetchTransactions();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTx) return;
    try {
      await apiRequest(`/transactions/${editingTx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ totalAmount: editAmount }),
      });
      setShowEditModal(false);
      fetchTransactions();
    } catch (err: any) {
      alert(err.message || 'Edit failed');
    }
  };

  const handleCreateSlip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addNumber.trim() || !addAmount.trim()) return;
    const targetParty = partiesList.find(p => p.partyName === addParty) || partiesList[0];
    const targetShift = addShift || (shifts.length > 0 ? shifts[0].id : 3);

    try {
      await apiRequest('/transactions', {
        method: 'POST',
        body: JSON.stringify({
          shiftId: targetShift,
          partyId: targetParty?.id || 1,
          entries: [
            {
              entryType: addNumber.length <= 2 ? 'DARA' : 'HARUF_ANDAR',
              numberValue: addNumber.padStart(2, '0'),
              amount: parseFloat(addAmount),
            }
          ]
        }),
      });
      setShowAddModal(false);
      setAddNumber('');
      setAddAmount('');
      fetchTransactions();
    } catch (err: any) {
      alert(err.message || 'Failed to create transaction slip');
    }
  };

  const totalSum = list.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);

  return (
    <div className="h-[calc(100vh-82px)] max-h-[calc(100vh-82px)] min-h-[520px] bg-[#eaedf2] p-2 sm:p-2.5 flex flex-col justify-between text-slate-800 select-none font-sans text-xs overflow-hidden">
      {/* Outer Card matching pbmax1.com Screenshot 1 & 2 */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1 min-h-0">
        {/* Subheader Filter Bar matching Screenshot 1 */}
        <form onSubmit={handleSearchSubmit} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white flex-shrink-0">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">
            Live Transactions
          </span>

          {/* Shift selector with soft yellow background matching Screenshot 1 */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Shift</span>
            <select
              value={selectedShiftId}
              onChange={(e) => setSelectedShiftId(e.target.value)}
              className="px-2.5 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-36 shadow-xs"
            >
              <option value="">-- ALL SHIFTS --</option>
              {/* Only active shifts that haven't declared their result number yet — a shift
                  drops out once it declares or is disabled, matching the live reference. */}
              {shifts.filter(s => s.isActive !== false && !s.declaredNumber).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
              {shifts.length === 0 && <option value="3">FARIDABAD</option>}
            </select>
          </div>

          {/* Date */}
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-700 tracking-wider focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
          />

          {/* Search Party Input */}
          <div className="relative">
            <input
              type="text"
              value={searchParty}
              onChange={(e) => setSearchParty(e.target.value)}
              placeholder="SEARCH PARTY..."
              className="w-36 sm:w-44 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:border-blue-500 uppercase placeholder:text-slate-400 font-semibold"
            />
          </div>

          {/* Search (F5) Teal Button */}
          <button
            type="submit"
            className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
          >
            Search (F5)
          </button>

          {/* All Staff dropdown — hidden for own-data roles */}
          {!ownDataOnly && (
          <select
            value={selectedStaff}
            onChange={(e) => setSelectedStaff(e.target.value)}
            className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="">-- ALL STAFF --</option>
            <option value="B13">B13</option>
            <option value="B09">B09</option>
            <option value="B05">B05</option>
            <option value="B14">B14</option>
            <option value="B27">B27</option>
            <option value="B10">B10</option>
            <option value="U28">U28</option>
          </select>
          )}

          {/* Status dropdown — hidden for own-data roles */}
          {!ownDataOnly && (
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="ALL">ALL</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="VOIDED">VOIDED</option>
          </select>
          )}
        </form>

        {/* Dual-Pane Section: Left 9-Column Table with Vertical Scrollbar, Right Party Numbers Panel */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden border-b border-slate-300">
          {/* LEFT: Main 9-Column Table Container with Prominent Vertical Scrollbar */}
          <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-auto border-r border-slate-300 relative pbmax-table-scrollbar">
            <table className="w-full text-left text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-20 bg-[#152847]">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <th className="py-2 px-2.5 border-r border-b border-[#223b63] w-10 text-center sticky top-0 bg-[#152847] z-20">Sr</th>
                  <th className="py-2 px-2 border-r border-b border-[#223b63] w-8 text-center sticky top-0 bg-[#152847] z-20">D</th>
                  <th className="py-2 px-2.5 border-r border-b border-[#223b63] w-10 text-center sticky top-0 bg-[#152847] z-20">U/J</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Party</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Rate</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] text-right sticky top-0 bg-[#152847] z-20">Amount</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Added</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Updated</th>
                  <th className="py-2 px-3 text-center w-52 border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                      Loading live transactions...
                    </td>
                  </tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                      No live transactions recorded for this filter.
                    </td>
                  </tr>
                ) : (
                  list.map((tx, idx) => {
                    const isSelected = selectedTx?.id === tx.id;
                    return (
                      <tr
                        key={tx.id}
                        onClick={() => handleViewTransaction(tx)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/80 font-semibold' : 'hover:bg-slate-50'
                        }`}
                      >
                        {/* Sr */}
                        <td className="py-1.5 px-2.5 text-center font-mono text-slate-600 border-r border-b border-slate-200">
                          {idx + 1}
                        </td>
                        {/* D checkbox square matching Screenshot 1 */}
                        <td className="py-1.5 px-2 text-center border-r border-b border-slate-200">
                          <div className="w-3.5 h-3.5 border border-blue-400 bg-white rounded-xs flex items-center justify-center mx-auto text-[9px] text-blue-600 font-bold shadow-xs">
                            ✓
                          </div>
                        </td>
                        {/* U/J */}
                        <td className="py-1.5 px-2.5 text-center font-bold text-slate-800 border-r border-b border-slate-200">
                          {tx.ujType || 'U'}
                        </td>
                        {/* Party */}
                        {/* A slip marked Mistake on Trans-Audit shows its party in red with a
                            red "Mistake" badge, as on the live list; hover shows the auditor's text. */}
                        <td className={`py-1.5 px-3 font-bold uppercase tracking-tight border-r border-b border-slate-200 ${
                          tx.auditStatus === 'MISTAKE' ? 'text-red-600' : 'text-slate-900'
                        }`}>
                          {tx.partyName}
                          {tx.auditStatus === 'MISTAKE' && (
                            <span
                              title={tx.mistakeRemark || 'Mistake'}
                              className="ml-1.5 inline-block px-2 py-0.5 bg-[#dc2626] text-white text-[10px] font-bold normal-case tracking-normal rounded-xs align-middle cursor-help"
                            >
                              Mistake
                            </span>
                          )}
                        </td>
                        {/* Rate */}
                        <td className="py-1.5 px-3 font-mono font-medium text-slate-700 border-r border-b border-slate-200">
                          {tx.rateStr || '90/10-9/10'}
                        </td>
                        {/* Amount */}
                        <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-b border-slate-200">
                          {tx.totalAmount.toLocaleString('en-IN')}
                        </td>
                        {/* Added */}
                        <td className="py-1 px-3 border-r border-b border-slate-200 leading-snug">
                          <div className="font-bold text-slate-900 uppercase text-[11px]">{tx.addedBy || 'SYSTEM'}</div>
                          <div className="font-mono text-slate-500 text-[10px]">{formatTimestamp(tx.createdAt)}</div>
                        </td>
                        {/* Updated — red once a Mistake slip has been edited, as on the live list */}
                        <td className="py-1 px-3 border-r border-b border-slate-200 leading-snug">
                          <div className={`font-bold uppercase text-[11px] ${tx.mistakeEdited || tx.status === 'VOIDED' ? 'text-red-600' : 'text-slate-900'}`}>{tx.updatedBy || 'SYSTEM'}</div>
                          <div className={`font-mono text-[10px] ${tx.mistakeEdited || tx.status === 'VOIDED' ? 'text-red-500' : 'text-slate-500'}`}>{formatTimestamp(tx.updatedAt)}</div>
                        </td>
                        {/* 4 Action Buttons matching Screenshot 1: Copy, View, Edit, Delete */}
                        <td className="py-1.5 px-2 text-center border-b border-slate-200">
                          {tx.status === 'VOIDED' ? (
                            <span className="text-[10px] font-semibold text-red-600">(Deleted)</span>
                          ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopySlip(tx);
                              }}
                              title="Copy Transaction Slip"
                              className="px-2 py-0.5 bg-[#d97706] hover:bg-[#b45309] text-white text-[10px] font-bold rounded shadow-xs transition-colors cursor-pointer"
                            >
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewTransaction(tx);
                              }}
                              title="View Details in Right Panel"
                              className="px-2 py-0.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white text-[10px] font-bold rounded shadow-xs transition-colors cursor-pointer"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`/transaction_edit/${tx.shiftId}/${tx.id}`, '_blank');
                              }}
                              title="Edit Slip"
                              className="px-2 py-0.5 bg-[#1e40af] hover:bg-[#1e3a8a] text-white text-[10px] font-bold rounded shadow-xs transition-colors cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSlip(tx);
                              }}
                              title="Delete Slip"
                              className="px-2 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[10px] font-bold rounded shadow-xs transition-colors cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="sticky bottom-0 z-20 bg-[#152847]">
                {/* Summary Row matching Screenshot 1 & 2 */}
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className="py-2 px-2.5 text-center border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">
                    {list.length}
                  </td>
                  <td className="py-2 px-2 text-center border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">D</td>
                  <td className="py-2 px-2.5 text-center border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">U/J</td>
                  <td className="py-2 px-3 border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">Party</td>
                  <td className="py-2 px-3 border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">Rate</td>
                  <td className="py-2 px-3 text-right font-mono border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">
                    {totalSum.toLocaleString('en-IN')}
                  </td>
                  <td className="py-2 px-3 border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">Added</td>
                  <td className="py-2 px-3 border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">Updated</td>
                  <td className="py-2 px-3 text-center border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">Action</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* RIGHT: Live Party Breakdown Panel matching Screenshot 1, 2 & 3 */}
          <div className="w-full lg:w-72 bg-white flex flex-col border-t lg:border-t-0 border-slate-300 flex-shrink-0">
            {/* Header matching Screenshot 1 & 3: Displays clicked party name with Add (F2) & Jantri View (F3) */}
            <div className="bg-[#152847] text-white font-bold text-[11px] py-2 px-3 border-b border-[#223b63] flex items-center justify-between flex-shrink-0">
              <span className="uppercase truncate tracking-wide">{selectedTx?.partyName || 'Party'}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleOpenAddSlipPage(selectedTx?.shiftId || undefined)}
                  title="Open Add Slip in New Window (F2)"
                  className="px-2 py-0.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white text-[10px] font-bold rounded shadow-xs cursor-pointer transition-colors"
                >
                  Add (F2)
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenJantriView(selectedTx || undefined)}
                  title="Open Jantri View (F3)"
                  className="px-2 py-0.5 bg-[#d97706] hover:bg-[#b45309] text-white text-[10px] font-bold rounded shadow-xs cursor-pointer transition-colors"
                >
                  Jantri View (F3)
                </button>
              </div>
            </div>
            {/* Sub-header matching Screenshot 1 & 3 */}
            <div className="bg-[#1e3a63] text-white font-semibold text-[11px] grid grid-cols-2 divide-x divide-[#2b4c7e] py-1.5 px-3 flex-shrink-0">
              <div>Number</div>
              <div className="text-right">Amount</div>
            </div>

            {/* Entries Body with Scrollbar */}
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-200 pbmax-table-scrollbar">
              {!selectedTx || !selectedTx.entries || selectedTx.entries.length === 0 ? (
                <div className="py-8 text-center text-slate-400 font-medium text-xs">
                  Select a transaction to view slip numbers
                </div>
              ) : (
                selectedTx.entries.map((ent, i) => (
                  <div key={i} className="grid grid-cols-2 py-1.5 px-3 hover:bg-slate-50 font-mono text-xs text-slate-800">
                    <span className="font-bold text-blue-700">{displayNumber(ent)}</span>
                    <span className="text-right font-semibold">{ent.amount.toLocaleString('en-IN')}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar matching Screenshot 1 & 2 */}
        <div className="p-2 sm:p-2.5 bg-[#eaedf2] flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 flex-shrink-0">
          {/* Left Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowKwadaModal(true)}
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Kwada Trans
            </button>
            <button
              type="button"
              onClick={() => setShowAbsPartyModal(true)}
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Abs Party
            </button>
          </div>

          {/* Right Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleOpenAddSlipPage()}
              className="px-4 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Add (F2)
            </button>
            <button
              type="button"
              onClick={() => handleOpenJantriView()}
              className="px-4 py-1.5 bg-[#d97706] hover:bg-[#b45309] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Jantri View (F3)
            </button>
            <button
              type="button"
              onClick={() => setShowDistributorModal(true)}
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Jantri Distributor (F4)
            </button>
            <button
              type="button"
              onClick={() => setShowHPLModal(true)}
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              HPL-Jantri
            </button>
            <button
              type="button"
              onClick={() => onNavigate ? onNavigate('jantri') : setShowJantriModal(true)}
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Main Jantri (F7)
            </button>
            <select
              value={listMode}
              onChange={(e) => setListMode(e.target.value as 'ACTIVE' | 'DELETED')}
              className="w-24 px-2.5 py-1.5 bg-[#fde68a] border border-amber-300 rounded text-xs font-bold text-slate-900 cursor-pointer focus:outline-none"
            >
              <option value="ACTIVE">Active</option>
              <option value="DELETED">Deleted</option>
            </select>
          </div>
        </div>
      </div>

      {/* Modal 1: Add Slip Modal (F2) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Add Live Transaction Slip</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSlip} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Party Name</label>
                <select
                  value={addParty}
                  onChange={(e) => setAddParty(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:border-blue-500"
                >
                  {partiesList.map(p => (
                    <option key={p.id} value={p.partyName}>{p.partyName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Market Shift</label>
                <select
                  value={addShift}
                  onChange={(e) => setAddShift(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:border-blue-500"
                >
                  {shifts.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Number (Dara 00-99)</label>
                  <input
                    type="text"
                    required
                    value={addNumber}
                    onChange={(e) => setAddNumber(e.target.value)}
                    placeholder="e.g. 24"
                    maxLength={2}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    required
                    value={addAmount}
                    onChange={(e) => setAddAmount(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-1.5 text-slate-600 hover:text-slate-900 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs shadow-xs"
                >
                  Save Slip
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Edit Slip Total Modal */}
      {showEditModal && editingTx && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-sm w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Edit Total: {editingTx.slipNumber}</h2>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-white hover:text-slate-300 p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-4 space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Party</label>
                <input
                  type="text"
                  disabled
                  value={editingTx.partyName}
                  className="w-full px-3 py-1.5 bg-slate-100 border border-slate-300 rounded font-bold text-slate-700 uppercase text-xs"
                />
              </div>
              <div>
                <label className="block text-slate-700 font-bold mb-1">Total Amount (₹)</label>
                <input
                  type="number"
                  required
                  value={editAmount}
                  onChange={(e) => setEditAmount(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-900 text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-1.5 text-slate-600 font-bold text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-1.5 bg-[#1e40af] hover:bg-[#1e3a8a] text-white font-bold text-xs rounded"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Jantri View Modal (F3) matching Screenshot 2 */}
      {showJantriModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-[#1b3258] rounded-lg shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-500">
            {/* Header Bar matching Screenshot 2 */}
            <div className="bg-[#1b3258] px-4 py-2.5 flex items-center justify-between border-b border-[#2a4a7a]">
              {/* Left Side: Party Name and Toggles */}
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-wide uppercase">
                  {isConsolidated
                    ? selectedTx?.partyName
                      ? `${selectedTx.partyName.toUpperCase()} (CONSOLIDATED)`
                      : 'ALL PARTIES (CONSOLIDATED)'
                    : selectedTx?.partyName?.toUpperCase() || 'DEEPAK GADSANA'}
                </h2>

                <div className="flex items-center gap-4 sm:gap-6">
                  {/* Consolidate Jantri Toggle Switch */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isConsolidated}
                      onClick={() => setIsConsolidated(!isConsolidated)}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer flex items-center ${
                        isConsolidated ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full shadow-xs transform transition-transform duration-200 ${
                          isConsolidated ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-white font-semibold">Consolidate Jantri</span>
                  </label>

                  {/* Cut Consolidate Jantri Toggle Switch */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isCutConsolidated}
                      onClick={() => setIsCutConsolidated(!isCutConsolidated)}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer flex items-center ${
                        isCutConsolidated ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 bg-white rounded-full shadow-xs transform transition-transform duration-200 ${
                          isCutConsolidated ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-white font-semibold">Cut Consolidate Jantri</span>
                  </label>
                </div>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setShowJantriModal(false)}
                className="text-slate-300 hover:text-white transition-colors p-1 cursor-pointer"
                title="Close (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Matrix Table matching Screenshot 2 */}
            <div className="bg-white p-2 sm:p-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs font-mono select-none table-fixed">
                <thead className="bg-[#152847] text-white">
                  <tr>
                    {Array.from({ length: 10 }, (_, i) => (
                      <th
                        key={i + 1}
                        className="py-1.5 sm:py-2 text-center text-xs font-bold border border-[#2b446f] w-[9.09%]"
                      >
                        {i + 1}
                      </th>
                    ))}
                    <th className="py-1.5 sm:py-2 text-center text-xs font-bold border border-[#2b446f] w-[9.09%]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* 10 Number Rows (1 - 100) */}
                  {Array.from({ length: 10 }, (_, r) => {
                    const rowTotal = getRowTotal(r);
                    return (
                      <tr key={r} className="hover:bg-slate-50/70">
                        {Array.from({ length: 10 }, (_, c) => {
                          const num = r * 10 + (c + 1);
                          const amt = getAmountForNum(num);
                          return (
                            <td
                              key={num}
                              className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle"
                            >
                              <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                                {num}
                              </span>
                              {amt > 0 ? (
                                <span className="font-bold text-xs sm:text-[13px] text-slate-900 font-mono">
                                  {amt.toLocaleString('en-IN')}
                                </span>
                              ) : null}
                            </td>
                          );
                        })}
                        {/* Row Total */}
                        <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                          {rowTotal > 0 ? rowTotal.toLocaleString('en-IN') : 0}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Row 11: Column Totals Row */}
                  <tr className="bg-[#152847] text-white font-bold font-mono text-center text-xs sm:text-[13px]">
                    {Array.from({ length: 10 }, (_, c) => {
                      const colTotal = getColTotal(c + 1);
                      return (
                        <td key={c + 1} className="py-1.5 sm:py-2 border border-[#2b446f]">
                          {colTotal > 0 ? colTotal.toLocaleString('en-IN') : 0}
                        </td>
                      );
                    })}
                    {/* Sum of all numbers */}
                    <td className="py-1.5 sm:py-2 border border-[#2b446f]">
                      {numbersTotal > 0 ? numbersTotal.toLocaleString('en-IN') : 0}
                    </td>
                  </tr>

                  {/* Row 12: Bahar Haruf (B1 - B0) */}
                  <tr className="hover:bg-slate-50/70">
                    {Array.from({ length: 10 }, (_, c) => {
                      const digit = c + 1 === 10 ? 0 : c + 1;
                      const badgeLabel = `B${digit}`;
                      const bAmt = getAmountForBahar(digit);
                      return (
                        <td
                          key={badgeLabel}
                          className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle"
                        >
                          <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                            {badgeLabel}
                          </span>
                          {bAmt > 0 ? (
                            <span className="font-bold text-xs sm:text-[13px] text-slate-900 font-mono">
                              {bAmt.toLocaleString('en-IN')}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                    {/* Bahar Haruf Total */}
                    <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                      {baharTotal > 0 ? baharTotal.toLocaleString('en-IN') : 0}
                    </td>
                  </tr>

                  {/* Row 13: Andar Haruf (A1 - A0) */}
                  <tr className="hover:bg-slate-50/70">
                    {Array.from({ length: 10 }, (_, c) => {
                      const digit = c + 1 === 10 ? 0 : c + 1;
                      const badgeLabel = `A${digit}`;
                      const aAmt = getAmountForAndar(digit);
                      return (
                        <td
                          key={badgeLabel}
                          className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle"
                        >
                          <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                            {badgeLabel}
                          </span>
                          {aAmt > 0 ? (
                            <span className="font-bold text-xs sm:text-[13px] text-slate-900 font-mono">
                              {aAmt.toLocaleString('en-IN')}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                    {/* Andar Haruf Total */}
                    <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                      {andarTotal > 0 ? andarTotal.toLocaleString('en-IN') : 0}
                    </td>
                  </tr>

                  {/* Row 14: Grand Total Row */}
                  <tr className="bg-[#152847] text-white font-bold text-xs sm:text-[13px]">
                    {Array.from({ length: 9 }, (_, i) => (
                      <td key={i} className="py-1.5 sm:py-2 text-center border border-[#2b446f]">
                        -
                      </td>
                    ))}
                    <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-bold whitespace-nowrap">
                      Grand Total
                    </td>
                    <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-mono font-bold">
                      {grandTotal > 0 ? grandTotal.toLocaleString('en-IN') : 0}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal 5: Kwada Transaction Modal — matching live reference */}
      {showKwadaModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden border border-slate-300">
            <div className="bg-[#152847] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Kwada Transaction</h2>
              <button
                type="button"
                onClick={() => setShowKwadaModal(false)}
                className="text-white hover:text-slate-200 p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Amount</label>
                  <input
                    type="number"
                    value={kwadaAmount}
                    onChange={(e) => setKwadaAmount(e.target.value)}
                    placeholder="AMOUNT"
                    className="w-32 px-2.5 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Count</label>
                  <input
                    type="number"
                    value={kwadaCount}
                    onChange={(e) => setKwadaCount(e.target.value)}
                    placeholder="COUNT"
                    className="w-24 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleKwadaFind}
                  disabled={!kwadaAmount.trim() || kwadaLoading}
                  className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {kwadaLoading ? 'Finding...' : 'Find'}
                </button>
              </div>

              <div className="border border-slate-200 rounded overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#152847] text-white font-bold text-[11px]">
                      <th className="py-1.5 px-3 w-14 text-center">Sr</th>
                      <th className="py-1.5 px-3">Party</th>
                      <th className="py-1.5 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {kwadaResults.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-slate-400">
                          {kwadaSearched ? 'No matching parties found.' : 'Enter Amount (and optional Count) and click Find.'}
                        </td>
                      </tr>
                    ) : (
                      kwadaResults.map((r) => (
                        <tr key={r.partyId} className="hover:bg-slate-50">
                          <td className="py-1.5 px-3 text-center font-mono text-slate-500">{r.sr}</td>
                          <td className="py-1.5 px-3 font-bold uppercase text-slate-800">{r.party}</td>
                          <td className="py-1.5 px-3 text-right font-mono font-semibold text-slate-800">
                            {r.amount.toLocaleString('en-IN')}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 6: Party Not Working (Abs Party) Modal — matching live reference */}
      {showAbsPartyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-300">
            <div className="bg-[#152847] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Party Not Working</h2>
              <button
                type="button"
                onClick={() => setShowAbsPartyModal(false)}
                className="text-white hover:text-slate-200 p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 text-xs">
              <div className="border border-slate-200 rounded overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0">
                    <tr className="bg-[#152847] text-white font-bold text-[11px]">
                      <th className="py-1.5 px-3 w-14 text-center">Sr</th>
                      <th className="py-1.5 px-3">Party</th>
                      <th className="py-1.5 px-3">Mobile</th>
                      <th className="py-1.5 px-3 text-center">Work</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {absentPartiesLoading ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">Loading...</td>
                      </tr>
                    ) : absentParties.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">No regular parties are absent right now.</td>
                      </tr>
                    ) : (
                      absentParties.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="py-1.5 px-3 text-center font-mono text-slate-500">{p.sr}</td>
                          <td className="py-1.5 px-3 font-bold uppercase text-slate-800">{p.party}</td>
                          <td className="py-1.5 px-3 font-mono text-slate-700">{p.mobile}</td>
                          <td className="py-1.5 px-3 text-center font-mono font-semibold text-slate-800">{p.work}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 7: Distributor Wise Jantri (F4) Modal — matching live reference */}
      {showDistributorModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-300">
            <div className="bg-[#152847] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Distributor Wise Jantri</h2>
              <button
                type="button"
                onClick={() => setShowDistributorModal(false)}
                className="text-white hover:text-slate-200 p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3 sm:p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Distributor</label>
                  <select
                    value={selectedDistributorId}
                    onChange={(e) => setSelectedDistributorId(e.target.value ? parseInt(e.target.value, 10) : '')}
                    className="w-56 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- CHOOSE --</option>
                    {distributorOptions.map((d) => (
                      <option key={d.id} value={d.id}>{d.partyName}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleSubmitDistributorJantri}
                  disabled={!selectedDistributorId || distributorJantriLoading}
                  className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {distributorJantriLoading ? 'Loading...' : 'Submit'}
                </button>
              </div>

              {!distributorJantri ? (
                <div className="py-10 text-center text-slate-400 font-medium">
                  Choose a Distributor and click Submit to view their Jantri.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs font-mono select-none table-fixed">
                    <thead className="bg-[#152847] text-white">
                      <tr>
                        {Array.from({ length: 10 }, (_, i) => (
                          <th key={i + 1} className="py-1.5 sm:py-2 text-center text-xs font-bold border border-[#2b446f] w-[9.09%]">
                            {i + 1}
                          </th>
                        ))}
                        <th className="py-1.5 sm:py-2 text-center text-xs font-bold border border-[#2b446f] w-[9.09%]">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 10 }, (_, r) => {
                        const rowTotal = Array.from({ length: 10 }, (_, c) => getDistributorAmountForNum(r * 10 + c + 1)).reduce((a, b) => a + b, 0);
                        return (
                          <tr key={r} className="hover:bg-slate-50/70">
                            {Array.from({ length: 10 }, (_, c) => {
                              const num = r * 10 + (c + 1);
                              const amt = getDistributorAmountForNum(num);
                              return (
                                <td key={num} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle">
                                  <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                                    {num}
                                  </span>
                                  {amt > 0 ? (
                                    <span className="font-bold text-xs sm:text-[13px] text-slate-900 font-mono">{amt.toLocaleString('en-IN')}</span>
                                  ) : null}
                                </td>
                              );
                            })}
                            <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                              {rowTotal > 0 ? rowTotal.toLocaleString('en-IN') : 0}
                            </td>
                          </tr>
                        );
                      })}

                      <tr className="bg-[#152847] text-white font-bold font-mono text-center text-xs sm:text-[13px]">
                        {Array.from({ length: 10 }, (_, c) => {
                          const colTotal = Array.from({ length: 10 }, (_, r) => getDistributorAmountForNum(r * 10 + c + 1)).reduce((a, b) => a + b, 0);
                          return (
                            <td key={c + 1} className="py-1.5 sm:py-2 border border-[#2b446f]">
                              {colTotal > 0 ? colTotal.toLocaleString('en-IN') : 0}
                            </td>
                          );
                        })}
                        <td className="py-1.5 sm:py-2 border border-[#2b446f]">
                          {distributorJantri.grid.reduce((s, g) => s + g.totalAmount, 0).toLocaleString('en-IN')}
                        </td>
                      </tr>

                      <tr className="hover:bg-slate-50/70">
                        {Array.from({ length: 10 }, (_, c) => {
                          const digit = c + 1 === 10 ? 0 : c + 1;
                          const bAmt = getDistributorHaruf(digit).bahar;
                          return (
                            <td key={`b${digit}`} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle">
                              <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                                B{digit}
                              </span>
                              {bAmt > 0 ? <span className="font-bold text-xs sm:text-[13px] text-slate-900 font-mono">{bAmt.toLocaleString('en-IN')}</span> : null}
                            </td>
                          );
                        })}
                        <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                          {distributorJantri.haruf.reduce((s, h) => s + h.baharAmount, 0).toLocaleString('en-IN')}
                        </td>
                      </tr>

                      <tr className="hover:bg-slate-50/70">
                        {Array.from({ length: 10 }, (_, c) => {
                          const digit = c + 1 === 10 ? 0 : c + 1;
                          const aAmt = getDistributorHaruf(digit).andar;
                          return (
                            <td key={`a${digit}`} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle">
                              <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                                A{digit}
                              </span>
                              {aAmt > 0 ? <span className="font-bold text-xs sm:text-[13px] text-slate-900 font-mono">{aAmt.toLocaleString('en-IN')}</span> : null}
                            </td>
                          );
                        })}
                        <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                          {distributorJantri.haruf.reduce((s, h) => s + h.andarAmount, 0).toLocaleString('en-IN')}
                        </td>
                      </tr>

                      <tr className="bg-[#152847] text-white font-bold text-xs sm:text-[13px]">
                        {Array.from({ length: 9 }, (_, i) => (
                          <td key={i} className="py-1.5 sm:py-2 text-center border border-[#2b446f]">-</td>
                        ))}
                        <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-bold whitespace-nowrap">Grand Total</td>
                        <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-mono font-bold">
                          {distributorGrandTotal.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal 8: HPL-Jantri Modal */}
      {showHPLModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden border border-slate-300">
            <div className="bg-[#00897b] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">HPL (Haruf / Panna / Limit) Jantri</h2>
              <button
                type="button"
                onClick={() => setShowHPLModal(false)}
                className="text-white hover:text-slate-200 p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <h3 className="font-bold text-slate-800 mb-2">Haruf & Limit Breakdown (0 - 9):</h3>
                <div className="grid grid-cols-5 gap-2 font-mono text-center">
                  {Array.from({ length: 10 }, (_, d) => {
                    const digit = d.toString();
                    const sum = list.flatMap(t => t.entries || [])
                      .filter(e => e.numberValue.includes(digit))
                      .reduce((acc, e) => acc + e.amount, 0);
                    return (
                      <div key={digit} className="p-2 bg-white border border-slate-200 rounded shadow-xs">
                        <div className="text-slate-500 font-bold">Haruf [{digit}]</div>
                        <div className="font-bold text-blue-700">{sum > 0 ? `₹${sum.toLocaleString('en-IN')}` : '-'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowHPLModal(false)}
                  className="px-5 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
