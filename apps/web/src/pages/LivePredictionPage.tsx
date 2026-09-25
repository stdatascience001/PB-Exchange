import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto, UserSession, PredictionDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { ArrowLeft, ArrowUpDown } from 'lucide-react';

interface LivePredictionPageProps {
  shifts: ShiftDto[];
  user?: UserSession | null;
  onNavigate?: (page: string) => void;
  isDeclareMode?: boolean;
}

interface PartyGridData {
  grid: { number: string; totalAmount: number }[];
  haruf: { digit: string; andarAmount: number; baharAmount: number }[];
}

interface DeclarationHistoryItem {
  id: number;
  shiftId: number;
  winningNumber: string;
  declaredAt: string;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDateOnly = (dateVal?: string) => {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return dateVal;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}-${d.getFullYear()}`;
};

// "+ 0" normalises -0 (a rounded-down tiny negative) so it never renders as "-0".
const inr = (n: number) => (Math.round(n) + 0).toLocaleString('en-IN');

export const LivePredictionPage: React.FC<LivePredictionPageProps> = ({ shifts, onNavigate, isDeclareMode = false }) => {
  const availableShifts = useMemo(() => {
    // Only active shifts belong in this dropdown — a disabled shift (Shift Manage's
    // Enable/Disable tab) shouldn't still be selectable here. Any newly added shift (e.g.
    // "NEW SHIFT") therefore shows up here as soon as it is created and active, with no
    // per-shift special-casing anywhere on this page.
    const activeOnly = shifts.filter(s => s.isActive !== false);
    // Declare Prediction's Shift filter lists every ACTIVE shift (never a deactivated one, not
    // even as a fallback), like the live panel. Only declared data is ever shown: a shift/date
    // whose result isn't declared yet loads no slips and raises "Record not available!" —
    // that gating lives in fetchPrediction via the API's isCycleDeclared.
    if (isDeclareMode) return activeOnly;
    const base = activeOnly.length > 0 ? activeOnly : shifts;
    return base;
  }, [shifts, isDeclareMode]);

  // No shift auto-selected on load — matches the live reference's default "-- CHOOSE --" /
  // blank state; data only ever loads once the user actually picks a shift (the effect below
  // already guards on `if (shiftId)`, so leaving this empty just means nothing fires yet).
  const [shiftId, setShiftId] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>(todayIso);
  const [data, setData] = useState<PredictionDto | null>(null);
  const [focusNumber, setFocusNumber] = useState('');
  const [declareInput, setDeclareInput] = useState('');
  const [history, setHistory] = useState<DeclarationHistoryItem[]>([]);
  const [selectedParties, setSelectedParties] = useState<number[]>([]);
  // Clicking a party name opens that party's own collection grid for the same shift and date
  // — the live popup is titled with the party name and shows only their numbers, at RAW
  // amounts (DK ROHIT 50% -> cell 2 = 100, DK ROHIT 20% -> cell 3 = 100, Grand Total 100
  // each), not the net P&L the row beside it carries.
  // Same popup serves both entry points: a party row (titled with the party name) and an
  // Agent Groups row (titled "GROUP : <name>", covering every party in that group — the live
  // DK ROHIT SGR popup totals 200, i.e. both its parties' 100s added).
  const [gridPopupTitle, setGridPopupTitle] = useState<string | null>(null);
  const [partyGrid, setPartyGrid] = useState<PartyGridData | null>(null);
  const [partyGridLoading, setPartyGridLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedShift = shifts.find(s => String(s.id) === shiftId);

  const fetchPrediction = async (id: string, date: string, number?: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (number) qs.set('number', number);
      if (date) qs.set('date', date);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const res = await apiRequest<PredictionDto>(`/jantri/${id}/prediction${suffix}`);
      // Declare Prediction shows DECLARED cycles only: when the chosen date's result hasn't
      // been declared (e.g. the date was moved onto a still-open day), its slips are not shown —
      // the grid stays at zeros with no parties / agent groups, same as an empty declared day.
      const undeclaredCycle = isDeclareMode && res.data?.isCycleDeclared === false;
      if (res.data) {
        setData(undeclaredCycle
          ? {
              ...res.data,
              totalCollected: 0,
              netCollected: 0,
              numberPreview: res.data.numberPreview.map(n => ({ ...n, sale: 0, liability: 0, profitLoss: 0 })),
              parties: [],
              agentGroups: [],
            }
          : res.data);
      }
      // Declare Prediction: no record for that declared shift + date (no slips, or the date's
      // result isn't declared) gets the live panel's top-right "Error — Record not available!"
      // toast (the grid still shows its zeros). Only on a shift/date search, not on a number
      // click within results already loaded.
      if (isDeclareMode && !number && (!res.data || undeclaredCycle || (res.data.parties || []).length === 0)) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not available!</div>
          </div>,
          { toastId: 'declare-prediction-no-record' }
        );
      }
    } catch (err) {
      console.warn('Failed to load prediction data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (id: string) => {
    if (!id) return;
    try {
      const res = await apiRequest<DeclarationHistoryItem[]>(`/declarations/summary?shiftId=${id}`);
      if (res.data) setHistory(res.data.slice(0, 30));
    } catch (err) {
      console.warn('Failed to load declaration history:', err);
    }
  };

  // Picking a shift also snaps the Date filter to that shift's own live cycle date, the way
  // the live reference shows the selected shift's date rather than a stale calendar day.
  // Both state updates are batched, so the effect below still fires exactly once.
  const handleShiftChange = (nextId: string) => {
    const next = shifts.find(s => String(s.id) === nextId);
    setShiftId(nextId);
    setFocusNumber('');
    setSelectedParties([]);
    if (next?.openDate) setDateStr(next.openDate);
  };

  useEffect(() => {
    if (isDeclareMode) {
      // Declare Prediction (live flow): choosing a Shift / Date only sets the filter — data
      // loads when Search is pressed. Whatever was on screen belonged to the previous filter,
      // so it's cleared rather than left showing (and declarable) under the new shift.
      setSelectedParties([]);
      setData(null);
      setHistory([]);
      return;
    }
    if (shiftId) {
      // A different cycle means a different party list, so any ticked rows are stale.
      setSelectedParties([]);
      fetchPrediction(shiftId, dateStr, focusNumber || undefined);
      fetchHistory(shiftId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId, dateStr]);

  // Reuses the shared collection endpoint with its party filter, so the popup shows exactly
  // what the Collection page would for that one party — no second source of truth.
  const openGrid = async (title: string, partyIds: number[]) => {
    if (partyIds.length === 0) return;
    setGridPopupTitle(title);
    setPartyGrid(null);
    setPartyGridLoading(true);
    try {
      const qs = new URLSearchParams({ shiftId, date: dateStr });
      for (const id of partyIds) qs.append('partyIds', String(id));
      const res = await apiRequest<PartyGridData>(`/transactions/collection?${qs.toString()}`);
      if (res.data) setPartyGrid(res.data);
    } catch (err) {
      console.warn('Failed to load grid:', err);
    } finally {
      setPartyGridLoading(false);
    }
  };

  const closePartyGrid = () => {
    setGridPopupTitle(null);
    setPartyGrid(null);
  };

  // Cells are keyed 1-100 on screen; the API returns "00".."99", with "00" sitting in the
  // last cell — same mapping the Collection page uses.
  const partyCell = (num: number) => {
    const key = num === 100 ? '00' : String(num).padStart(2, '0');
    return partyGrid?.grid.find(g => g.number === key)?.totalAmount || 0;
  };
  const partyHaruf = (digit: number, type: 'andar' | 'bahar') => {
    const cell = partyGrid?.haruf.find(h => h.digit === String(digit));
    return (type === 'andar' ? cell?.andarAmount : cell?.baharAmount) || 0;
  };
  const partyRowTotal = (r: number) => {
    let sum = 0;
    for (let c = 1; c <= 10; c++) sum += partyCell(r * 10 + c);
    return sum;
  };
  const partyColTotal = (c: number) => {
    let sum = 0;
    for (let r = 0; r < 10; r++) sum += partyCell(r * 10 + c);
    return sum;
  };
  const partyDaraTotal = (partyGrid?.grid || []).reduce((s, g) => s + g.totalAmount, 0);
  const partyBaharTotal = (partyGrid?.haruf || []).reduce((s, h) => s + h.baharAmount, 0);
  const partyAndarTotal = (partyGrid?.haruf || []).reduce((s, h) => s + h.andarAmount, 0);
  const partyGrandTotal = partyDaraTotal + partyBaharTotal + partyAndarTotal;

  const reload = () => fetchPrediction(shiftId, dateStr, focusNumber || undefined);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    reload();
    // Declare Prediction loads everything on Search, including the declared-results history
    // (Result 30 Days / declare panel) that Live Prediction loads on shift change.
    if (isDeclareMode) fetchHistory(shiftId);
  };

  // Clicking a number in the left panel focuses it immediately (matching the live reference —
  // no need to also press Search), which re-fetches the party-wise P&L panel for "if this
  // number wins" while the number grid itself (already fully loaded) updates instantly.
  const handleNumberClick = (num: string) => {
    setFocusNumber(num);
    fetchPrediction(shiftId, dateStr, num);
  };

  const focusPadded = (focusNumber || '').padStart(2, '0');
  const focusPreview = focusNumber ? data?.numberPreview.find(n => n.number === focusPadded) : undefined;

  // Both the "Amt" (numbers grid) and "P & L" (party list) columns are click-to-sort in the
  // live reference (the small icon next to each header) — Amt defaults to descending (highest
  // profit first), P & L defaults to ascending (worst P&L first), matching evidenced screenshots.
  const [amtSortDir, setAmtSortDir] = useState<'asc' | 'desc'>('desc');
  const [pnlSortDir, setPnlSortDir] = useState<'asc' | 'desc'>('asc');

  // Left panel is the full 00-99 grid sorted by Amt (profit if that number wins) — not a
  // declaration-history list — matching the live reference exactly. Ties (every number nobody
  // has staked shares the same Amt) fall back to ascending number order so the grid reads
  // predictably instead of shuffling between refreshes.
  const sortedNumbers = useMemo(() => {
    const list = [...(data?.numberPreview || [])];
    list.sort((a, b) => {
      const diff = amtSortDir === 'desc' ? b.profitLoss - a.profitLoss : a.profitLoss - b.profitLoss;
      return diff !== 0 ? diff : a.number.localeCompare(b.number);
    });
    return list;
  }, [data, amtSortDir]);

  const sortedParties = useMemo(() => {
    const list = [...(data?.parties || [])];
    list.sort((a, b) => pnlSortDir === 'desc' ? b.pnl - a.pnl : a.pnl - b.pnl);
    return list;
  }, [data, pnlSortDir]);

  // "Result 30 Days" badge = how many times this number was the actual declared winner within
  // the recent history window already fetched for the right-side declaration list.
  const winCountByNumber = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of history) {
      const padded = h.winningNumber.padStart(2, '0');
      map.set(padded, (map.get(padded) || 0) + 1);
    }
    return map;
  }, [history]);

  const allPartiesSelected = sortedParties.length > 0 && selectedParties.length === sortedParties.length;

  const toggleParty = (partyId: number) => {
    setSelectedParties(prev => prev.includes(partyId) ? prev.filter(id => id !== partyId) : [...prev, partyId]);
  };

  const toggleAllParties = () => {
    setSelectedParties(allPartiesSelected ? [] : sortedParties.map(p => p.partyId));
  };

  const validateNumber = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!/^\d{1,2}$/.test(trimmed)) return null;
    const padded = trimmed.padStart(2, '0');
    return parseInt(padded, 10) >= 0 && parseInt(padded, 10) <= 99 ? padded : null;
  };

  const declareNumber = async (raw: string) => {
    const padded = validateNumber(raw);
    if (!padded) {
      alert('Enter a valid winning number between 00 and 99.');
      return false;
    }
    await apiRequest(`/declarations/${shiftId}`, {
      method: 'POST',
      body: JSON.stringify({ winningNumber: padded }),
    });
    return true;
  };

  const handleDeclare = async () => {
    if (!shiftId) {
      alert('Choose a shift first.');
      return;
    }
    if (!declareInput.trim()) return;
    if (!window.confirm(`Declare winning number "${declareInput}" for ${selectedShift?.name}?`)) return;
    try {
      if (!(await declareNumber(declareInput))) return;
      alert('Result declared successfully.');
      setDeclareInput('');
      fetchHistory(shiftId);
      reload();
    } catch (err: any) {
      alert(err.message || 'Failed to declare result');
    }
  };

  // ReDeclare = reverse this declaration, then declare the corrected number in its place.
  // Only offered for the shift's CURRENT cycle: declaring writes the live shift row, so
  // re-declaring an older, already-rolled-over cycle would overwrite today's live state.
  const handleReDeclare = async (row: DeclarationHistoryItem) => {
    const entered = window.prompt(`Re-declare result for ${selectedShift?.name}. Enter the corrected number:`, row.winningNumber);
    if (entered === null) return;
    const padded = validateNumber(entered);
    if (!padded) {
      alert('Enter a valid winning number between 00 and 99.');
      return;
    }
    if (!window.confirm(`Replace declared number ${row.winningNumber} with ${padded}?`)) return;
    try {
      await apiRequest(`/declarations/${shiftId}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ declarationId: row.id }),
      });
      await declareNumber(padded);
      alert('Result re-declared successfully.');
      fetchHistory(shiftId);
      reload();
    } catch (err: any) {
      alert(err.message || 'Failed to re-declare result');
    }
  };

  const handleUnDeclare = async (declarationId: number) => {
    if (!window.confirm('Undo this declaration?')) return;
    try {
      await apiRequest(`/declarations/${shiftId}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ declarationId }),
      });
      fetchHistory(shiftId);
      reload();
    } catch (err: any) {
      alert(err.message || 'Failed to reverse declaration');
    }
  };

  const isCurrentCycleRow = (row: DeclarationHistoryItem) => {
    if (!selectedShift) return false;
    return row.declaredAt.slice(0, 10) === selectedShift.openDate;
  };

  const headRow = 'bg-[#152847] text-white font-bold text-[10px]';

  // The page root is height-bounded to the viewport (same h/max-h/min-h + overflow-hidden
  // pattern already used by Transaction List / Transaction Audit) so the panels inside can
  // actually scroll — without that bound, `flex-1 overflow-y-auto` never clips and the whole
  // document stretches into one long list instead. Every flex ancestor of a scroll area also
  // needs min-h-0, otherwise its default min-height:auto lets it grow past the bound again.
  return (
    <div className="h-[calc(100vh-82px)] max-h-[calc(100vh-82px)] min-h-[520px] bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs overflow-hidden">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1 min-h-0">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => onNavigate && onNavigate('dashboard')}
            className="p-1 text-slate-800 hover:bg-slate-100 rounded transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">
            {isDeclareMode ? 'Declare Prediction' : 'Live Prediction'}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Shift</span>
            <select
              value={shiftId}
              onChange={(e) => handleShiftChange(e.target.value)}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
            >
              <option value="">-- CHOOSE --</option>
              {availableShifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Date</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-700 tracking-wider focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
            />
          </div>
          <button type="submit" className="px-4 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors">
            Search
          </button>
        </form>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* 1. NUMBERS — Result 30 Days / Number / Sale / Amt */}
          <div className="w-64 flex-shrink-0 flex flex-col min-h-0 border-r border-slate-300 overflow-hidden">
            {/* Header lives inside the scroller as a sticky thead (same approach as the party
                table below) so the scrollbar's gutter can't push the body columns out of
                alignment with a separately-rendered header table. */}
            <div className="flex-1 min-h-0 overflow-y-scroll pbmax-table-scrollbar">
              <table className="w-full text-left text-xs border-collapse table-fixed">
                <colgroup><col className="w-14" /><col /><col /><col /></colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className={headRow}>
                    <th className="py-2 px-2 border-r border-[#223b63] text-center">Result<br />30 Days</th>
                    <th className="py-2 px-2 border-r border-[#223b63] text-center">Number</th>
                    <th className="py-2 px-2 border-r border-[#223b63] text-right">Sale</th>
                    <th
                      className="py-2 px-2 text-right cursor-pointer select-none hover:bg-[#1c3a63]"
                      onClick={() => setAmtSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                      title="Click to toggle sort order"
                    >
                      <span className="inline-flex items-center gap-1">
                        Amt <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedNumbers.map(n => {
                    const winCount = winCountByNumber.get(n.number) || 0;
                    const isFocused = !!focusNumber && focusPadded === n.number;
                    return (
                      <tr
                        key={n.number}
                        onClick={() => handleNumberClick(n.number)}
                        className={`cursor-pointer hover:bg-amber-50 ${isFocused ? 'bg-amber-100' : ''}`}
                      >
                        <td className="py-1.5 px-2 text-center border-r border-slate-200">
                          {winCount > 0 ? (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-emerald-500 text-white text-[10px] font-bold">
                              {winCount}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono font-bold text-slate-800 border-r border-slate-200">{n.number}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-slate-700 border-r border-slate-200">{inr(n.sale)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono ${n.profitLoss < 0 ? 'text-rose-700 font-bold' : 'text-slate-700'}`}>
                          {inr(n.profitLoss)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. PARTIES — Sr / select / Party / Sale / P&L / Last-Win */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden border-r border-slate-300">
            <div className="flex-1 min-h-0 overflow-y-auto pbmax-table-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className={`${headRow} text-[11px]`}>
                    <th className="py-2 px-2 border-r border-[#223b63] w-10 text-center">Sr</th>
                    <th className="py-2 px-2 border-r border-[#223b63] w-8 text-center">
                      <input
                        type="checkbox"
                        checked={allPartiesSelected}
                        onChange={toggleAllParties}
                        className="cursor-pointer align-middle"
                        title="Select all parties"
                      />
                    </th>
                    <th className="py-2 px-2 border-r border-[#223b63]">Party</th>
                    <th className="py-2 px-2 border-r border-[#223b63] text-right w-24">Sale</th>
                    <th
                      className="py-2 px-2 text-right w-24 border-r border-[#223b63] cursor-pointer select-none hover:bg-[#1c3a63]"
                      onClick={() => setPnlSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                      title="Click to toggle sort order"
                    >
                      <span className="inline-flex items-center gap-1">
                        P&amp;L <ArrowUpDown className="w-3 h-3" />
                      </span>
                    </th>
                    <th className="py-2 px-2 text-center w-20">Last-Win</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={6} className="py-8 text-center text-slate-400">Loading...</td></tr>
                  ) : !data || sortedParties.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-slate-400">No active parties this cycle.</td></tr>
                  ) : (
                    sortedParties.map((p, idx) => (
                      <tr key={p.partyId} className={`hover:bg-slate-50 ${selectedParties.includes(p.partyId) ? 'bg-amber-50' : ''}`}>
                        <td className="py-1.5 px-2 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}.</td>
                        <td className="py-1.5 px-2 text-center border-r border-slate-200">
                          <input
                            type="checkbox"
                            checked={selectedParties.includes(p.partyId)}
                            onChange={() => toggleParty(p.partyId)}
                            className="cursor-pointer align-middle"
                          />
                        </td>
                        <td className="py-1.5 px-2 border-r border-slate-200">
                          <button
                            type="button"
                            onClick={() => openGrid(p.partyName, [p.partyId])}
                            title="Show this party's numbers"
                            className="font-bold text-slate-900 uppercase hover:text-[#1662c6] hover:underline cursor-pointer text-left"
                          >
                            {p.partyName}
                          </button>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-slate-800 border-r border-slate-200">{inr(p.sale)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono font-bold border-r border-slate-200 ${p.pnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {inr(p.pnl)}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {p.lastWin > 0 ? (
                            <span className="inline-flex items-center justify-center min-w-5 px-1.5 h-5 rounded bg-[#dc2626] text-white text-[10px] font-bold">
                              {p.lastWin}
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-[#152847] text-white text-xs font-bold py-2 px-3 flex items-center justify-between">
              <span>
                Number: {focusNumber ? focusPadded : '-'} | Profit: {inr(focusPreview ? focusPreview.profitLoss : (data?.netCollected ?? 0))}
              </span>
              <button
                type="button"
                onClick={() => onNavigate && onNavigate('jantri')}
                className="px-3 py-1 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-[10px] rounded shadow-xs"
              >
                Jantri
              </button>
            </div>
          </div>

          {/* 3. AGENT GROUPS */}
          <div className="w-52 flex-shrink-0 flex flex-col min-h-0 border-r border-slate-300 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto pbmax-table-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className={`${headRow} text-[11px]`}>
                    <th className="py-2 px-2 text-center" colSpan={2}>Agent Groups</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.agentGroups || []).map(a => (
                    <tr
                      key={a.agentName}
                      onClick={() => openGrid(`GROUP : ${a.agentName}`, a.partyIds || [])}
                      title="Show this group's numbers"
                      className="cursor-pointer hover:bg-amber-50"
                    >
                      <td className="py-1.5 px-2 font-bold text-slate-900 uppercase text-[11px]">{a.agentName}</td>
                      <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-700 text-[11px]">{inr(a.sale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 4. DECLARE + 30-day result history — Live Prediction only. The live Declare
              Prediction page has no Number / Declare / ReDeclare / UnDeclare panel; it only
              shows the declared shift's data, so the panel is left out in declare mode. */}
          {!isDeclareMode && (
          <div className="w-72 flex-shrink-0 flex flex-col min-h-0 overflow-hidden">
            <div className="bg-[#152847] flex items-stretch">
              <span className="text-white font-bold text-[11px] py-2 px-2 flex items-center">Number</span>
              <input
                type="text"
                maxLength={2}
                value={declareInput}
                onChange={(e) => setDeclareInput(e.target.value.replace(/\D/g, ''))}
                className="flex-1 min-w-0 my-1 mx-1 px-2 bg-white border border-slate-300 rounded text-xs font-bold text-center"
              />
              <button
                type="button"
                onClick={handleDeclare}
                className="px-4 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs"
              >
                Declare
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-scroll pbmax-table-scrollbar">
              <table className="w-full text-left text-xs border-collapse table-fixed">
                <colgroup><col /><col className="w-24" /><col className="w-24" /></colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#1e3a63] text-white font-bold text-[10px]">
                    <th className="py-1.5 px-2 border-r border-[#2b4c7e]">Result</th>
                    <th className="py-1.5 px-2 border-r border-[#2b4c7e] text-center">Action</th>
                    <th className="py-1.5 px-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.length === 0 ? (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400">No results declared yet.</td></tr>
                  ) : history.map(h => (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="py-1.5 px-2 border-r border-slate-200 text-center">
                        <div className="font-mono font-bold text-slate-900">{h.winningNumber}</div>
                        <div className="text-[10px] text-slate-500">{formatDateOnly(h.declaredAt)}</div>
                      </td>
                      <td className="py-1.5 px-1 text-center border-r border-slate-200">
                        <button
                          type="button"
                          disabled={!isCurrentCycleRow(h)}
                          onClick={() => handleReDeclare(h)}
                          title={!isCurrentCycleRow(h) ? 'ReDeclare only supported for the current cycle' : 'Reverse and re-declare this result'}
                          className="px-2 py-0.5 bg-[#1662c6] hover:bg-[#1354ab] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold rounded"
                        >
                          ReDeclare
                        </button>
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <button
                          type="button"
                          onClick={() => handleUnDeclare(h.id)}
                          className="px-2 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[10px] font-bold rounded"
                        >
                          UnDeclare
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Party grid popup — that one party's numbers for this shift and date */}
      {gridPopupTitle && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150"
          onClick={closePartyGrid}
        >
          <div
            className="bg-white rounded-xs shadow-2xl w-full max-w-5xl border border-slate-300 max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#24497e] text-white px-4 py-2.5 flex items-center justify-between rounded-t-xs flex-shrink-0">
              <h3 className="text-sm font-bold tracking-wide uppercase">{gridPopupTitle}</h3>
              <button
                type="button"
                onClick={closePartyGrid}
                className="text-white/80 hover:text-white p-0.5 cursor-pointer text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-2 overflow-auto pbmax-table-scrollbar">
              {partyGridLoading ? (
                <div className="py-16 text-center text-slate-400 text-xs">Loading...</div>
              ) : (
                <table className="w-full border-collapse table-fixed text-xs">
                  <thead>
                    <tr className="bg-[#152847] text-white">
                      {Array.from({ length: 10 }, (_, i) => (
                        <th key={i + 1} className="py-1.5 text-center font-bold border border-[#2b446f] w-[9.09%]">{i + 1}</th>
                      ))}
                      <th className="py-1.5 text-center font-bold border border-[#2b446f] w-[9.09%]">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 10 }, (_, r) => (
                      <tr key={r}>
                        {Array.from({ length: 10 }, (_, c) => {
                          const num = r * 10 + (c + 1);
                          const amt = partyCell(num);
                          return (
                            <td key={num} className="relative h-8 bg-white border border-slate-300 text-right px-1 align-middle">
                              <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                                {num}
                              </span>
                              {amt > 0 ? <span className="block w-full font-bold text-slate-900">{inr(amt)}</span> : null}
                            </td>
                          );
                        })}
                        <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 font-mono">
                          {inr(partyRowTotal(r))}
                        </td>
                      </tr>
                    ))}

                    <tr className="bg-[#152847] text-white font-bold font-mono text-center">
                      {Array.from({ length: 10 }, (_, c) => (
                        <td key={c + 1} className="py-1.5 border border-[#2b446f]">{inr(partyColTotal(c + 1))}</td>
                      ))}
                      <td className="py-1.5 border border-[#2b446f]">{inr(partyDaraTotal)}</td>
                    </tr>

                    {/* Bahar Haruf (B1 - B0) */}
                    <tr>
                      {Array.from({ length: 10 }, (_, c) => {
                        const digit = c + 1 === 10 ? 0 : c + 1;
                        const amt = partyHaruf(digit, 'bahar');
                        return (
                          <td key={`b${digit}`} className="relative h-8 bg-white border border-slate-300 text-right px-1 align-middle">
                            <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                              B{digit}
                            </span>
                            {amt > 0 ? <span className="font-bold text-slate-900">{inr(amt)}</span> : null}
                          </td>
                        );
                      })}
                      <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 font-mono">
                        {inr(partyBaharTotal)}
                      </td>
                    </tr>

                    {/* Andar Haruf (A1 - A0) */}
                    <tr>
                      {Array.from({ length: 10 }, (_, c) => {
                        const digit = c + 1 === 10 ? 0 : c + 1;
                        const amt = partyHaruf(digit, 'andar');
                        return (
                          <td key={`a${digit}`} className="relative h-8 bg-white border border-slate-300 text-right px-1 align-middle">
                            <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                              A{digit}
                            </span>
                            {amt > 0 ? <span className="font-bold text-slate-900">{inr(amt)}</span> : null}
                          </td>
                        );
                      })}
                      <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 font-mono">
                        {inr(partyAndarTotal)}
                      </td>
                    </tr>

                    <tr className="bg-[#152847] text-white font-bold">
                      {Array.from({ length: 9 }, (_, i) => (
                        <td key={i} className="py-1.5 text-center border border-[#2b446f]">-</td>
                      ))}
                      <td className="py-1.5 text-center border border-[#2b446f] whitespace-nowrap">Grand Total</td>
                      <td className="py-1.5 text-center border border-[#2b446f] font-mono">{inr(partyGrandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-2.5 bg-[#152847] rounded-md px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <span className="text-[#fde047] font-bold text-xs cursor-pointer hover:underline">Need Help?</span>
        <span className="text-white text-xs font-mono">[ shift + esc = Exit ]</span>
      </div>
    </div>
  );
};
