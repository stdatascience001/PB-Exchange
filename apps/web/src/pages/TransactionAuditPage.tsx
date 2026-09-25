import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto, UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { X } from 'lucide-react';
import { TransactionItem } from './TransactionListPage.js';

interface TransactionAuditPageProps {
  shifts?: ShiftDto[];
  user?: UserSession | null;
  onNavigate?: (page: string) => void;
  isDeclareMode?: boolean;
}

function formatAuditDateTime(dateVal: any): string {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  const day = String(d.getDate()).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, '0');
  return `${day} - ${hh}:${minutes} ${ampm}`;
}

export const TransactionAuditPage: React.FC<TransactionAuditPageProps> = ({
  shifts = [],
  user,
  onNavigate,
  isDeclareMode = false,
}) => {
  const [list, setList] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchParty, setSearchParty] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('NOT-AUDIT');
  
  // Filter shifts based on mode (Declare Trans-Audit shows declared/audited shifts; Live Trans-Audit shows open shifts)
  const availableShifts = useMemo(() => {
    // Only active shifts belong in this dropdown — a disabled shift (Shift Manage's
    // Enable/Disable tab) shouldn't still be selectable here.
    const activeOnly = shifts.filter(s => s.isActive !== false);
    const base = activeOnly.length > 0 ? activeOnly : shifts;
    if (isDeclareMode) {
      const declared = base.filter(s => !!s.declaredNumber || s.status === 'DECLARED' || s.status === 'AUDITED');
      return declared.length > 0 ? declared : base;
    } else {
      const live = base.filter(s => !s.declaredNumber && s.status !== 'DECLARED' && s.status !== 'AUDITED');
      return live.length > 0 ? live : base;
    }
  }, [shifts, isDeclareMode]);

  const [selectedShiftId, setSelectedShiftId] = useState<string>(
    isDeclareMode ? (availableShifts[0]?.id.toString() || '1') : ''
  );

  // Sync selectedShiftId when available shifts or mode change
  useEffect(() => {
    if (isDeclareMode) {
      if (availableShifts.length > 0) {
        const exists = availableShifts.some(s => String(s.id) === String(selectedShiftId));
        if (!exists) {
          setSelectedShiftId(String(availableShifts[0].id));
        }
      }
    }
  }, [availableShifts, isDeclareMode]);

  // Selected shift details and date formatting
  const activeShiftObj = shifts.find(s => String(s.id) === String(selectedShiftId));
  const formattedDateStr = useMemo(() => {
    if (activeShiftObj?.openDate) {
      const parts = activeShiftObj.openDate.split('-');
      if (parts.length === 3) {
        return `${parts[2]} / ${parts[1]} / ${parts[0]}`;
      }
      return activeShiftObj.openDate;
    }
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')} / ${String(d.getMonth() + 1).padStart(2, '0')} / ${d.getFullYear()}`;
  }, [activeShiftObj]);

  // Selected transaction for right-hand panel
  const [selectedTx, setSelectedTx] = useState<TransactionItem | null>(null);

  // Modals
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingTx, setViewingTx] = useState<TransactionItem | null>(null);
  const [showJantriModal, setShowJantriModal] = useState(false);
  const [showPartyWiseModal, setShowPartyWiseModal] = useState(false);

  // Live Trans-Audit reports on TODAY only. The live page carries no date control, yet its
  // request still pins the day — its form data reads ShiftId 84 / ShiftDate 2026-09-23, the
  // current date — and the rows it draws are all from that day. Without this the local page
  // was asking for the shift with no date at all and getting every cycle's slips back.
  //
  // Read at fetch time rather than held in state, so a tab left open across midnight starts
  // reporting on the new day by itself.
  const currentDateStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedShiftId) params.append('shiftId', selectedShiftId);
      // Live mode only. Declare Trans-Audit runs off the same component and is normally used
      // on already-declared cycles, which are often past days — pinning it to today would
      // empty that page, so its behaviour is left exactly as it was.
      if (!isDeclareMode) params.append('date', currentDateStr());
      if (searchParty.trim()) params.append('search', searchParty.trim());
      if (selectedStatus && selectedStatus !== 'ALL') params.append('auditStatus', selectedStatus);

      const res = await apiRequest<TransactionItem[]>(`/transactions?${params.toString()}`);
      if (res.data) {
        setList(res.data);
        if (res.data.length > 0) {
          // Keep current selection or default to first
          if (!selectedTx || !res.data.some(t => t.id === selectedTx.id)) {
            setSelectedTx(res.data[0]);
          }
        } else {
          setSelectedTx(null);
        }
      }
    } catch (err) {
      console.warn('Failed to load audit transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [selectedShiftId, selectedStatus]);

  // Keyboard Shortcuts: F5 -> Search Refresh, F3 -> Jantri View
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        fetchTransactions();
      }
      if (e.key === 'F3' || e.key === 'F1') {
        e.preventDefault();
        setShowJantriModal(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShiftId, searchParty, selectedStatus]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTransactions();
  };

  const handleAuditAction = async (txId: number, status: 'VALID' | 'MISTAKE') => {
    try {
      await apiRequest(`/transactions/${txId}/audit`, {
        method: 'PATCH',
        body: JSON.stringify({ auditStatus: status }),
      });
      fetchTransactions();
    } catch (err: any) {
      alert(err.message || 'Audit action failed');
    }
  };

  const totalSum = list.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);

  // Party Wise summary aggregation
  const partyWiseSummary = useMemo(() => {
    const map = new Map<string, { partyName: string; count: number; totalAmount: number }>();
    for (const tx of list) {
      const name = tx.partyName || 'UNKNOWN';
      if (!map.has(name)) {
        map.set(name, { partyName: name, count: 0, totalAmount: 0 });
      }
      const item = map.get(name)!;
      item.count += 1;
      item.totalAmount += (tx.totalAmount || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [list]);

  return (
    <div className="h-[calc(100vh-82px)] max-h-[calc(100vh-82px)] min-h-[520px] bg-[#eaedf2] p-2 sm:p-2.5 flex flex-col justify-between text-slate-800 select-none font-sans text-xs overflow-hidden">
      {/* Outer Card matching pbmax1.com Live Screenshot 1 & 2 */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1 min-h-0">
        
        {/* Subheader Filter Bar matching Screenshot 1 (Live Trans-Audit) & Screenshot 2 (Declare Trans-Audit) */}
        <form onSubmit={handleSearchSubmit} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white flex-shrink-0">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">
            {isDeclareMode ? 'Declare Trans-Audit' : 'Live Trans-Audit'}
          </span>

          {/* Shift selector with soft yellow background */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Shift</span>
            <select
              value={selectedShiftId}
              onChange={(e) => setSelectedShiftId(e.target.value)}
              className="px-2.5 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-36 shadow-xs"
            >
              <option value="">-- ALL SHIFT --</option>
              {availableShifts.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Box: Displayed specifically on Declare Trans-Audit matching Screenshot 2 */}
          {isDeclareMode && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-600 font-medium text-xs">Date</span>
              <div className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-700 tracking-wider">
                {formattedDateStr}
              </div>
            </div>
          )}

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

          {/* Status Dropdown (NOT-AUDIT / VALID / MISTAKE / ALL) */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Status</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="NOT-AUDIT">NOT-AUDIT</option>
              <option value="VALID">VALID</option>
              <option value="MISTAKE">MISTAKE</option>
              <option value="ALL">ALL</option>
            </select>
          </div>

          {/* Search (F5) Teal Button */}
          <button
            type="submit"
            className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
          >
            Search (F5)
          </button>
        </form>

        {/* Dual-Pane Section: Left 9-Column Table, Right Party Numbers Panel */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden border-b border-slate-300">
          
          {/* LEFT: Main 9-Column Table with Vertical Scrollbar */}
          <div className="flex-1 min-h-0 overflow-y-scroll overflow-x-auto border-r border-slate-300 relative pbmax-table-scrollbar">
            <table className="w-full text-left text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-20 bg-[#152847]">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <th className="py-2 px-2.5 border-r border-b border-[#223b63] w-10 text-center sticky top-0 bg-[#152847] z-20">Sr</th>
                  <th className="py-2 px-2 border-r border-b border-[#223b63] w-8 text-center sticky top-0 bg-[#152847] z-20">D</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Shift</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Party</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Rate</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] text-right sticky top-0 bg-[#152847] z-20">Amount</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Added</th>
                  <th className="py-2 px-3 border-r border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Updated</th>
                  <th className="py-2 px-3 text-center w-40 border-b border-[#223b63] sticky top-0 bg-[#152847] z-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                      Loading audit transactions...
                    </td>
                  </tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 font-medium">
                      No transactions pending audit for this filter.
                    </td>
                  </tr>
                ) : (
                  list.map((tx, idx) => {
                    const isSelected = selectedTx?.id === tx.id;
                    return (
                      <tr
                        key={tx.id}
                        onClick={() => setSelectedTx(tx)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/80 font-semibold' : 'hover:bg-slate-50'
                        }`}
                      >
                        {/* 1. Sr */}
                        <td className="py-1.5 px-2.5 text-center font-mono text-slate-600 border-r border-b border-slate-200">
                          {idx + 1}
                        </td>

                        {/* 2. D (Checkbox Box matching Screenshot 1 & 2) */}
                        <td className="py-1.5 px-2 text-center border-r border-b border-slate-200">
                          <div className="flex items-center justify-center">
                            <span className="w-3.5 h-3.5 border border-sky-500 bg-sky-50/60 rounded-xs flex items-center justify-center text-[9px] text-sky-600 font-bold leading-none">
                              {tx.isD ? '✓' : ''}
                            </span>
                          </div>
                        </td>

                        {/* 3. Shift */}
                        <td className="py-1.5 px-3 uppercase font-semibold text-slate-800 border-r border-b border-slate-200">
                          {tx.shiftName}
                        </td>

                        {/* 4. Party */}
                        <td className="py-1.5 px-3 font-bold text-slate-900 uppercase tracking-tight border-r border-b border-slate-200">
                          {tx.partyName}
                        </td>

                        {/* 5. Rate */}
                        <td className="py-1.5 px-3 font-mono font-medium text-slate-700 border-r border-b border-slate-200">
                          {tx.rateStr || '90/10-9/10'}
                        </td>

                        {/* 6. Amount */}
                        <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 border-r border-b border-slate-200">
                          {tx.totalAmount.toLocaleString('en-IN')}
                        </td>

                        {/* 7. Added (Staff code on line 1, DD - HH:MM AM/PM on line 2) */}
                        <td className="py-1 px-3 border-r border-b border-slate-200 leading-snug">
                          <div className="font-bold text-slate-900 uppercase text-[11px]">{tx.addedBy || 'SYSTEM'}</div>
                          <div className="font-mono text-slate-500 text-[10px]">{formatAuditDateTime(tx.createdAt)}</div>
                        </td>

                        {/* 8. Updated (Staff code on line 1, DD - HH:MM AM/PM on line 2) */}
                        <td className="py-1 px-3 border-r border-b border-slate-200 leading-snug">
                          <div className="font-bold text-slate-900 uppercase text-[11px]">{tx.updatedBy || tx.addedBy || 'SYSTEM'}</div>
                          <div className="font-mono text-slate-500 text-[10px]">{formatAuditDateTime(tx.updatedAt || tx.createdAt)}</div>
                        </td>

                        {/* 9. Action (View, Valid, Mistake) */}
                        <td className="py-1.5 px-2 text-center border-b border-slate-200">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewingTx(tx);
                                setShowViewModal(true);
                              }}
                              className="px-2.5 py-0.5 bg-[#1662c6] hover:bg-[#1354ab] text-white text-[10px] font-bold rounded shadow-xs transition-colors cursor-pointer"
                            >
                              View
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAuditAction(tx.id, 'VALID');
                              }}
                              className="px-2.5 py-0.5 bg-[#0284c7] hover:bg-[#0369a1] text-white text-[10px] font-bold rounded shadow-xs transition-colors cursor-pointer"
                            >
                              Valid
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAuditAction(tx.id, 'MISTAKE');
                              }}
                              className="px-2.5 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[10px] font-bold rounded shadow-xs transition-colors cursor-pointer"
                            >
                              Mistake
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              {/* Table Footer Summary Row matching Screenshot 1 & 2 */}
              <tfoot className="sticky bottom-0 z-20 bg-[#152847]">
                <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                  <td className="py-2 px-2.5 text-center border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">
                    {list.length}
                  </td>
                  <td className="py-2 px-2 text-center border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">D</td>
                  <td className="py-2 px-3 border-r border-t border-[#223b63] sticky bottom-0 bg-[#152847] z-20">Shift</td>
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

          {/* RIGHT: Live Party Breakdown Panel matching Screenshot 1 & 2 */}
          <div className="w-full lg:w-72 bg-white flex flex-col border-t lg:border-t-0 border-slate-300 flex-shrink-0">
            {/* Header */}
            <div className="bg-[#152847] text-white font-bold text-[11px] py-2 px-3 border-b border-[#223b63] flex-shrink-0">
              Party: <span className="text-amber-300 font-bold">{selectedTx?.partyName || '-'}</span>
            </div>
            {/* Subheader */}
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
                    <span className="font-bold text-blue-700">{ent.numberValue}</span>
                    <span className="text-right font-semibold">₹{ent.amount.toLocaleString('en-IN')}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Bar matching Screenshot 1 & 2 */}
        <div className="p-2 sm:p-2.5 bg-[#eaedf2] flex flex-wrap items-center justify-end gap-2 border-t border-slate-300">
          <button
            type="button"
            onClick={() => setShowPartyWiseModal(true)}
            className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
          >
            Party Wise
          </button>
          <button
            type="button"
            onClick={() => setShowJantriModal(true)}
            className="px-4 py-1.5 bg-[#ca8a04] hover:bg-[#b45309] active:bg-[#92400e] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
          >
            Jantri View (F3)
          </button>
        </div>
      </div>

      {/* View Slip Modal */}
      {showViewModal && viewingTx && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Audit Slip: {viewingTx.slipNumber}</h2>
              <button
                type="button"
                onClick={() => setShowViewModal(false)}
                className="text-white hover:text-slate-300 p-0.5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded border border-slate-200">
                <div>Party: <span className="font-bold text-slate-900 uppercase">{viewingTx.partyName}</span></div>
                <div>Shift: <span className="font-bold text-slate-900 uppercase">{viewingTx.shiftName}</span></div>
                <div>Rate: <span className="font-bold font-mono text-slate-800">{viewingTx.rateStr || '90/10-9/10'}</span></div>
                <div>Status: <span className="font-bold text-slate-800 uppercase">{viewingTx.auditStatus || 'NOT-AUDIT'}</span></div>
                <div className="col-span-2">Total Amount: <span className="font-bold font-mono text-emerald-700 text-sm">₹{viewingTx.totalAmount.toLocaleString('en-IN')}</span></div>
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
                            <td className="py-1.5 px-3 font-bold text-blue-700">{e.numberValue}</td>
                            <td className="py-1.5 px-3 text-right font-semibold">₹{e.amount}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      handleAuditAction(viewingTx.id, 'VALID');
                      setShowViewModal(false);
                    }}
                    className="px-4 py-1.5 bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold rounded text-xs cursor-pointer shadow-xs"
                  >
                    Mark Valid
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleAuditAction(viewingTx.id, 'MISTAKE');
                      setShowViewModal(false);
                    }}
                    className="px-4 py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold rounded text-xs cursor-pointer shadow-xs"
                  >
                    Mark Mistake
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowViewModal(false)}
                  className="px-4 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold text-xs rounded cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 10x10 Jantri Matrix Modal (F3) */}
      {showJantriModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Audit Jantri Matrix View (F3)</h2>
              <button
                type="button"
                onClick={() => setShowJantriModal(false)}
                className="text-white hover:text-slate-300 p-0.5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-10 gap-1 font-mono text-[11px] text-center">
                {Array.from({ length: 100 }, (_, i) => {
                  const num = i.toString().padStart(2, '0');
                  const match = list.flatMap(t => t.entries || []).filter(e => e.numberValue === num);
                  const sum = match.reduce((a, b) => a + b.amount, 0);
                  return (
                    <div
                      key={num}
                      className={`p-1.5 rounded border ${
                        sum > 0 ? 'bg-emerald-100 border-emerald-300 text-emerald-900 font-bold' : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      <div className="text-[10px] text-slate-400">{num}</div>
                      <div>{sum > 0 ? `₹${sum}` : '-'}</div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowJantriModal(false)}
                  className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Party Wise Summary Modal */}
      {showPartyWiseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Party-Wise Audit Summary</h2>
              <button
                type="button"
                onClick={() => setShowPartyWiseModal(false)}
                className="text-white hover:text-slate-300 p-0.5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="border border-slate-200 rounded overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#152847] text-white font-bold text-[11px] sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Party Name</th>
                      <th className="py-2 px-3 text-center w-20">Slips</th>
                      <th className="py-2 px-3 text-right">Total Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {partyWiseSummary.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-slate-400">No parties found</td>
                      </tr>
                    ) : (
                      partyWiseSummary.map((p, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="py-1.5 px-3 font-bold text-slate-900 uppercase">{p.partyName}</td>
                          <td className="py-1.5 px-3 text-center font-mono text-slate-600">{p.count}</td>
                          <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900">₹{p.totalAmount.toLocaleString('en-IN')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold border-t border-slate-300">
                    <tr>
                      <td className="py-2 px-3 text-slate-800">Total</td>
                      <td className="py-2 px-3 text-center font-mono text-slate-800">{list.length}</td>
                      <td className="py-2 px-3 text-right font-mono text-slate-900">₹{totalSum.toLocaleString('en-IN')}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex justify-end pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowPartyWiseModal(false)}
                  className="px-5 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded cursor-pointer"
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
