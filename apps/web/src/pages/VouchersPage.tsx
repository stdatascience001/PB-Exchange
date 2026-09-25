import React, { useState, useEffect } from 'react';
import { ShiftDto, VoucherDto, VoucherEntryDto } from '@pb/types';
import { apiRequest } from '../api/client.js';

interface VouchersPageProps {
  shifts?: ShiftDto[];
}

const VOUCHER_TYPES = ['WINNING_PAYOUT', 'BET_COLLECTION', 'COMMISSION', 'CASH_RECEIPT', 'CASH_PAYMENT'];

const formatDate = (dateVal?: string) => {
  if (!dateVal) return '-';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return dateVal;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${day}-${month}-${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  } catch {
    return dateVal;
  }
};

export const VouchersPage: React.FC<VouchersPageProps> = ({ shifts = [] }) => {
  const [list, setList] = useState<VoucherDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [selectedType, setSelectedType] = useState<string>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [entriesByVoucher, setEntriesByVoucher] = useState<Record<number, VoucherEntryDto[]>>({});
  const [entriesLoading, setEntriesLoading] = useState<number | null>(null);

  const fetchVouchers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedShiftId) params.append('shiftId', selectedShiftId);
      if (selectedType) params.append('voucherType', selectedType);
      const res = await apiRequest<VoucherDto[]>(`/vouchers?${params.toString()}`);
      if (res.data) setList(res.data);
    } catch (err) {
      console.warn('Failed to load vouchers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVouchers();
  }, [selectedShiftId, selectedType]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchVouchers();
  };

  const toggleExpand = async (voucherId: number) => {
    if (expandedId === voucherId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(voucherId);
    if (!entriesByVoucher[voucherId]) {
      setEntriesLoading(voucherId);
      try {
        const res = await apiRequest<VoucherEntryDto[]>(`/vouchers/${voucherId}/entries`);
        if (res.data) {
          setEntriesByVoucher(prev => ({ ...prev, [voucherId]: res.data }));
        }
      } catch (err) {
        console.warn('Failed to load voucher entries:', err);
      } finally {
        setEntriesLoading(null);
      }
    }
  };

  const totalSum = list.reduce((acc, v) => acc + v.totalAmount, 0);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">
            Vouchers & Expenses
          </span>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Shift</span>
            <select
              value={selectedShiftId}
              onChange={(e) => setSelectedShiftId(e.target.value)}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer min-w-32 shadow-xs"
            >
              <option value="">-- ALL --</option>
              {shifts.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Type</span>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="">ALL TYPES</option>
              {VOUCHER_TYPES.map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
          >
            Search
          </button>
        </form>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr.</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Voucher No.</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Type</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Shift</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Narration</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Created By</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Created At</th>
                <th className="py-2.5 px-4 text-center w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400 font-medium">
                    Loading vouchers...
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400 font-medium">
                    No vouchers found for this filter.
                  </td>
                </tr>
              ) : (
                list.map((v, idx) => (
                  <React.Fragment key={v.id}>
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-4 font-bold text-slate-900 border-r border-slate-200">
                        {v.voucherNumber}
                      </td>
                      <td className="py-2 px-4 border-r border-slate-200">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold uppercase">
                          {v.voucherType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">
                        {v.shiftName}
                      </td>
                      <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                        ₹{v.totalAmount.toLocaleString('en-IN')}
                      </td>
                      <td className="py-2 px-4 text-slate-600 border-r border-slate-200 whitespace-normal max-w-xs">
                        {v.narration || '-'}
                      </td>
                      <td className="py-2 px-4 font-semibold uppercase text-slate-700 border-r border-slate-200">
                        {v.createdByUsername}
                      </td>
                      <td className="py-2 px-4 font-mono text-slate-500 text-[10px] border-r border-slate-200">
                        {formatDate(v.createdAt)}
                      </td>
                      <td className="py-2 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleExpand(v.id)}
                          className="px-3 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-[10px] rounded shadow-xs"
                        >
                          {expandedId === v.id ? 'Hide' : 'View'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === v.id && (
                      <tr>
                        <td colSpan={9} className="bg-slate-50 border-b border-slate-200 p-3">
                          {entriesLoading === v.id ? (
                            <div className="text-center text-slate-400 py-2">Loading entries...</div>
                          ) : (entriesByVoucher[v.id] || []).length === 0 ? (
                            <div className="text-center text-slate-400 py-2">No ledger entries for this voucher.</div>
                          ) : (
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-slate-200 text-slate-700 font-bold text-[10px]">
                                  <th className="py-1.5 px-3">Party</th>
                                  <th className="py-1.5 px-3 text-center">Side</th>
                                  <th className="py-1.5 px-3 text-right">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {(entriesByVoucher[v.id] || []).map(e => (
                                  <tr key={e.id}>
                                    <td className="py-1.5 px-3 font-bold uppercase text-slate-800">
                                      {e.partyName || '-'}
                                    </td>
                                    <td className="py-1.5 px-3 text-center font-bold">
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] ${
                                          e.entrySide === 'CR'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : 'bg-rose-100 text-rose-800'
                                        }`}
                                      >
                                        {e.entrySide}
                                      </span>
                                    </td>
                                    <td className="py-1.5 px-3 text-right font-mono font-semibold">
                                      ₹{e.amount.toLocaleString('en-IN')}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr className="bg-[#152847] text-white font-bold text-[11px]">
                  <td className="py-2 px-3 text-center border-r border-[#223b63]">{list.length}</td>
                  <td className="py-2 px-4 border-r border-[#223b63]" colSpan={3}>Total</td>
                  <td className="py-2 px-4 text-right font-mono border-r border-[#223b63]">
                    ₹{totalSum.toLocaleString('en-IN')}
                  </td>
                  <td className="py-2 px-4 border-r border-[#223b63]" colSpan={4}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
