import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto, LedgerDto } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { DateDMYInput } from '../components/DateDMYInput.js';

// Live Enter order across the filter bar: Shift -> DD -> MM -> YYYY -> Commission -> Hissa ->
// Dibba -> Akh-Mix -> Amt-Less -> Less-% -> Submit (whose own Enter runs it).
const focusById = (id: string) => {
  const el = document.getElementById(id) as HTMLInputElement | null;
  el?.focus();
  if (el && typeof el.select === 'function' && el.type !== 'checkbox') el.select();
};
const enterTo = (id: string) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    focusById(id);
  }
};

interface CollectionPageProps {
  shifts: ShiftDto[];
  activeShift: ShiftDto | null;
  declareModeOnly?: boolean;
}

export const CollectionPage: React.FC<CollectionPageProps> = ({ shifts, activeShift, declareModeOnly = false }) => {
  const availableShifts = useMemo(() => {
    // Only active shifts belong in this dropdown — a disabled shift (Shift Manage's
    // Enable/Disable tab) shouldn't still be selectable here.
    const activeOnly = shifts.filter(s => s.isActive !== false);
    const base = activeOnly.length > 0 ? activeOnly : shifts;
    if (!declareModeOnly) return base;
    const declared = base.filter(s => !!s.declaredNumber || s.status === 'DECLARED' || s.status === 'AUDITED');
    return declared.length > 0 ? declared : base;
  }, [shifts, declareModeOnly]);

  const [shiftId, setShiftId] = useState<number | ''>(activeShift?.id || availableShifts[0]?.id || '');
  const [dateStr, setDateStr] = useState<string>(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [parties, setParties] = useState<LedgerDto[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [addedParties, setAddedParties] = useState<LedgerDto[]>([]);
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  // Submitting with no parties queued loads this shift's real, already-collected totals
  // (read-only) instead of the manual entry grid — matches the live "Collection" report.
  const [isCollectionView, setIsCollectionView] = useState(false);
  const [harufData, setHarufData] = useState<{ digit: string; andarAmount: number; baharAmount: number }[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  // Report filters, all applied server-side on Submit against each party's own ledger config:
  // Commission takes each party's commission % off, Hissa each of its Hissa Party rows (one
  // after the other; live: 1000 -> 900 / 800 / 750 with both), cells then shown in whole 50s
  // rounded up; Akh-Mix spreads each Andar / Bahar over its ten numbers (a tenth each, B / A
  // rows then 0), Dibba leaves the figures as they are, and
  // Amt-Less / Less-% take a flat then a percentage off each cell.
  // Confirmed against the live page: the book reads 200 untouched and with Commission on
  // (both parties sit at 0% commission), and drops to 150 once Hissa is ticked — the 100 on
  // number 2 halving for the 50%-hissa party while the other party's 100 stays put.
  const [commission, setCommission] = useState(false);
  const [hissa, setHissa] = useState(false);
  const [dibba, setDibba] = useState(false);
  const [akhMix, setAkhMix] = useState(false);
  const [amtLess, setAmtLess] = useState('');
  const [lessPercent, setLessPercent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchParties = async () => {
    try {
      const res = await apiRequest<LedgerDto[]>('/ledgers');
      if (res.data) setParties(res.data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchParties();
  }, []);

  const filteredPartyOptions = useMemo(() => {
    if (!partySearch.trim()) return [];
    const term = partySearch.trim().toLowerCase();
    return parties.filter(p => p.partyName.toLowerCase().includes(term) && !addedParties.some(a => a.id === p.id));
  }, [parties, partySearch, addedParties]);

  const handleAddParty = (p?: LedgerDto) => {
    const target = p || parties.find(x => x.partyName.toLowerCase() === partySearch.trim().toLowerCase());
    if (!target || addedParties.some(a => a.id === target.id)) return;
    // The loaded report is deliberately left on screen: on the live page the grid keeps
    // showing the current figures after ADD, and only narrows to the listed parties once
    // Submit is pressed. Manual amounts are still safe from being confused with it — the
    // submit handler below only writes when the grid was typed into by hand.
    setAddedParties(prev => [...prev, target]);
    setPartySearch('');
  };

  const handleClearList = () => {
    setAddedParties([]);
    setAmounts({});
    setIsCollectionView(false);
    setHarufData([]);
  };

  const handleAmountChange = (num: number, val: string) => {
    setAmounts(prev => ({ ...prev, [num]: val }));
  };

  // Switching shifts invalidates any loaded read-only view data for the previous shift.
  useEffect(() => {
    if (isCollectionView) {
      setIsCollectionView(false);
      setHarufData([]);
      setAmounts({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId]);

  const adjustedAmount = (raw: number) => {
    // In Collection View mode the backend already applied Amt-Less/Less-% (alongside
    // Commission/Hissa/Dibba/Akh-Mix, per each party's real ledger config) when this data was
    // fetched on Submit — applying it again here on the client would double-deduct it.
    if (isCollectionView) return raw;
    let amt = raw;
    const flatLess = parseFloat(amtLess);
    if (!isNaN(flatLess) && flatLess > 0) amt = Math.max(0, amt - flatLess);
    const pctLess = parseFloat(lessPercent);
    if (!isNaN(pctLess) && pctLess > 0) amt = amt * (1 - pctLess / 100);
    return amt;
  };

  const gridTotal = useMemo(() => {
    let sum = 0;
    for (let i = 1; i <= 100; i++) {
      const raw = parseFloat(amounts[i] || '0');
      if (raw > 0) sum += adjustedAmount(raw);
    }
    return sum;
  }, [amounts, amtLess, lessPercent]);

  const getRowTotal = (r: number) => {
    let sum = 0;
    for (let c = 1; c <= 10; c++) {
      const raw = parseFloat(amounts[r * 10 + c] || '0');
      if (raw > 0) sum += adjustedAmount(raw);
    }
    return sum;
  };

  const getColTotal = (col: number) => {
    let sum = 0;
    for (let r = 0; r < 10; r++) {
      const raw = parseFloat(amounts[r * 10 + col] || '0');
      if (raw > 0) sum += adjustedAmount(raw);
    }
    return sum;
  };

  const getHarufAmount = (digit: number, type: 'andar' | 'bahar') => {
    const dStr = String(digit % 10);
    const cell = harufData.find(h => h.digit === dStr);
    const raw = (type === 'andar' ? cell?.andarAmount : cell?.baharAmount) || 0;
    return raw > 0 ? adjustedAmount(raw) : 0;
  };

  const baharTotal = useMemo(
    () => harufData.reduce((sum, h) => sum + (h.baharAmount > 0 ? adjustedAmount(h.baharAmount) : 0), 0),
    [harufData, amtLess, lessPercent]
  );
  const andarTotal = useMemo(
    () => harufData.reduce((sum, h) => sum + (h.andarAmount > 0 ? adjustedAmount(h.andarAmount) : 0), 0),
    [harufData, amtLess, lessPercent]
  );
  const finalGrandTotal = gridTotal + baharTotal + andarTotal;

  // Submitting with no parties queued for manual entry loads this shift's real collection
  // totals (read-only) — per-party, so the Commission/Hissa/Dibba/Akh-Mix toggles apply each
  // party's own ledger-configured rates — matching the live "Collection" report instead of
  // erroring for a missing party.
  const handleLoadCollectionView = async () => {
    if (!shiftId) return;
    setViewLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('shiftId', String(shiftId));
      params.append('date', dateStr);
      if (commission) params.append('commission', 'true');
      if (hissa) params.append('hissa', 'true');
      if (dibba) params.append('dibba', 'true');
      if (akhMix) params.append('akhMix', 'true');
      if (amtLess.trim() && parseFloat(amtLess) > 0) params.append('amtLess', amtLess.trim());
      if (lessPercent.trim() && parseFloat(lessPercent) > 0) params.append('lessPercent', lessPercent.trim());
      // Parties queued in the left-hand list narrow the report to just those parties; an
      // empty list leaves it covering the whole book.
      for (const p of addedParties) params.append('partyIds', String(p.id));
      const res = await apiRequest<{
        grid: { number: string; totalAmount: number }[];
        haruf: { digit: string; andarAmount: number; baharAmount: number }[];
      }>(`/transactions/collection?${params.toString()}`);
      if (res.data) {
        const newAmounts: Record<number, string> = {};
        res.data.grid.forEach(g => {
          if (g.totalAmount > 0) {
            const num = g.number === '00' ? 100 : parseInt(g.number, 10);
            newAmounts[num] = String(g.totalAmount);
          }
        });
        setAmounts(newAmounts);
        setHarufData(res.data.haruf || []);
        setIsCollectionView(true);
        // As on live: once the report draws, the cursor lands on number 1's cell
        setTimeout(() => focusById('coll-cell-1'), 0);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to load collection data');
    } finally {
      setViewLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!shiftId) {
      alert('Please select a shift.');
      return;
    }
    // Submit shows data. It only writes when the operator actually typed amounts into the
    // grid for the queued parties — a loaded report (isCollectionView) or an untouched grid
    // means they are filtering, which is what the live page does: add a party, press Submit,
    // and the same report redraws scoped to that party.
    const hasManualAmounts = !isCollectionView && Object.values(amounts).some(v => parseFloat(v) > 0);
    if (addedParties.length === 0 || !hasManualAmounts) {
      await handleLoadCollectionView();
      return;
    }

    const entries = [];
    for (let i = 1; i <= 100; i++) {
      const raw = parseFloat(amounts[i] || '0');
      if (raw > 0) {
        const n = i < 100 ? String(i).padStart(2, '0') : '00';
        entries.push({ entryType: 'DARA' as const, numberValue: n, amount: adjustedAmount(raw) });
      }
    }
    if (entries.length === 0) {
      alert('Please enter at least one amount in the grid.');
      return;
    }

    setSubmitting(true);
    try {
      for (const party of addedParties) {
        await apiRequest('/transactions', {
          method: 'POST',
          body: JSON.stringify({ shiftId, partyId: party.id, entries }),
        });
      }
      alert(`Collection submitted for ${addedParties.length} part${addedParties.length > 1 ? 'ies' : 'y'}.`);
      handleClearList();
    } catch (err: any) {
      alert(err.message || 'Failed to submit collection');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <div className="p-2 sm:p-2.5 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">
            {declareModeOnly ? 'Declare Collection' : 'Collection'}
          </span>

          <select
            id="coll-shift"
            autoFocus
            value={shiftId}
            onChange={(e) => setShiftId(parseInt(e.target.value, 10))}
            onKeyDown={enterTo('coll-date-dd')}
            className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
          >
            {availableShifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* DD-MM-YYYY; Enter steps DD -> MM -> YYYY -> Commission. Still sends YYYY-MM-DD. */}
          <DateDMYInput
            value={dateStr}
            onChange={setDateStr}
            idPrefix="coll-date"
            separator="-"
            onEnterFromYear={() => focusById('coll-commission')}
          />

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input id="coll-commission" type="checkbox" checked={commission} onChange={(e) => setCommission(e.target.checked)} onKeyDown={enterTo('coll-hissa')} className="focus:ring-2 focus:ring-amber-400" />
            <span className="text-slate-600 font-medium">Commission</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input id="coll-hissa" type="checkbox" checked={hissa} onChange={(e) => setHissa(e.target.checked)} onKeyDown={enterTo('coll-dibba')} className="focus:ring-2 focus:ring-amber-400" />
            <span className="text-slate-600 font-medium">Hissa</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input id="coll-dibba" type="checkbox" checked={dibba} onChange={(e) => setDibba(e.target.checked)} onKeyDown={enterTo('coll-akhmix')} className="focus:ring-2 focus:ring-amber-400" />
            <span className="text-slate-600 font-medium">Dibba</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input id="coll-akhmix" type="checkbox" checked={akhMix} onChange={(e) => setAkhMix(e.target.checked)} onKeyDown={enterTo('coll-amtless')} className="focus:ring-2 focus:ring-amber-400" />
            <span className="text-slate-600 font-medium">Akh-Mix</span>
          </label>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Amt-Less</span>
            <input id="coll-amtless" type="number" value={amtLess} onChange={(e) => setAmtLess(e.target.value)} onKeyDown={enterTo('coll-lesspct')} className="w-20 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:bg-[#fde68a]" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Less-%</span>
            <input id="coll-lesspct" type="number" value={lessPercent} onChange={(e) => setLessPercent(e.target.value)} onKeyDown={enterTo('coll-submit')} className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:bg-[#fde68a]" />
          </div>

          <button
            id="coll-submit"
            type="button"
            onClick={handleSubmit}
            disabled={submitting || viewLoading}
            className="ml-auto px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {submitting ? 'Submitting...' : viewLoading ? 'Loading...' : 'Submit'}
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 flex flex-col border-r border-slate-300 p-2 gap-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={partySearch}
                  onChange={(e) => setPartySearch(e.target.value)}
                  placeholder="PARTY NAME"
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs uppercase focus:outline-none focus:border-blue-500"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddParty(); } }}
                />
                {filteredPartyOptions.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-300 shadow-xl rounded z-50 max-h-40 overflow-y-auto">
                    {filteredPartyOptions.slice(0, 8).map(p => (
                      <div
                        key={p.id}
                        onMouseDown={() => handleAddParty(p)}
                        className="px-3 py-1.5 text-xs uppercase cursor-pointer hover:bg-amber-50 font-semibold text-slate-800"
                      >
                        {p.partyName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleAddParty()}
                className="px-3 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold text-xs rounded shadow-xs"
              >
                ADD
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded">
              {addedParties.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">No parties added yet.</div>
              ) : (
                addedParties.map(p => (
                  <div key={p.id} className="px-3 py-1.5 text-xs font-bold uppercase text-slate-800 flex items-center justify-between">
                    <span>{p.partyName}</span>
                    <button
                      type="button"
                      onClick={() => setAddedParties(prev => prev.filter(a => a.id !== p.id))}
                      className="text-rose-500 hover:text-rose-700 font-bold"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={handleClearList}
              className="w-full py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-xs rounded shadow-xs"
            >
              Clear Ledgers list
            </button>
          </div>

          <div className="flex-1 overflow-auto p-2">
            <table className="w-full border-collapse text-xs font-mono select-none table-fixed">
              <thead className="bg-[#152847] text-white">
                <tr>
                  {Array.from({ length: 10 }, (_, i) => (
                    <th key={i + 1} className="py-1.5 sm:py-2 text-center text-xs font-bold border border-[#2b446f] w-[9.09%]">{i + 1}</th>
                  ))}
                  <th className="py-1.5 sm:py-2 text-center text-xs font-bold border border-[#2b446f] w-[9.09%]">Total</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }, (_, r) => (
                  <tr key={r}>
                    {Array.from({ length: 10 }, (_, c) => {
                      const num = r * 10 + (c + 1);
                      return (
                        <td key={num} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 align-middle">
                          <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                            {num}
                          </span>
                          {isCollectionView ? (
                            <span
                              id={`coll-cell-${num}`}
                              tabIndex={0}
                              className="block w-full font-bold text-slate-900 outline-none focus:bg-[#fde68a] rounded-xs"
                            >
                              {amounts[num] ? adjustedAmount(parseFloat(amounts[num])).toLocaleString('en-IN') : ''}
                            </span>
                          ) : (
                            <input
                              id={`coll-cell-${num}`}
                              type="number"
                              value={amounts[num] || ''}
                              onChange={(e) => handleAmountChange(num, e.target.value)}
                              className="w-full h-full text-right bg-transparent outline-none font-bold text-slate-900"
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 font-mono">
                      {getRowTotal(r).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#152847] text-white font-bold font-mono text-center">
                  {Array.from({ length: 10 }, (_, c) => (
                    <td key={c + 1} className="py-1.5 sm:py-2 border border-[#2b446f]">{getColTotal(c + 1).toLocaleString('en-IN')}</td>
                  ))}
                  <td className="py-1.5 sm:py-2 border border-[#2b446f]">{gridTotal.toLocaleString('en-IN')}</td>
                </tr>

                {/* Bahar Haruf (B1 - B0) */}
                <tr>
                  {Array.from({ length: 10 }, (_, c) => {
                    const digit = c + 1 === 10 ? 0 : c + 1;
                    const bAmt = getHarufAmount(digit, 'bahar');
                    return (
                      <td key={`b${digit}`} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 align-middle">
                        <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                          B{digit}
                        </span>
                        {bAmt > 0 ? <span className="font-bold text-slate-900">{bAmt.toLocaleString('en-IN')}</span> : null}
                      </td>
                    );
                  })}
                  <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 font-mono">
                    {baharTotal.toLocaleString('en-IN')}
                  </td>
                </tr>

                {/* Andar Haruf (A1 - A0) */}
                <tr>
                  {Array.from({ length: 10 }, (_, c) => {
                    const digit = c + 1 === 10 ? 0 : c + 1;
                    const aAmt = getHarufAmount(digit, 'andar');
                    return (
                      <td key={`a${digit}`} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 align-middle">
                        <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
                          A{digit}
                        </span>
                        {aAmt > 0 ? <span className="font-bold text-slate-900">{aAmt.toLocaleString('en-IN')}</span> : null}
                      </td>
                    );
                  })}
                  <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 font-mono">
                    {andarTotal.toLocaleString('en-IN')}
                  </td>
                </tr>

                <tr className="bg-[#152847] text-white font-bold">
                  {Array.from({ length: 9 }, (_, i) => (
                    <td key={i} className="py-1.5 sm:py-2 text-center border border-[#2b446f]">-</td>
                  ))}
                  <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] whitespace-nowrap">Grand Total</td>
                  <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-mono">{finalGrandTotal.toLocaleString('en-IN')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
