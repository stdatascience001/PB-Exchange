import React, { useState, useEffect, useMemo } from 'react';
import { ShiftDto, JantriViewDto } from '@pb/types';
import { apiRequest } from '../api/client.js';

interface JantriPageProps {
  shifts: ShiftDto[];
  activeShift: ShiftDto | null;
  onSelectShift: (shift: ShiftDto) => void;
  declareModeOnly?: boolean;
}

export const JantriPage: React.FC<JantriPageProps> = ({
  shifts,
  activeShift,
  onSelectShift,
  declareModeOnly = false,
}) => {
  const [data, setData] = useState<JantriViewDto | null>(null);
  const [loading, setLoading] = useState(false);
  // Was a hardcoded, non-editable "today" label never wired into the fetch — now a real
  // filter, matching the same fix already applied to Transaction List's date field.
  const [dateStr, setDateStr] = useState<string>(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const availableShifts = useMemo(() => {
    // Only active shifts belong in this dropdown — a disabled shift (Shift Manage's
    // Enable/Disable tab) shouldn't still be selectable here.
    const activeOnly = shifts.filter(s => s.isActive !== false);
    const base = activeOnly.length > 0 ? activeOnly : shifts;
    if (!declareModeOnly) return base;
    const declared = base.filter(s => !!s.declaredNumber || s.status === 'DECLARED' || s.status === 'AUDITED');
    return declared.length > 0 ? declared : base;
  }, [shifts, declareModeOnly]);

  const fetchJantri = async (shiftId: number) => {
    setLoading(true);
    try {
      // Jantri page shows net (Commission/Hissa/Kat-adjusted) amounts, confirmed against live:
      // GHAZIABAD's Jantri Grand Total (28,800) exactly matches Dashboard's Commission/Hissa/Kat
      // figure for that same shift, not its raw collected total — so this hits the dedicated
      // /net endpoint rather than the raw /jantri/:shiftId used elsewhere (e.g. Company
      // Calculation), which must keep showing raw amounts.
      const res = await apiRequest<JantriViewDto>(`/jantri/${shiftId}/net?date=${dateStr}`);
      if (res.data) setData(res.data);
    } catch (err) {
      console.warn('Failed to load Jantri view:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const target = activeShift && availableShifts.some(s => s.id === activeShift.id) ? activeShift : availableShifts[0];
    if (target) fetchJantri(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShift, availableShifts.length, dateStr]);

  const selectedShift = activeShift && availableShifts.some(s => s.id === activeShift.id) ? activeShift : availableShifts[0];

  const gridByNumber = useMemo(() => {
    const map = new Map<string, { totalAmount: number; liability: number }>();
    (data?.grid || []).forEach(c => map.set(c.number, c));
    return map;
  }, [data]);

  const harufByDigit = useMemo(() => {
    const map = new Map<string, { andarAmount: number; baharAmount: number }>();
    (data?.haruf || []).forEach(h => map.set(h.digit, h));
    return map;
  }, [data]);

  const getAmountForNum = (n: number) => {
    const padded = n < 100 ? String(n).padStart(2, '0') : '00';
    return gridByNumber.get(padded)?.totalAmount || 0;
  };

  const getRowTotal = (r: number) => {
    let sum = 0;
    for (let c = 1; c <= 10; c++) sum += getAmountForNum(r * 10 + c);
    return sum;
  };

  const getColTotal = (col: number) => {
    let sum = 0;
    for (let r = 0; r < 10; r++) sum += getAmountForNum(r * 10 + col);
    return sum;
  };

  const numbersTotal = useMemo(() => {
    let sum = 0;
    for (let i = 1; i <= 100; i++) sum += getAmountForNum(i);
    return sum;
  }, [data]);

  const baharTotal = useMemo(() => {
    let sum = 0;
    for (let i = 0; i <= 9; i++) sum += harufByDigit.get(String(i))?.baharAmount || 0;
    return sum;
  }, [data]);

  const andarTotal = useMemo(() => {
    let sum = 0;
    for (let i = 0; i <= 9; i++) sum += harufByDigit.get(String(i))?.andarAmount || 0;
    return sum;
  }, [data]);

  const grandTotal = numbersTotal + baharTotal + andarTotal;

  const handleExportExcel = () => {
    if (!data) return;
    const rows: string[] = ['Number,Amount'];
    for (let i = 1; i <= 100; i++) {
      const n = i < 100 ? String(i).padStart(2, '0') : '00';
      rows.push(`${n},${getAmountForNum(i)}`);
    }
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `jantri_${selectedShift?.name || 'shift'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <div className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">
            {declareModeOnly ? 'Declare Jantri' : 'Jantri'}
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Shift</span>
            <select
              value={selectedShift?.id || ''}
              onChange={(e) => {
                const s = availableShifts.find(sh => sh.id === parseInt(e.target.value, 10));
                if (s) onSelectShift(s);
              }}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
            >
              {availableShifts.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
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

          <button
            type="button"
            onClick={handleExportExcel}
            className="ml-auto px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors"
          >
            Excel
          </button>
        </div>

        <div className="overflow-x-auto flex-1 p-2">
          {loading ? (
            <div className="py-16 text-center text-slate-400 font-medium">Loading Jantri...</div>
          ) : !data ? (
            <div className="py-16 text-center text-slate-400 font-medium">No data available.</div>
          ) : (
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
                  const rowTotal = getRowTotal(r);
                  return (
                    <tr key={r} className="hover:bg-slate-50/70">
                      {Array.from({ length: 10 }, (_, c) => {
                        const num = r * 10 + (c + 1);
                        const amt = getAmountForNum(num);
                        return (
                          <td key={num} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle">
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
                      <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                        {rowTotal > 0 ? rowTotal.toLocaleString('en-IN') : 0}
                      </td>
                    </tr>
                  );
                })}

                <tr className="bg-[#152847] text-white font-bold font-mono text-center text-xs sm:text-[13px]">
                  {Array.from({ length: 10 }, (_, c) => {
                    const colTotal = getColTotal(c + 1);
                    return (
                      <td key={c + 1} className="py-1.5 sm:py-2 border border-[#2b446f]">
                        {colTotal > 0 ? colTotal.toLocaleString('en-IN') : 0}
                      </td>
                    );
                  })}
                  <td className="py-1.5 sm:py-2 border border-[#2b446f]">
                    {numbersTotal > 0 ? numbersTotal.toLocaleString('en-IN') : 0}
                  </td>
                </tr>

                <tr className="hover:bg-slate-50/70">
                  {Array.from({ length: 10 }, (_, c) => {
                    const digit = c + 1 === 10 ? 0 : c + 1;
                    const badgeLabel = `B${digit}`;
                    const bAmt = harufByDigit.get(String(digit))?.baharAmount || 0;
                    return (
                      <td key={badgeLabel} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle">
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
                  <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                    {baharTotal > 0 ? baharTotal.toLocaleString('en-IN') : 0}
                  </td>
                </tr>

                <tr className="hover:bg-slate-50/70">
                  {Array.from({ length: 10 }, (_, c) => {
                    const digit = c + 1 === 10 ? 0 : c + 1;
                    const badgeLabel = `A${digit}`;
                    const aAmt = harufByDigit.get(String(digit))?.andarAmount || 0;
                    return (
                      <td key={badgeLabel} className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle">
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
                  <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                    {andarTotal > 0 ? andarTotal.toLocaleString('en-IN') : 0}
                  </td>
                </tr>

                <tr className="bg-[#152847] text-white font-bold text-xs sm:text-[13px]">
                  {Array.from({ length: 9 }, (_, i) => (
                    <td key={i} className="py-1.5 sm:py-2 text-center border border-[#2b446f]">-</td>
                  ))}
                  <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-bold whitespace-nowrap">Grand Total</td>
                  <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-mono font-bold">
                    {grandTotal > 0 ? grandTotal.toLocaleString('en-IN') : 0}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
