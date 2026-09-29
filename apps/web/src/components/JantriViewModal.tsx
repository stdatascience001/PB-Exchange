import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { TransactionItem } from '../pages/TransactionListPage.js';
import { harufOf } from '../utils/entryDisplay.js';

interface JantriViewModalProps {
  open: boolean;
  onClose: () => void;
  // The slip whose party the popup is for (header title + non-consolidated grid).
  selectedTx: TransactionItem | null;
  // Every slip currently loaded on the page — Consolidate Jantri sums across these.
  list: TransactionItem[];
}

// Jantri View (F3) popup — the same grid, toggles and totals as Live Transactions' Jantri
// View: numbers 1-100 in a 10x10 grid with row/column totals, then Bahar (B1-B0) and Andar
// (A1-A0) haruf rows, and a Grand Total.
//   - default:                the selected slip's entries only
//   - Consolidate Jantri:     every loaded slip of the selected party (all slips if none)
//   - Cut Consolidate Jantri: each cell shown at 90% (rounded)
export const JantriViewModal: React.FC<JantriViewModalProps> = ({ open, onClose, selectedTx, list }) => {
  const [isConsolidated, setIsConsolidated] = useState(false);
  const [isCutConsolidated, setIsCutConsolidated] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

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

  const cut = (raw: number) => (isCutConsolidated ? Math.round(raw * 0.9) : raw);

  const getAmountForNum = (n: number) => {
    const numStr = String(n);
    const numPadded = n < 100 ? String(n).padStart(2, '0') : '00';
    const matches = jantriEntries.filter(e => {
      if (harufOf(e)) return false;
      const val = (e.numberValue || '').trim();
      return val === numStr || val === numPadded || (n === 100 && (val === '100' || val === '00'));
    });
    return cut(matches.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));
  };

  const getAmountForHaruf = (prefix: 'A' | 'B', digit: number) => {
    const dStr = String(digit % 10);
    const matches = jantriEntries.filter(e => {
      const h = harufOf(e);
      if (h) return h.side === prefix && h.digit === dStr;
      const val = (e.numberValue || '').trim().toUpperCase();
      return (
        val === `${prefix}${dStr}` ||
        val === `${prefix}H${dStr}` ||
        val === `${prefix}-${dStr}` ||
        val === `${prefix}0${dStr}` ||
        (val.startsWith(prefix) && val.endsWith(dStr))
      );
    });
    return cut(matches.reduce((sum, e) => sum + (Number(e.amount) || 0), 0));
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
  }, [jantriEntries, isCutConsolidated]);

  const baharTotal = useMemo(() => {
    let sum = 0;
    for (let i = 0; i <= 9; i++) sum += getAmountForHaruf('B', i);
    return sum;
  }, [jantriEntries, isCutConsolidated]);

  const andarTotal = useMemo(() => {
    let sum = 0;
    for (let i = 0; i <= 9; i++) sum += getAmountForHaruf('A', i);
    return sum;
  }, [jantriEntries, isCutConsolidated]);

  const grandTotal = numbersTotal + baharTotal + andarTotal;
  const fmt = (v: number) => (v > 0 ? v.toLocaleString('en-IN') : 0);

  if (!open) return null;

  const title = isConsolidated
    ? selectedTx?.partyName
      ? `${selectedTx.partyName.toUpperCase()} (CONSOLIDATED)`
      : 'ALL PARTIES (CONSOLIDATED)'
    : selectedTx?.partyName?.toUpperCase() || '-';

  const toggle = (checked: boolean, onClick: () => void, label: string) => (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onClick}
        className={`w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer flex items-center ${
          checked ? 'bg-emerald-500' : 'bg-slate-300'
        }`}
      >
        <div
          className={`w-4 h-4 bg-white rounded-full shadow-xs transform transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
      <span className="text-xs text-white font-semibold">{label}</span>
    </label>
  );

  const harufRow = (prefix: 'A' | 'B', total: number) => (
    <tr className="hover:bg-slate-50/70">
      {Array.from({ length: 10 }, (_, c) => {
        const digit = c + 1 === 10 ? 0 : c + 1;
        const badgeLabel = `${prefix}${digit}`;
        const amt = getAmountForHaruf(prefix, digit);
        return (
          <td
            key={badgeLabel}
            className="relative h-8 sm:h-9 bg-white border border-slate-300 text-right px-1 sm:px-1.5 align-middle"
          >
            <span className="absolute top-0.5 left-0.5 text-[9px] font-bold px-1 rounded-xs bg-[#fef9c3] text-[#854d0e] leading-tight select-none">
              {badgeLabel}
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
        {fmt(total)}
      </td>
    </tr>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50 animate-in fade-in duration-150">
      <div className="bg-[#1b3258] rounded-lg shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-500">
        {/* Header: party name + Consolidate toggles + close */}
        <div className="bg-[#1b3258] px-4 py-2.5 flex items-center justify-between border-b border-[#2a4a7a]">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <h2 className="text-sm sm:text-base font-bold text-white tracking-wide uppercase">{title}</h2>
            <div className="flex items-center gap-4 sm:gap-6">
              {toggle(isConsolidated, () => setIsConsolidated(!isConsolidated), 'Consolidate Jantri')}
              {toggle(isCutConsolidated, () => setIsCutConsolidated(!isCutConsolidated), 'Cut Consolidate Jantri')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-300 hover:text-white transition-colors p-1 cursor-pointer"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Matrix */}
        <div className="bg-white p-2 sm:p-3 overflow-x-auto">
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
              {/* Numbers 1 - 100 */}
              {Array.from({ length: 10 }, (_, r) => (
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
                  <td className="text-center font-bold text-slate-900 bg-white border border-slate-300 text-xs sm:text-[13px] font-mono">
                    {fmt(getRowTotal(r))}
                  </td>
                </tr>
              ))}

              {/* Column totals */}
              <tr className="bg-[#152847] text-white font-bold font-mono text-center text-xs sm:text-[13px]">
                {Array.from({ length: 10 }, (_, c) => (
                  <td key={c + 1} className="py-1.5 sm:py-2 border border-[#2b446f]">
                    {fmt(getColTotal(c + 1))}
                  </td>
                ))}
                <td className="py-1.5 sm:py-2 border border-[#2b446f]">{fmt(numbersTotal)}</td>
              </tr>

              {/* Bahar haruf (B1 - B0), then Andar haruf (A1 - A0) */}
              {harufRow('B', baharTotal)}
              {harufRow('A', andarTotal)}

              {/* Grand total */}
              <tr className="bg-[#152847] text-white font-bold text-xs sm:text-[13px]">
                {Array.from({ length: 9 }, (_, i) => (
                  <td key={i} className="py-1.5 sm:py-2 text-center border border-[#2b446f]">-</td>
                ))}
                <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-bold whitespace-nowrap">Grand Total</td>
                <td className="py-1.5 sm:py-2 text-center border border-[#2b446f] font-mono font-bold">{fmt(grandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
