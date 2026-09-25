import React, { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../api/client.js';
import { X, Edit2, Trash2 } from 'lucide-react';

interface StaffOption {
  id: number;
  fullName: string;
}

interface LeaveRow {
  id: number;
  staffId: number;
  name: string;
  leaveFrom: string;
  leaveTo: string;
  lType: string;
  remark: string;
  updatedBy: string;
  updatedAt: string;
}

const todayInputDate = () => new Date().toISOString().slice(0, 10);

const formatTimestamp = (val: string) => {
  const d = new Date(val);
  if (isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}-${d.getFullYear()} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
};

const formatDateOnly = (val: string) => val.split('-').reverse().join('-');

export const LeaveManagePage: React.FC = () => {
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [leaveFrom, setLeaveFrom] = useState(todayInputDate());
  const [leaveTo, setLeaveTo] = useState(todayInputDate());
  const [staffId, setStaffId] = useState<number | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [showStaffDropdown, setShowStaffDropdown] = useState(false);
  const [lType, setLType] = useState('ABSENT');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      if (search.trim()) params.append('search', search.trim());
      const res = await apiRequest<LeaveRow[]>(`/payroll/leaves?${params.toString()}`);
      if (res.data) setRows(res.data);
    } catch (err) {
      console.warn('Failed to load leaves:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStaff = async () => {
    try {
      const res = await apiRequest<StaffOption[]>('/staff');
      if (res.data) setStaffOptions(res.data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchList();
    fetchStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        openAddModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchList();
  };

  const openAddModal = () => {
    setEditingId(null);
    setLeaveFrom(todayInputDate());
    setLeaveTo(todayInputDate());
    setStaffId(null);
    setStaffSearch('');
    setLType('ABSENT');
    setRemark('');
    setShowModal(true);
  };

  const openEditModal = (row: LeaveRow) => {
    setEditingId(row.id);
    setLeaveFrom(row.leaveFrom);
    setLeaveTo(row.leaveTo);
    setStaffId(row.staffId);
    setStaffSearch(row.name);
    setLType(row.lType);
    setRemark(row.remark);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId) {
      alert('Please select a party.');
      return;
    }
    setSaving(true);
    try {
      const payload = { staffId, leaveFrom, leaveTo, lType, remark: remark.trim() || undefined };
      if (editingId) {
        await apiRequest(`/payroll/leaves/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await apiRequest('/payroll/leaves', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowModal(false);
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Failed to save leave');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this leave record?')) return;
    try {
      await apiRequest(`/payroll/leaves/${id}`, { method: 'DELETE' });
      fetchList();
    } catch (err: any) {
      alert(err.message || 'Failed to delete leave');
    }
  };

  const filteredStaffOptions = useMemo(() => {
    if (!staffSearch.trim()) return staffOptions;
    return staffOptions.filter(s => s.fullName.toLowerCase().includes(staffSearch.trim().toLowerCase()));
  }, [staffOptions, staffSearch]);

  return (
    <div className="min-h-full bg-[#eaedf2] p-2.5 sm:p-3 flex flex-col justify-between text-slate-800 select-none font-sans text-xs">
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden flex flex-col flex-1">
        <form onSubmit={handleSearch} className="p-2 sm:p-2.5 flex flex-wrap items-center gap-2.5 border-b border-slate-200 bg-white">
          <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Leave Manage</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search party..."
            className="w-44 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button type="submit" className="px-4 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white font-bold text-xs rounded shadow-xs">
            Search
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="ml-auto px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors"
          >
            Add (F2)
          </button>
        </form>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Date</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Name</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">L-Type</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Updated By</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Updated Date</th>
                <th className="py-2.5 px-4 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading ? (
                <tr><td colSpan={7} className="py-14 text-center text-slate-400 font-medium">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-14 text-center text-slate-400 font-medium">No leave records found.</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center font-mono text-slate-600 border-r border-slate-200">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono text-slate-700 border-r border-slate-200">
                      {formatDateOnly(r.leaveFrom)}{r.leaveFrom !== r.leaveTo ? ` to ${formatDateOnly(r.leaveTo)}` : ''}
                    </td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.name}</td>
                    <td className="py-2 px-4 text-center border-r border-slate-200">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.lType === 'PAID' ? 'bg-emerald-100 text-emerald-800' : r.lType === 'UNPAID' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'}`}>
                        {r.lType}
                      </span>
                    </td>
                    <td className="py-2 px-4 font-bold text-slate-900 uppercase border-r border-slate-200">{r.updatedBy}</td>
                    <td className="py-2 px-4 font-mono text-slate-600 border-r border-slate-200">{formatTimestamp(r.updatedAt)}</td>
                    <td className="py-2 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button type="button" onClick={() => openEditModal(r)} title="Edit" className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => handleDelete(r.id)} title="Delete" className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
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

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden border border-slate-300">
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-tight">{editingId ? 'Edit Leave' : 'Add'}</h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-white hover:text-slate-300 p-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Leave From</label>
                  <input
                    type="date"
                    required
                    value={leaveFrom}
                    onChange={(e) => setLeaveFrom(e.target.value)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Leave To</label>
                  <input
                    type="date"
                    required
                    value={leaveTo}
                    onChange={(e) => setLeaveTo(e.target.value)}
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="relative">
                  <label className="block text-slate-700 font-bold mb-1">Party</label>
                  <input
                    type="text"
                    required
                    value={staffSearch}
                    onChange={(e) => { setStaffSearch(e.target.value); setStaffId(null); setShowStaffDropdown(true); }}
                    onFocus={() => setShowStaffDropdown(true)}
                    onBlur={() => setTimeout(() => setShowStaffDropdown(false), 150)}
                    placeholder="Search party..."
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:border-blue-500"
                  />
                  {showStaffDropdown && filteredStaffOptions.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-300 shadow-xl rounded z-50 max-h-40 overflow-y-auto">
                      {filteredStaffOptions.map(s => (
                        <div
                          key={s.id}
                          onMouseDown={() => { setStaffId(s.id); setStaffSearch(s.fullName); setShowStaffDropdown(false); }}
                          className="px-3 py-1.5 text-xs uppercase cursor-pointer hover:bg-amber-50 font-semibold text-slate-800"
                        >
                          {s.fullName}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">L-Type</label>
                  <select
                    value={lType}
                    onChange={(e) => setLType(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800"
                  >
                    <option value="ABSENT">ABSENT</option>
                    <option value="PAID">PAID</option>
                    <option value="UNPAID">UNPAID</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Remark</label>
                  <input
                    type="text"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-1.5 bg-[#1e3a8a] hover:bg-[#172554] active:bg-[#0f172a] text-white font-bold rounded text-xs shadow-xs disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-1.5 bg-transparent hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded transition-colors"
                >
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
