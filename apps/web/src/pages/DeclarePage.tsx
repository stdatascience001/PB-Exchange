import React, { useState } from 'react';
import { ShiftDto, UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { Trophy, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';

interface DeclarePageProps {
  shifts: ShiftDto[];
  user: UserSession | null;
  onRefreshShifts: () => void;
}

export const DeclarePage: React.FC<DeclarePageProps> = ({
  shifts,
  user,
  onRefreshShifts,
}) => {
  const [selectedShiftId, setSelectedShiftId] = useState<number>(shifts[0]?.id || 0);
  const [winningNumber, setWinningNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultData, setResultData] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedShift = shifts.find(s => s.id === selectedShiftId);

  const handleDeclare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShiftId || !winningNumber) return;

    if (!window.confirm(`Declare winning number "${winningNumber}" for ${selectedShift?.name}? This will settle all winning payouts and generate financial vouchers.`)) {
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setResultData(null);

    try {
      const res = await apiRequest<any>(`/declarations/${selectedShiftId}`, {
        method: 'POST',
        body: JSON.stringify({ winningNumber }),
      });
      setResultData(res.data);
      onRefreshShifts();
    } catch (err: any) {
      setErrorMsg(err.message || 'Declaration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReverse = async () => {
    if (!selectedShiftId) return;
    if (!window.confirm(`Reverse declaration for ${selectedShift?.name}? This will reset shift status back to OPEN.`)) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/declarations/${selectedShiftId}/reverse`, { method: 'POST' });
      setResultData(null);
      setWinningNumber('');
      onRefreshShifts();
    } catch (err: any) {
      setErrorMsg(err.message || 'Reverse declaration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1000px] mx-auto">
      <div className="bg-[#0d1527] border border-slate-800 p-4 rounded-xl flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400 font-bold">
          <Trophy className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-black text-white">
            DECLARE SHIFT RESULT & SETTLEMENT
          </h1>
          <p className="text-xs text-slate-400">
            Super Admin & Admin operational screen. Computes payouts and generates balanced double-entry vouchers.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-950/70 border border-rose-800 text-rose-300 rounded-lg text-xs font-semibold">
          {errorMsg}
        </div>
      )}

      {resultData && (
        <div className="p-5 bg-emerald-950/40 border border-emerald-800 rounded-xl space-y-3 font-mono text-xs">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <CheckCircle className="h-5 w-5" />
            <span>RESULT DECLARED SUCCESSFULLY FOR {resultData.shiftName}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">WINNING NUMBER</div>
              <div className="text-2xl font-black text-pink-400 mt-1">{resultData.winningNumber}</div>
            </div>
            <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">TOTAL COLLECTION</div>
              <div className="text-lg font-black text-white mt-1">₹{resultData.totalCollected.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">TOTAL PAYOUT</div>
              <div className="text-lg font-black text-rose-400 mt-1">₹{resultData.totalPayout.toLocaleString()}</div>
            </div>
            <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-400 text-[10px]">NET P&L</div>
              <div className={`text-lg font-black mt-1 ${resultData.netProfitLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ₹{resultData.netProfitLoss.toLocaleString()}
              </div>
            </div>
            {resultData.netCollection !== undefined && (
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[10px]">COMMISSION/HISSA/KAT</div>
                <div className="text-lg font-black text-sky-400 mt-1">
                  ₹{Math.round(resultData.netCollection).toLocaleString()}
                </div>
              </div>
            )}
          </div>
          <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-800">
            Voucher Generated: <span className="text-amber-400 font-bold">{resultData.voucherNumber}</span> • Winning Slips Settled: {resultData.winningEntriesCount}
          </div>
        </div>
      )}

      <form onSubmit={handleDeclare} className="bg-[#0c1324] border border-slate-800 p-6 rounded-xl space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-300 uppercase font-mono mb-1.5">
            Select Market / Shift
          </label>
          <select
            value={selectedShiftId}
            onChange={(e) => setSelectedShiftId(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white font-bold"
          >
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.openDate}) — Status: {s.status} {s.declaredNumber ? `[Declared: ${s.declaredNumber}]` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-300 uppercase font-mono mb-1.5">
            Winning Number (00 - 99)
          </label>
          <input
            type="text"
            maxLength={2}
            placeholder="e.g. 84"
            value={winningNumber}
            onChange={(e) => setWinningNumber(e.target.value.replace(/\D/g, ''))}
            className="w-full px-3 py-3 bg-slate-900 border border-slate-700 rounded-lg text-2xl text-center text-pink-400 font-mono font-black tracking-widest focus:outline-none focus:border-pink-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !winningNumber || selectedShift?.status === 'DECLARED'}
            className="flex-1 py-3 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 disabled:opacity-50 text-white font-black text-sm rounded-lg shadow-lg shadow-pink-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            <Trophy className="h-4 w-4" />
            <span>{selectedShift?.status === 'DECLARED' ? 'SHIFT ALREADY DECLARED' : 'DECLARE RESULT & SETTLE PAYOUTS'}</span>
          </button>

          {selectedShift?.status === 'DECLARED' && (
            <button
              type="button"
              disabled={loading}
              onClick={handleReverse}
              className="px-5 py-3 bg-slate-800 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 font-bold text-sm rounded-lg transition-colors cursor-pointer"
            >
              Reverse / Re-Open Shift
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
