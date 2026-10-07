import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ShiftDto, UserSession, LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { displayNumber } from '../utils/entryDisplay.js';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import { TransactionItem } from './TransactionListPage.js';
import { JantriViewModal } from '../components/JantriViewModal.js';
import { MistakeActionModal } from '../components/MistakeActionModal.js';

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
  // Page opens with the cursor on the Shift dropdown
  useEffect(() => {
    const id = requestAnimationFrame(() => document.getElementById('audit-shift')?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
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
  // Mistake button opens MistakeActionModal (confirm → mistake text); OK on the text step
  // saves.
  const [mistakeTxId, setMistakeTxId] = useState<number | null>(null);

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

  // Live Trans-Audit only loads on Search (F5). The filters that search ran with are kept
  // here so a Valid/Mistake click refreshes the same result set even if the dropdowns were
  // changed afterwards without searching again.
  const appliedFiltersRef = useRef<{ shiftId: string; search: string; status: string } | null>(null);

  const fetchTransactions = async (
    filters: { shiftId: string; search: string; status: string } = {
      shiftId: selectedShiftId,
      search: searchParty,
      status: selectedStatus,
    }
  ) => {
    // Live page: with "-- ALL SHIFT --" the search returns no rows at all (the live grid
    // stays empty with a 0 total), so no request is made and the grid is cleared.
    if (!isDeclareMode) {
      appliedFiltersRef.current = filters;
      if (!filters.shiftId) {
        setList([]);
        setSelectedTx(null);
        return;
      }
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.shiftId) params.append('shiftId', filters.shiftId);
      // Live mode only. Declare Trans-Audit runs off the same component and is normally used
      // on already-declared cycles, which are often past days — pinning it to today would
      // empty that page, so its behaviour is left exactly as it was.
      if (!isDeclareMode) params.append('date', currentDateStr());
      if (filters.search.trim()) params.append('search', filters.search.trim());
      if (filters.status && filters.status !== 'ALL') params.append('auditStatus', filters.status);

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

  // Declare Trans-Audit keeps reloading as its filters change. Live Trans-Audit does not:
  // it opens empty and only loads when Search (F5) is pressed with a shift selected.
  useEffect(() => {
    if (isDeclareMode) fetchTransactions();
  }, [selectedShiftId, selectedStatus, isDeclareMode]);

  // Refresh after an audit action with the filters of the last search (live), or the
  // current filters (declare, which always reflects its dropdowns).
  const refreshAfterAction = () => {
    if (!isDeclareMode && appliedFiltersRef.current) {
      fetchTransactions(appliedFiltersRef.current);
    } else if (isDeclareMode) {
      fetchTransactions();
    }
  };

  // Party list for the live page's SEARCH PARTY suggestions — ledger names from the DB.
  const [parties, setParties] = useState<LedgerDto[]>([]);
  const [showPartyList, setShowPartyList] = useState(false);
  const [partyHighlight, setPartyHighlight] = useState(0);
  const partyListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDeclareMode) return;
    apiRequest<LedgerDto[]>('/ledgers')
      .then(res => { if (res.data) setParties(res.data); })
      .catch(err => console.warn('Failed to load parties:', err));
  }, [isDeclareMode]);

  // Live suggestions list parties whose name starts with the typed text, alphabetically.
  const partySuggestions = useMemo(() => {
    const term = searchParty.trim().toUpperCase();
    if (!term) return [];
    return parties
      .filter(p => (p.partyName || '').toUpperCase().startsWith(term))
      .sort((a, b) => a.partyName.localeCompare(b.partyName));
  }, [parties, searchParty]);

  useEffect(() => {
    setPartyHighlight(0);
  }, [searchParty]);

  // Keep the highlighted suggestion scrolled into view while arrowing through the list.
  useEffect(() => {
    const el = partyListRef.current?.children[partyHighlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [partyHighlight]);

  const pickParty = (name: string) => {
    setSearchParty(name);
    setShowPartyList(false);
  };

  // Filter bar Enter flow (as live): Shift -> Search Party -> Status -> Search (F5) highlighted,
  // whose own Enter runs the search. Up/Down change the Shift / Status as usual for a select.
  const focusAuditField = (id: string) => {
    const el = document.getElementById(id) as HTMLElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  };

  const handlePartyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showPartyList || partySuggestions.length === 0) {
      // No suggestion list open: Enter moves on to Status
      if (e.key === 'Enter') {
        e.preventDefault();
        focusAuditField('audit-status');
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setPartyHighlight(h => Math.min(h + 1, partySuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setPartyHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // Enter picks the highlighted party instead of submitting the search.
      e.preventDefault();
      const p = partySuggestions[partyHighlight];
      if (p) pickParty(p.partyName);
      focusAuditField('audit-status');
    } else if (e.key === 'Escape') {
      setShowPartyList(false);
    }
  };

  // Keyboard Shortcuts: F5 -> Search Refresh, F3 -> Jantri View
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // While the Mistake popup is up, F5/F3 must not reload the list or open Jantri behind it.
      if (mistakeTxId !== null) return;
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
  }, [selectedShiftId, searchParty, selectedStatus, mistakeTxId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTransactions();
  };

  const handleAuditAction = async (txId: number, status: 'VALID' | 'MISTAKE', mistakeRemark?: string) => {
    try {
      await apiRequest(`/transactions/${txId}/audit`, {
        method: 'PATCH',
        body: JSON.stringify({ auditStatus: status, mistakeRemark }),
      });
      if (status === 'MISTAKE') {
        toast.success(
          <div>
            <div className="font-bold text-base">Message</div>
            <div className="text-sm mt-0.5">Audit (MISTAKE) has been updated successfully!</div>
          </div>,
          { toastId: `audit-mistake-${txId}` }
        );
      }
      refreshAfterAction();
    } catch (err: any) {
      alert(err.message || 'Audit action failed');
    }
  };

  const totalSum = list.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);

  // Party Wise -> "Party Trans Count" popup (live): opens empty; its own Search loads every
  // slip of the chosen shift (all shifts on "-- ALL SHIFT --") for the day — whatever the
  // audit Status / Search Party filters say — and lists each party's slip COUNT and TOTAL-AMT.
  const [ptcRows, setPtcRows] = useState<{ party: string; count: number; total: number }[] | null>(null);
  const [ptcLoading, setPtcLoading] = useState(false);
  const openPartyWise = () => {
    setPtcRows(null);
    setShowPartyWiseModal(true);
    requestAnimationFrame(() => document.getElementById('ptc-search-btn')?.focus());
  };
  const handlePartyTransCountSearch = async () => {
    if (ptcLoading) return;
    setPtcLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedShiftId) params.append('shiftId', selectedShiftId);
      if (!isDeclareMode) params.append('date', currentDateStr());
      const res = await apiRequest<TransactionItem[]>(`/transactions?${params.toString()}`);
      const map = new Map<string, { party: string; count: number; total: number }>();
      for (const tx of res.data || []) {
        const name = tx.partyName || 'UNKNOWN';
        const row = map.get(name) || { party: name, count: 0, total: 0 };
        row.count += 1;
        row.total += tx.totalAmount || 0;
        map.set(name, row);
      }
      setPtcRows(Array.from(map.values()).sort((a, b) => a.party.localeCompare(b.party)));
    } catch (err) {
      console.warn('Failed to load party trans count:', err);
      setPtcRows([]);
    } finally {
      setPtcLoading(false);
    }
  };
  const handlePartyTransCountExcel = () => {
    if (!ptcRows || ptcRows.length === 0) {
      toast.error(
        <div>
          <div className="font-bold text-base">Error</div>
          <div className="text-sm mt-0.5">Record not avaliable!</div>
        </div>,
        { toastId: 'ptc-excel-empty' }
      );
      return;
    }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['SR,PARTY,COUNT,TOTAL-AMT'].concat(
      ptcRows.map((r, i) => [i + 1, esc(r.party), r.count, Math.round(r.total)].join(','))
    );
    const link = document.createElement('a');
    link.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n')));
    link.setAttribute('download', 'party_trans_count.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  // Esc (or a click on the dimmed area outside the box) closes the popup, as its X does
  useEffect(() => {
    if (!showPartyWiseModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setShowPartyWiseModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPartyWiseModal]);
  const ptcBackdropDownRef = useRef(false);

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
              id="audit-shift"
              value={selectedShiftId}
              onChange={(e) => setSelectedShiftId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focusAuditField('audit-search-party');
                }
              }}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:bg-[#fef08a] focus:border-amber-300 cursor-pointer min-w-36 shadow-xs"
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
              id="audit-search-party"
              type="text"
              value={searchParty}
              onChange={(e) => {
                setSearchParty(e.target.value);
                if (!isDeclareMode) setShowPartyList(true);
              }}
              onFocus={() => { if (!isDeclareMode) setShowPartyList(true); }}
              onBlur={() => setShowPartyList(false)}
              onKeyDown={isDeclareMode
                ? (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      focusAuditField('audit-status');
                    }
                  }
                : handlePartyKeyDown}
              autoComplete="off"
              placeholder="SEARCH PARTY..."
              className="w-36 sm:w-44 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:border-blue-500 uppercase placeholder:text-slate-400 font-semibold"
            />
            {/* Live page: party names from the ledger master that start with the typed text */}
            {!isDeclareMode && showPartyList && partySuggestions.length > 0 && (
              <div
                ref={partyListRef}
                className="absolute left-0 top-full mt-0.5 w-56 max-h-48 overflow-y-auto bg-white border border-slate-400 rounded-xs shadow-lg z-40"
              >
                {partySuggestions.map((p, i) => (
                  <div
                    key={p.id}
                    // onMouseDown (not onClick) so the pick lands before the input's blur closes the list
                    onMouseDown={(e) => { e.preventDefault(); pickParty(p.partyName); }}
                    onMouseEnter={() => setPartyHighlight(i)}
                    className={`px-2 py-0.5 text-xs uppercase cursor-pointer ${
                      i === partyHighlight ? 'bg-[#f6c343] font-bold text-slate-900' : 'text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    {p.partyName}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Status Dropdown (NOT-AUDIT / VALID / MISTAKE / ALL) */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Status</span>
            <select
              id="audit-status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focusAuditField('audit-search-btn');
                }
              }}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:bg-[#fef08a] focus:border-amber-300 cursor-pointer"
            >
              {/* Live Trans-Audit offers exactly NOT-AUDIT / AUDITED / ALL (AUDITED = marked
                  Valid or Mistake); Declare Trans-Audit keeps its existing options. */}
              <option value="NOT-AUDIT">NOT-AUDIT</option>
              {isDeclareMode ? (
                <>
                  <option value="VALID">VALID</option>
                  <option value="MISTAKE">MISTAKE</option>
                </>
              ) : (
                <option value="AUDITED">AUDITED</option>
              )}
              <option value="ALL">ALL</option>
            </select>
          </div>

          {/* Search (F5) Teal Button */}
          <button
            id="audit-search-btn"
            type="submit"
            className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00897b] inline-flex items-center gap-1.5"
          >
            Search (F5)
            {/* Spinner while the search runs, as live */}
            {loading && (
              <span className="inline-block h-3 w-3 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
            )}
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
                        {/* Red once a Mistake slip has been edited, as on the live Trans-Audit */}
                        <td className="py-1 px-3 border-r border-b border-slate-200 leading-snug">
                          <div className={`font-bold uppercase text-[11px] ${tx.mistakeEdited ? 'text-red-600' : 'text-slate-900'}`}>{tx.updatedBy || tx.addedBy || 'SYSTEM'}</div>
                          <div className={`font-mono text-[10px] ${tx.mistakeEdited ? 'text-red-500' : 'text-slate-500'}`}>{formatAuditDateTime(tx.updatedAt || tx.createdAt)}</div>
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
                                setMistakeTxId(tx.id);
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
                    <span className="font-bold text-blue-700">{displayNumber(ent)}</span>
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
            onClick={openPartyWise}
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
                            <td className="py-1.5 px-3 font-bold text-blue-700">{displayNumber(e)}</td>
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

      {/* Mistake confirmation popup (replaces the browser confirm/prompt dialogs) */}
      <MistakeActionModal
        txId={mistakeTxId}
        onCancel={() => setMistakeTxId(null)}
        onConfirm={(txId, remark) => {
          setMistakeTxId(null);
          handleAuditAction(txId, 'MISTAKE', remark);
        }}
      />

      {/* Jantri View (F3) popup — same grid, toggles and totals as the live page */}
      <JantriViewModal
        open={showJantriModal}
        onClose={() => setShowJantriModal(false)}
        selectedTx={selectedTx}
        list={list}
      />

      {/* Party Wise -> "Party Trans Count" popup (live): Search | Excel, then SR / PARTY /
          COUNT / TOTAL-AMT. Opens empty; Search (focused, Enter runs it) fills it. */}
      {showPartyWiseModal && (
        <div
          onMouseDown={(e) => { ptcBackdropDownRef.current = e.target === e.currentTarget; }}
          onClick={(e) => {
            if (ptcBackdropDownRef.current && e.target === e.currentTarget) setShowPartyWiseModal(false);
            ptcBackdropDownRef.current = false;
          }}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full overflow-hidden border border-slate-300 flex flex-col h-[80vh]">
            <div className="bg-[#24497e] text-white px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">Party Trans Count</h2>
              <button
                type="button"
                onClick={() => setShowPartyWiseModal(false)}
                className="text-white hover:text-slate-300 p-0.5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-3 py-2.5 flex items-center justify-between gap-2">
              <button
                id="ptc-search-btn"
                type="button"
                onClick={handlePartyTransCountSearch}
                disabled={ptcLoading}
                className="px-10 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs cursor-pointer outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#00897b] disabled:opacity-80 inline-flex items-center gap-1.5"
              >
                Search
                {ptcLoading && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
              </button>
              <button
                type="button"
                onClick={handlePartyTransCountExcel}
                className="px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs cursor-pointer"
              >
                Excel
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-1 pbmax-table-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0">
                  <tr className="bg-[#152847] text-white font-bold text-[11px] uppercase">
                    <th className="py-2.5 px-3 w-12 border-r border-[#223b63]">Sr</th>
                    <th className="py-2.5 px-3 w-96 border-r border-[#223b63]">Party</th>
                    <th className="py-2.5 px-3 w-24 text-center border-r border-[#223b63]">Count</th>
                    <th className="py-2.5 px-3 w-44 text-center border-r border-[#223b63]">Total-Amt</th>
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {ptcLoading ? (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-400">Loading...</td></tr>
                  ) : ptcRows === null ? null : ptcRows.length === 0 ? (
                    <tr><td colSpan={5} className="py-8 text-center text-slate-400">No transactions found.</td></tr>
                  ) : (
                    ptcRows.map((r, i) => (
                      <tr key={r.party} className="hover:bg-slate-50">
                        <td className="py-1.5 px-3 font-mono text-slate-500 border-r border-slate-100">{i + 1}</td>
                        <td className="py-1.5 px-3 font-bold text-slate-900 uppercase border-r border-slate-100">{r.party}</td>
                        <td className="py-1.5 px-3 text-center font-mono text-slate-700 border-r border-slate-100">{r.count}</td>
                        <td className="py-1.5 px-3 text-center font-mono font-bold text-slate-900 border-r border-slate-100">{Math.round(r.total)}</td>
                        <td />
                      </tr>
                    ))
                  )}
                </tbody>
                {ptcRows && ptcRows.length > 0 && (
                  <tfoot className="sticky bottom-0">
                    <tr className="bg-[#152847] text-white font-bold text-[11px]">
                      <td className="py-2 px-3 border-r border-[#223b63]">{ptcRows.length}</td>
                      <td className="py-2 px-3 border-r border-[#223b63]">PARTY</td>
                      <td className="py-2 px-3 text-center border-r border-[#223b63]">{ptcRows.reduce((t, r) => t + r.count, 0)}</td>
                      <td className="py-2 px-3 text-center border-r border-[#223b63]">{Math.round(ptcRows.reduce((t, r) => t + r.total, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
