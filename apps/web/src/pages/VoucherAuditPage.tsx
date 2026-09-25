import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { ArrowLeft } from 'lucide-react';

interface VoucherAuditPageProps {
  onNavigate?: (page: string) => void;
}

interface ManualVoucherItem {
  id: number;
  totalAmount: number;
  auditStatus: string;
  partyName: string;
  oppositePartyName: string;
  createdAt: string;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const formatDateOnly = (dateVal?: string) => {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return dateVal;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day} / ${month} / ${d.getFullYear()}`;
};

export const VoucherAuditPage: React.FC<VoucherAuditPageProps> = ({ onNavigate }) => {
  const [list, setList] = useState<ManualVoucherItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [auditStatus, setAuditStatus] = useState('FOR_AUDIT');

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate, auditStatus });
      const res = await apiRequest<ManualVoucherItem[]>(`/vouchers/manual?${params.toString()}`);
      if (res.data) setList(res.data);
    } catch (err) {
      console.warn('Failed to load vouchers for audit:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchList();
  };

  const handleAuditAction = async (id: number, status: 'ALLOWED' | 'CANCELED') => {
    try {
      await apiRequest(`/vouchers/${id}/audit`, {
        method: 'PATCH',
        body: JSON.stringify({ auditStatus: status }),
      });
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Audit action failed');
    }
  };

  const handleExportExcel = () => {
    if (list.length === 0) {
      alert('No records available to export.');
      return;
    }
    const csvContent = 'data:text/csv;charset=utf-8,' +
      ['V-Date,Ledger,Amount,O-Ledger,For'].concat(
        list.map(r => `${formatDateOnly(r.createdAt)},"${r.partyName}",${r.totalAmount},"${r.oppositePartyName}",${r.auditStatus}`)
      ).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `voucher_audit_${fromDate}_${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => onNavigate && onNavigate('vouchers')}
            title="Back"
            className="p-1 text-slate-800 hover:bg-slate-100 rounded transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Voucher Audit</span>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Date</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium text-xs">Audit</span>
            <select
              value={auditStatus}
              onChange={(e) => setAuditStatus(e.target.value)}
              className="px-2.5 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer shadow-xs"
            >
              <option value="FOR_AUDIT">FOR AUDIT</option>
              <option value="ALLOWED">ALLOWED</option>
              <option value="CANCELED">CANCELED</option>
              <option value="ALL">ALL</option>
            </select>
          </div>

          <button
            type="submit"
            className="px-5 py-1 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors"
          >
            Search
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="ml-auto px-4 py-1 bg-[#15803d] hover:bg-[#166534] active:bg-[#14532d] text-white font-bold text-xs rounded shadow-xs transition-colors"
          >
            Excel
          </button>
        </form>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">V-Date</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Ledger</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-right">Amount</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">O-Ledger</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">For</th>
                <th className="py-2.5 px-4 text-center w-40">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={7} className="py-14 text-center text-slate-400 font-medium">Loading vouchers...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={7} className="py-14 text-center text-slate-400 font-medium">No vouchers found for this filter.</td></tr>
              ) : (
                list.map((v, idx) => (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono text-slate-600 border-r border-slate-200">{formatDateOnly(v.createdAt)}</td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{v.partyName}</td>
                    <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 border-r border-slate-200">
                      {v.totalAmount.toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 px-4 font-semibold uppercase text-slate-800 border-r border-slate-200">{v.oppositePartyName}</td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        v.auditStatus === 'ALLOWED' ? 'bg-emerald-100 text-emerald-800'
                        : v.auditStatus === 'CANCELED' ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                      }`}>
                        {v.auditStatus.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleAuditAction(v.id, 'ALLOWED')}
                          className="px-2.5 py-0.5 bg-[#0284c7] hover:bg-[#0369a1] text-white text-[10px] font-bold rounded shadow-xs"
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAuditAction(v.id, 'CANCELED')}
                          className="px-2.5 py-0.5 bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[10px] font-bold rounded shadow-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
