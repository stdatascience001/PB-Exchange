import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto, UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { displayNumber } from '../utils/entryDisplay.js';
import { X, Search as SearchIcon, Eye, Copy, Trash2, Plus, Edit } from 'lucide-react';
import { TransactionItem } from './TransactionListPage.js';
import { JantriViewModal } from '../components/JantriViewModal.js';

interface DeclareTransactionListPageProps {
  shifts?: ShiftDto[];
  user?: UserSession | null;
  onNavigate?: (page: string) => void;
  // /declare_transaction_list/:shiftId opens the page on that shift
  initialShiftId?: string;
}

export const DeclareTransactionListPage: React.FC<DeclareTransactionListPageProps> = ({
  shifts = [],
  user,
  onNavigate,
  initialShiftId,
}) => {
  // Only active shifts belong in this dropdown — a disabled shift (Shift Manage's
  // Enable/Disable tab) shouldn't still be selectable here. Same guard the other shift
  // pickers use.
  const availableShifts = useMemo(() => {
    const activeOnly = shifts.filter(s => s.isActive !== false);
    return activeOnly.length > 0 ? activeOnly : shifts;
  }, [shifts]);

  const [list, setList] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Nothing preselected — the live page opens on "-- CHOOSE --" with an empty table, and only
  // loads once a shift is actually picked.
  const [selectedShiftId, setSelectedShiftId] = useState<string>(initialShiftId || '');
  // Held as YYYY-MM-DD so it can drive a real date input AND be sent to the API. It used to be
  // a "DD / MM / YYYY" label rendered in a plain div and never passed to the query, which is
  // why the list kept showing other days' slips whatever date was on screen.
  const [dateStr, setDateStr] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  // This page only reports on shifts whose result is already out. The live page proves it:
  // the dropdown still offers every active shift, but picking one that has not been declared
  // (NEW FARIDABAD, GHAZIABAD — both showing live running totals on the dashboard rather than
  // a result badge) draws an empty table, while a declared one (DELHI BAZAAR, badge 92) draws
  // its 251 slips. So the gate is on the DATA, not on the dropdown.
  const selectedShift = useMemo(
    () => shifts.find(s => String(s.id) === selectedShiftId),
    [shifts, selectedShiftId]
  );
  const isSelectedShiftDeclared = !!(
    selectedShift?.declaredNumber ||
    selectedShift?.status === 'DECLARED' ||
    selectedShift?.status === 'AUDITED'
  );

  const [searchParty, setSearchParty] = useState('');
  const [selectedStaff, setSelectedStaff] = useState('');
  // Jantri View (F3) popup — the same grid as Live Transactions / Trans-Audit
  const [showJantriModal, setShowJantriModal] = useState(false);

  // Date box as three parts (DD / MM / YYYY), as live: Enter steps day -> month -> year ->
  // Search Party, and Up/Down steps the focused part. dateStr is only updated once the parts
  // make a real date, so a half-typed part never reloads the list.
  const [dd, setDd] = useState(() => dateStr.slice(8, 10));
  const [mm, setMm] = useState(() => dateStr.slice(5, 7));
  const [yyyy, setYyyy] = useState(() => dateStr.slice(0, 4));
  const commitDate = (d: string, m: string, y: string) => {
    const di = parseInt(d, 10), mi = parseInt(m, 10), yi = parseInt(y, 10);
    if (!/^\d{4}$/.test(y) || !(mi >= 1 && mi <= 12) || !(di >= 1)) return;
    const daysInMonth = new Date(yi, mi, 0).getDate();
    if (di > daysInMonth) return;
    setDateStr(`${y}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}`);
  };
  const focusField = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };
  const onDatePartKeyDown = (
    part: 'dd' | 'mm' | 'yyyy',
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusField(part === 'dd' ? 'decl-date-mm' : part === 'mm' ? 'decl-date-yyyy' : 'decl-search-party');
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const step = e.key === 'ArrowUp' ? 1 : -1;
    if (part === 'dd') {
      const max = new Date(parseInt(yyyy, 10) || 2000, parseInt(mm, 10) || 1, 0).getDate();
      let v = (parseInt(dd, 10) || 1) + step;
      if (v > max) v = 1;
      if (v < 1) v = max;
      const next = String(v).padStart(2, '0');
      setDd(next);
      commitDate(next, mm, yyyy);
    } else if (part === 'mm') {
      let v = (parseInt(mm, 10) || 1) + step;
      if (v > 12) v = 1;
      if (v < 1) v = 12;
      const next = String(v).padStart(2, '0');
      setMm(next);
      commitDate(dd, next, yyyy);
    } else {
      const next = String((parseInt(yyyy, 10) || new Date().getFullYear()) + step);
      setYyyy(next);
      commitDate(dd, mm, next);
    }
  };
  // Staff filter: applied at once (dropdown pick / Up-Down), options from the loaded slips
  const [appliedStaff, setAppliedStaff] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  
  // Selected transaction for right panel
  const [selectedTx, setSelectedTx] = useState<TransactionItem | null>(null);

  // Modals
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingTx, setViewingTx] = useState<TransactionItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionItem | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);

  const formatDateTimePb = (dStr?: string) => {
    if (!dStr) return '';
    try {
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return dStr;
      const day = String(d.getDate()).padStart(2, '0');
      let hours = d.getHours();
      const mins = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      const hoursStr = String(hours).padStart(2, '0');
      return `${day} - ${hoursStr}:${mins} ${ampm}`;
    } catch {
      return dStr;
    }
  };

  const fetchTransactions = async () => {
    // No shift chosen means no report — the live page shows an empty table on "-- CHOOSE --"
    // rather than defaulting to some shift's data.
    if (!selectedShiftId) {
      setList([]);
      setSelectedTx(null);
      return;
    }
    // Result not declared yet -> nothing to report on, same as the live page.
    if (!isSelectedShiftDeclared) {
      setList([]);
      setSelectedTx(null);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('shiftId', selectedShiftId);
      if (dateStr) params.append('date', dateStr);
      if (searchParty.trim()) params.append('search', searchParty.trim());
      if (selectedStatus && selectedStatus !== 'ALL') params.append('status', selectedStatus);

      const res = await apiRequest<TransactionItem[]>(`/transactions?${params.toString()}`);
      if (res.data) {
        setList(res.data);
        if (res.data.length > 0 && !selectedTx) {
          setSelectedTx(res.data[0]);
        }
      }
    } catch (err) {
      console.warn('Failed to load declare transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShiftId, selectedStatus, dateStr, isSelectedShiftDeclared]);

  // Search Party filters as you type: the list reloads for the typed text a moment after the
  // last keystroke (Enter / Search (F5) still reload straight away)
  const searchTypedRef = React.useRef(false);
  useEffect(() => {
    if (!searchTypedRef.current) {
      searchTypedRef.current = true;
      return;
    }
    const t = setTimeout(() => fetchTransactions(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParty]);

  // Page opens with the cursor on the Shift dropdown
  useEffect(() => {
    const id = requestAnimationFrame(() => document.getElementById('decl-shift')?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // F5 always reloads with the filters on screen now. The key listener below is only re-made
  // when a few filters change, so it used to call a stale fetchTransactions (old date / old
  // "is declared" state) — F5 then reloaded the wrong day or cleared the list.
  const fetchTransactionsRef = React.useRef(fetchTransactions);
  fetchTransactionsRef.current = fetchTransactions;

  // Keyboard Shortcuts: F2 -> Add Transaction New Tab, F3 -> Jantri, F5 -> Search Refresh
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        window.open(`/transaction_add/${selectedShiftId || '1'}`, '_blank');
      } else if (e.key === 'F3') {
        // Jantri View popup for the selected slip's party (Consolidate / Cut toggles inside)
        e.preventDefault();
        setShowJantriModal(true);
      } else if (e.key === 'F5') {
        e.preventDefault();
        fetchTransactionsRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShiftId, searchParty, selectedStatus, onNavigate]);

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

  const visibleList = appliedStaff
    ? list.filter(t => (t.addedBy || '').toUpperCase() === appliedStaff.toUpperCase())
    : list;
  const staffOptions = Array.from(new Set(list.map(t => (t.addedBy || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
  const totalSum = visibleList.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);

  return (
    <div className="h-[calc(100vh-82px)] max-h-[calc(100vh-82px)] min-h-[520px] bg-[#eaedf2] p-2 sm:p-2.5 flex flex-col justify-between text-slate-800 select-none font-sans text-xs overflow-hidden">
      {/* Outer Card matching pbmax1.com Screenshot 3 */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1 min-h-0">
        {/* Subheader Filter Bar matching Screenshot 3 */}
        <form onSubmit={handleSearchSubmit} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white flex-shrink-0">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">
            Declare Transactions
          </span>

          {/* Shift dropdown with soft yellow background matching Screenshot 3 */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Shift</span>
            <select
              id="decl-shift"
              value={selectedShiftId}
              onChange={(e) => setSelectedShiftId(e.target.value)}
              // Up/Down changes the shift (its slips load); Enter moves to the date's day part
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focusField('decl-date-dd');
                }
              }}
              className="px-2.5 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-36 shadow-xs"
            >
              <option value="">-- CHOOSE --</option>
              {availableShifts.map((s: ShiftDto) => (
                <option key={s.id} value={s.id}>{s.name.replace(/\s*\(\d+\)\s*$/, '').trim()}</option>
              ))}
            </select>
          </div>

          {/* Date — a real filter now, not a label */}
          <div className="flex items-center gap-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs tracking-wider">
            <input
              id="decl-date-dd"
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={dd}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setDd(v); commitDate(v, mm, yyyy); }}
              onKeyDown={(e) => onDatePartKeyDown('dd', e)}
              className="w-7 text-center bg-transparent outline-none font-semibold text-slate-700 focus:bg-[#fde68a] rounded-xs"
            />
            <span className="text-slate-500">/</span>
            <input
              id="decl-date-mm"
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={mm}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setMm(v); commitDate(dd, v, yyyy); }}
              onKeyDown={(e) => onDatePartKeyDown('mm', e)}
              className="w-7 text-center bg-transparent outline-none font-semibold text-slate-700 focus:bg-[#fde68a] rounded-xs"
            />
            <span className="text-slate-500">/</span>
            <input
              id="decl-date-yyyy"
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={yyyy}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setYyyy(v); commitDate(dd, mm, v); }}
              onKeyDown={(e) => onDatePartKeyDown('yyyy', e)}
              className="w-10 text-center bg-transparent outline-none font-semibold text-slate-700 focus:bg-[#fde68a] rounded-xs"
            />
          </div>

          {/* Search Party Input */}
          <div className="relative">
            <input
              id="decl-search-party"
              type="text"
              value={searchParty}
              onChange={(e) => setSearchParty(e.target.value)}
              // Enter still runs the Search (form submit), then the cursor moves to the staff filter
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  requestAnimationFrame(() => focusField('decl-staff'));
                }
              }}
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

          {/* All Staff dropdown */}
          <select
            id="decl-staff"
            value={selectedStaff}
            // Up/Down (or a pick) switches the staff and the list follows at once; Enter -> status
            onChange={(e) => {
              setSelectedStaff(e.target.value);
              setAppliedStaff(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                focusField('decl-status');
              }
            }}
            className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="">-- ALL STAFF --</option>
            {staffOptions.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
            {selectedStaff && !staffOptions.includes(selectedStaff) && (
              <option value={selectedStaff}>{selectedStaff}</option>
            )}
          </select>

          {/* Status dropdown */}
          <select
            id="decl-status"
            value={selectedStatus}
            // Up/Down switches the status and the list reloads for it; Enter highlights Add (F2),
            // whose own Enter then opens it
            onChange={(e) => setSelectedStatus(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                focusField('decl-add-btn');
              }
            }}
            className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="ALL">ALL</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="VOIDED">VOIDED</option>
          </select>
        </form>

        {/* Dual-Pane Section: Left 9-Column Table, Right Party Numbers Panel */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden border-b border-slate-300">
          {/* LEFT: Main 9-Column Table Container with Vertical Scrollbar */}
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
                      Loading declared transactions...
                    </td>
                  </tr>
                ) : visibleList.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                      {!selectedShiftId
                        ? 'Choose a shift to view its declared transactions.'
                        : !isSelectedShiftDeclared
                        ? `Result for "${selectedShift?.name || 'this shift'}" has not been declared yet.`
                        : 'No transactions found for this shift.'}
                    </td>
                  </tr>
                ) : (
                  visibleList.map((tx, idx) => {
                    const isSelected = selectedTx?.id === tx.id;
                    return (
                      <tr
                        key={tx.id}
                        onClick={() => setSelectedTx(tx)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/80 font-semibold' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-1.5 px-2.5 text-center font-mono text-slate-600 border-r border-b border-slate-200">
                          {idx + 1}
                        </td>
                        <td className="py-1.5 px-2 text-center border-r border-b border-slate-200">
                          <span className="inline-flex items-center justify-center w-3.5 h-3.5 bg-[#1d4ed8] text-white rounded-[2px] text-[9px] font-bold shadow-xs">
                            ✓
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 text-center font-bold text-slate-800 border-r border-b border-slate-200">
                          {tx.ujType || 'U'}
                        </td>
                        <td className="py-1.5 px-3 font-bold text-slate-900 uppercase tracking-tight border-r border-b border-slate-200">
                          {tx.partyName}
                        </td>
                        <td className="py-1.5 px-3 font-mono font-medium text-slate-700 border-r border-b border-slate-200">
                          {tx.rateStr || '90/10 -9/10'}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-b border-slate-200">
                          {tx.totalAmount.toLocaleString('en-IN')}
                        </td>
                        <td className="py-1 px-3 border-r border-b border-slate-200 leading-snug">
                          <div className="font-bold text-slate-900 uppercase text-[11px]">{tx.addedBy || 'B08'}</div>
                          <div className="font-mono text-slate-500 text-[10px]">{formatDateTimePb(tx.createdAt)}</div>
                        </td>
                        <td className="py-1 px-3 border-r border-b border-slate-200 leading-snug">
                          <div className="font-bold text-slate-900 uppercase text-[11px]">{tx.updatedBy || tx.addedBy || 'B08'}</div>
                          <div className="font-mono text-slate-500 text-[10px]">{formatDateTimePb(tx.updatedAt || tx.createdAt)}</div>
                        </td>
                        {/* 4 Action Buttons matching Screenshot 3: Copy, View, Edit, Delete */}
                        <td className="py-1.5 px-2 text-center border-b border-slate-200">
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
                                // Live: View just shows the slip's numbers in the right-hand
                                // panel (no popup) — same as clicking the row
                                setSelectedTx(tx);
                              }}
                              title="View Slip Details"
                              className="px-2 py-0.5 bg-[#1662c6] hover:bg-[#1354ab] text-white text-[10px] font-bold rounded shadow-xs transition-colors cursor-pointer"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Live: opens the slip's full entry grid on its own page,
                                // /declare_transaction_edit/:shiftId/:txId ("<SHIFT> [DECLARE]").
                                window.open(`/declare_transaction_edit/${tx.shiftId}/${tx.id}`, '_blank');
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
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="sticky bottom-0 z-20 bg-[#152847]">
                {/* Summary Row matching Screenshot 3 */}
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className="py-2 px-2.5 text-center border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">
                    {visibleList.length}
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

          {/* RIGHT: Live Party Breakdown Panel matching Screenshot 3 */}
          <div className="w-full lg:w-72 bg-white flex flex-col border-t lg:border-t-0 border-slate-300 flex-shrink-0">
            {/* Header */}
            <div className="bg-[#152847] text-white font-bold text-[11px] py-2 px-3 border-b border-[#223b63] flex-shrink-0">
              Party: <span className="text-amber-300 font-bold">{selectedTx?.partyName || '-'}</span>
            </div>
            {/* Sub-header */}
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
                    <span className="text-right font-semibold">₹{ent.amount.toLocaleString('en-IN')}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar matching Screenshot 3 */}
        <div className="p-2 sm:p-2.5 bg-[#eaedf2] flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 flex-shrink-0">
          {/* Left Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Kwada Trans
            </button>
            <button
              type="button"
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Abs Party
            </button>
          </div>

          {/* Right Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="decl-add-btn"
              type="button"
              onClick={() => window.open(`/transaction_add/${selectedShiftId || '1'}`, '_blank')}
              className="px-4 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1662c6]"
            >
              Add (F2)
            </button>
            <button
              type="button"
              onClick={() => setShowJantriModal(true)}
              className="px-4 py-1.5 bg-[#d97706] hover:bg-[#b45309] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Jantri View (F3)
            </button>
            <button
              type="button"
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              HPL-Jantri
            </button>
            <button
              type="button"
              className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
            >
              Main Jantri (F7)
            </button>
            <select className="px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 cursor-pointer">
              <option value="Active">Active</option>
              <option value="All">All</option>
            </select>
          </div>
        </div>
      </div>

      {/* View Slip Modal */}
      {showViewModal && viewingTx && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Declared Slip: {viewingTx.slipNumber}</h2>
              <button
                type="button"
                onClick={() => setShowViewModal(false)}
                className="text-white hover:text-slate-300 p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded border border-slate-200">
                <div>Party: <span className="font-bold text-slate-900 uppercase">{viewingTx.partyName}</span></div>
                <div>Shift: <span className="font-bold text-slate-900 uppercase">{viewingTx.shiftName}</span></div>
                <div>Total Amount: <span className="font-bold font-mono text-emerald-700">₹{viewingTx.totalAmount.toLocaleString('en-IN')}</span></div>
                <div>Rate: <span className="font-mono font-bold text-slate-800">{viewingTx.rateStr || '90/10-9/10'}</span></div>
              </div>

              <div>
                <h3 className="font-bold text-slate-800 mb-1.5">Slip Numbers Breakdown:</h3>
                <div className="border border-slate-200 rounded overflow-hidden max-h-52 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#152847] text-white font-bold text-[11px]">
                      <tr>
                        <th className="py-1.5 px-3">Number</th>
                        <th className="py-1.5 px-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {!viewingTx.entries || viewingTx.entries.length === 0 ? (
                        <tr><td colSpan={2} className="py-4 text-center text-slate-400">No entry details available</td></tr>
                      ) : (
                        viewingTx.entries.map((e, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-1.5 px-3 font-bold text-blue-700">{displayNumber(e)}</td>
                            <td className="py-1.5 px-3 text-right font-semibold">₹{e.amount}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowViewModal(false)}
                  className="px-5 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Slip Modal */}
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
      <JantriViewModal
        open={showJantriModal}
        onClose={() => setShowJantriModal(false)}
        selectedTx={selectedTx}
        list={visibleList}
      />
    </div>
  );
};
