import React, { useState, useEffect, useRef } from 'react';
import { ShiftDto, UserSession } from '@pb/types';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { X, Edit2, ChevronDown, Trash2 } from 'lucide-react';

// Edit Shift popup tab each saveShiftSection() key belongs to (by its prefix), for the
// "Shift (<Tab>) has been updated successfully!" toast.
const SECTION_TAB_LABELS: Record<string, string> = {
  info: 'Info',
  time: 'Time',
  config: 'Config',
  company: 'Company Config',
  enable: 'Enable/Disable',
};

interface ShiftManagePageProps {
  shifts: ShiftDto[];
  onRefreshShifts: () => void;
  user?: UserSession | null;
}

// New shifts must default to today's actual date (DD-MM-YYYY) — a hardcoded stale date here
// previously left every newly created shift's open_date out of sync with real transaction
// created_at dates, so the dashboard's per-shift totals (scoped to open_date) stayed at 0
// forever for that shift.
function getTodayFormatted(): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

const ALL_ROLES = [
  { id: 1, name: 'DEVELOPER' },
  { id: 2, name: 'SUPER ADMIN' },
  { id: 3, name: 'Distributor' },
  { id: 4, name: 'Retailer' },
  { id: 5, name: 'Fanter' },
  { id: 6, name: 'Cash Agent' },
  { id: 7, name: 'ADMIN' },
  { id: 8, name: 'MANAGER' },
  { id: 9, name: 'MARKETER' },
  { id: 10, name: 'AUDITOR' },
  { id: 11, name: 'DATA ENTRY OPERATOR' },
  { id: 12, name: 'TALLY OPERATOR' },
];

export const ShiftManagePage: React.FC<ShiftManagePageProps> = ({ shifts, onRefreshShifts, user }) => {
  // Delete is offered to SUPER ADMIN only (the API enforces the same). The shift picked for
  // deletion waits in `deleteTarget` until the "Are you sure delete this shift?" popup's Yes.
  const canDeleteShift = user?.roleName === 'SUPER ADMIN';
  const [deleteTarget, setDeleteTarget] = useState<ShiftDto | null>(null);
  const [deletingShift, setDeletingShift] = useState(false);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingShift(true);
    try {
      await apiRequest(`/shifts/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success(
        <div>
          <div className="font-bold text-base">Success</div>
          <div className="text-sm mt-0.5">{deleteTarget.name} Shift has been deleted successfully!</div>
        </div>,
        { toastId: `shift-deleted-${deleteTarget.id}` }
      );
      setDeleteTarget(null);
      onRefreshShifts();
    } catch (err: any) {
      alert(err.message || 'Failed to delete shift');
    } finally {
      setDeletingShift(false);
    }
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftDto | null>(null);
  const [activeActionDropdownId, setActiveActionDropdownId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Edit Shift popup's 5 tabs (Add Shift keeps its existing single-page form, untouched)
  const [activeEditTab, setActiveEditTab] = useState<'info' | 'time' | 'config' | 'company' | 'enable'>('info');
  const [savingSection, setSavingSection] = useState<string | null>(null);

  // Time tab — 2 extra shift-wide fields beyond the 12 per-role cut-offs
  const [fanterPanelTime, setFanterPanelTime] = useState('00:00');
  const [mainJantriTime, setMainJantriTime] = useState('00:00');

  // Config tab
  const [applyShiftConfig, setApplyShiftConfig] = useState(false);
  const [dRate, setDRate] = useState('0');
  const [dCommission, setDCommission] = useState('0');
  const [aRate, setARate] = useState('0');
  const [aCommission, setACommission] = useState('0');
  const [tax, setTax] = useState('0');
  const [transactionCapping, setTransactionCapping] = useState(false);
  const [collectionRoundOff, setCollectionRoundOff] = useState('0');
  const [checkLagaiBeforeDeclare, setCheckLagaiBeforeDeclare] = useState(false);
  const [createVapsi, setCreateVapsi] = useState(true);
  const [resultWebShiftId, setResultWebShiftId] = useState('0');

  // Company Config tab
  const [autoCompanyTransactionActive, setAutoCompanyTransactionActive] = useState(false);
  const [companyUrl, setCompanyUrl] = useState('');
  const [companyShiftId, setCompanyShiftId] = useState('0');
  const [companyUsername, setCompanyUsername] = useState('');
  const [companyPassword, setCompanyPassword] = useState('');
  const [companyDRate, setCompanyDRate] = useState('0');
  const [companyDComm, setCompanyDComm] = useState('0');
  const [companyARate, setCompanyARate] = useState('0');
  const [companyAComm, setCompanyAComm] = useState('0');
  const [companyTax, setCompanyTax] = useState('0');
  const [companyRemark, setCompanyRemark] = useState('');

  // Enable/Disable tab
  const [isShiftActive, setIsShiftActive] = useState(true);

  // Modal Form state matching Image 4
  const [shiftName, setShiftName] = useState('');
  const [openDate, setOpenDate] = useState(getTodayFormatted());
  const [nextDay, setNextDay] = useState('NO');
  const [shiftFor, setShiftFor] = useState('Both');
  const [roleTimings, setRoleTimings] = useState<{ [roleName: string]: string }>({
    'DEVELOPER': '20:44',
    'SUPER ADMIN': '20:44',
    'Distributor': '20:44',
    'Retailer': '20:44',
    'Fanter': '20:44',
    'Cash Agent': '20:44',
    'ADMIN': '20:44',
    'MANAGER': '20:44',
    'MARKETER': '20:44',
    'AUDITOR': '20:44',
    'DATA ENTRY OPERATOR': '20:44',
    'TALLY OPERATOR': '20:44',
  });

  // F2 Keyboard Shortcut to Open Add Shift Modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        handleOpenAdd();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close Action dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.action-dropdown-container')) {
        setActiveActionDropdownId(null);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  // Keep the currently-open Edit Shift popup's `editingShift` in sync with the shared shifts
  // list once it refreshes after any per-tab Save (saveShiftSection always calls
  // onRefreshShifts()) — the Company Config tab's saved-listing table reads real persisted
  // values off `editingShift`, not the live (still-being-typed) form state, so without this it
  // would keep showing stale/blank data after a save instead of the row that was just written.
  useEffect(() => {
    if (editingShift) {
      const fresh = shifts.find(s => s.id === editingShift.id);
      if (fresh) setEditingShift(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts]);

  const handleOpenAdd = () => {
    setEditingShift(null);
    setShiftName('');
    setOpenDate(getTodayFormatted());
    setNextDay('NO');
    setShiftFor('Both');
    const defaultTimings: { [roleName: string]: string } = {};
    ALL_ROLES.forEach(r => {
      defaultTimings[r.name] = '20:44';
    });
    setRoleTimings(defaultTimings);
    setShowModal(true);
  };

  const handleOpenEdit = (s: ShiftDto) => {
    setEditingShift(s);
    setShiftName(s.name);

    let displayDate = s.openDate;
    if (s.openDate && s.openDate.includes('-')) {
      const parts = s.openDate.split('-');
      if (parts.length === 3 && parts[0].length === 4) {
        displayDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
    setOpenDate(displayDate);
    setNextDay(s.isNextDay ? 'YES' : 'NO');
    setShiftFor(s.shiftFor || 'Both');

    const timings: { [roleName: string]: string } = {};
    ALL_ROLES.forEach(r => {
      const found = s.roleConfigs?.find(rc => rc.roleId === r.id);
      if (found && found.closeTime) {
        timings[r.name] = found.closeTime.slice(0, 5);
      } else {
        timings[r.name] = '20:44';
      }
    });
    setRoleTimings(timings);

    setFanterPanelTime((s.fanterPanelTime || '00:00:00').slice(0, 5));
    setMainJantriTime((s.mainJantriTime || '00:00:00').slice(0, 5));

    setApplyShiftConfig(!!s.applyShiftConfig);
    setDRate(String(s.dRate ?? 0));
    setDCommission(String(s.dCommission ?? 0));
    setARate(String(s.aRate ?? 0));
    setACommission(String(s.aCommission ?? 0));
    setTax(String(s.tax ?? 0));
    setTransactionCapping(!!s.transactionCapping);
    setCollectionRoundOff(String(s.collectionRoundOff ?? 0));
    setCheckLagaiBeforeDeclare(!!s.checkLagaiBeforeDeclare);
    setCreateVapsi(s.createVapsi !== false);
    setResultWebShiftId(String(s.resultWebShiftId ?? 0));

    setAutoCompanyTransactionActive(!!s.autoCompanyTransactionActive);
    setCompanyUrl(s.companyUrl || '');
    setCompanyShiftId(String(s.companyShiftId ?? 0));
    setCompanyUsername(s.companyUsername || '');
    setCompanyPassword(s.companyPassword || '');
    setCompanyDRate(String(s.companyDRate ?? 0));
    setCompanyDComm(String(s.companyDComm ?? 0));
    setCompanyARate(String(s.companyARate ?? 0));
    setCompanyAComm(String(s.companyAComm ?? 0));
    setCompanyTax(String(s.companyTax ?? 0));
    setCompanyRemark(s.companyRemark || '');

    setIsShiftActive(s.isActive !== false);

    setActiveEditTab('info');
    setShowModal(true);
  };

  // Every tab section (except Info, which reuses the existing handleSaveShift submit) has its
  // own independent Save button, matching the live reference — each just PATCHes its own slice
  // of fields rather than the whole form, and refreshes the shared shift list afterward.
  // `closeAfter` is opt-in: an explicit Save button dismisses the dialog once the write lands,
  // so pressing Save visibly does something. The inline checkbox auto-saves (Lagai, Vapsi,
  // Company Allow, Enable/Disable) and the company-config Delete deliberately leave it out —
  // those fire on a toggle, and slamming the dialog shut mid-edit would be jarring. On a
  // failure the dialog stays open with the error, so nothing typed is lost.
  const saveShiftSection = async (
    section: string,
    payload: Record<string, any>,
    opts?: { closeAfter?: boolean }
  ) => {
    if (!editingShift) return;
    setSavingSection(section);
    try {
      await apiRequest(`/shifts/${editingShift.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      onRefreshShifts();
      // Green top-right "Success" toast, as on the live panel: "<SHIFT> Shift (<Tab>) has been
      // updated successfully!" — the tab is taken from the section key's prefix, and the name
      // from the payload when the Info tab has just renamed the shift.
      const tabLabel = SECTION_TAB_LABELS[section.split('-')[0]] || 'Info';
      const savedName = (typeof payload.name === 'string' && payload.name.trim()) || editingShift.name;
      toast.success(
        <div>
          <div className="font-bold text-base">Success</div>
          <div className="text-sm mt-0.5">{savedName} Shift ({tabLabel}) has been updated successfully!</div>
        </div>,
        { toastId: `shift-updated-${editingShift.id}-${section}` }
      );
      if (opts?.closeAfter) {
        setShowModal(false);
        setEditingShift(null);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to save');
    } finally {
      setSavingSection(null);
    }
  };

  const handleTimeChange = (role: string, val: string) => {
    setRoleTimings(prev => ({ ...prev, [role]: val }));
  };

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftName.trim()) return;

    setLoading(true);
    try {
      // Map roleTimings to backend roleConfigs
      const roleConfigs = ALL_ROLES.map(r => {
        const time = roleTimings[r.name] || '20:44';
        return {
          roleId: r.id,
          openTime: '09:00:00',
          closeTime: time.includes(':') ? (time.split(':').length === 2 ? `${time}:00` : time) : '20:44:00',
          isActive: true,
        };
      });

      // Format openDate to YYYY-MM-DD for backend
      let formattedBackendDate = openDate;
      if (openDate.includes('-')) {
        const parts = openDate.split('-');
        if (parts.length === 3 && parts[0].length === 2) {
          formattedBackendDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }

      if (editingShift) {
        // Update existing shift
        await apiRequest(`/shifts/${editingShift.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: shiftName.trim().toUpperCase(),
            openDate: formattedBackendDate,
            isNextDay: nextDay === 'YES',
            shiftFor,
            roleConfigs,
          }),
        });
      } else {
        // Create new shift
        await apiRequest('/shifts', {
          method: 'POST',
          body: JSON.stringify({
            name: shiftName.trim().toUpperCase(),
            openDate: formattedBackendDate,
            isNextDay: nextDay === 'YES',
            shiftFor,
            roleConfigs,
          }),
        });
      }

      setShowModal(false);
      setEditingShift(null);
      setShiftName('');
      onRefreshShifts();
    } catch (err: any) {
      alert(err.message || (editingShift ? 'Failed to update shift' : 'Failed to create shift'));
    } finally {
      setLoading(false);
    }
  };


  const handleToggleActive = async (id: number) => {
    try {
      await apiRequest(`/shifts/${id}/toggle-active`, { method: 'PATCH' });
      onRefreshShifts();
    } catch (err: any) {
      alert(err.message || 'Failed to toggle active status');
    }
  };

  // Drag & drop ordering (live panel: drag a row to a new place, the sequence is saved and the
  // Dashboard shows the shifts in that same order). `localOrder` holds the dropped sequence
  // until the refreshed list arrives, so the row stays where it was dropped meanwhile.
  const [dragShiftId, setDragShiftId] = useState<number | null>(null);
  const [dragOverShiftId, setDragOverShiftId] = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  useEffect(() => {
    if (!savingOrder) setLocalOrder(null);
  }, [shifts]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderedShifts = localOrder
    ? [...shifts].sort((a, b) => {
        const ia = localOrder.indexOf(a.id);
        const ib = localOrder.indexOf(b.id);
        return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
      })
    : shifts;

  // Only the full, unfiltered list can be reordered — a drop inside a search result wouldn't
  // say where the hidden rows belong.
  const canDragRows = !searchTerm.trim() && !savingOrder;

  const handleRowDrop = async (targetId: number) => {
    const sourceId = dragShiftId;
    setDragShiftId(null);
    setDragOverShiftId(null);
    if (sourceId === null || sourceId === targetId) return;

    const ids = orderedShifts.map(sh => sh.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);

    setLocalOrder(ids);
    setSavingOrder(true);
    try {
      await apiRequest('/shifts/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ shiftIds: ids }),
      });
      toast.success(
        <div>
          <div className="font-bold text-base">Success</div>
          <div className="text-sm mt-0.5">Shift (Order) has been updated successfully!</div>
        </div>,
        { toastId: 'shift-order-updated' }
      );
    } catch (err: any) {
      setLocalOrder(null);
      alert(err.message || 'Failed to update shift order');
    } finally {
      setSavingOrder(false);
      onRefreshShifts();
    }
  };

  // Filter shifts dynamically based on search term
  const filteredShifts = orderedShifts.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.openDate.includes(searchTerm)
  );

  return (
    <div className="min-h-full bg-[#eaedf2] p-4 sm:p-5 flex flex-col justify-between text-slate-800 select-none">
      {/* Container Box matching Image 3 */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        {/* Subheader Filter Bar */}
        <div className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200">
          <div className="flex items-center gap-4">
            <span className="font-bold text-sm text-slate-800">Shift</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 font-medium">Search</span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder=""
                className="w-48 sm:w-64 px-3 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>

          <button
            onClick={handleOpenAdd}
            className="px-5 py-2 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow transition-colors flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
          >
            <span>Add (F2)</span>
          </button>
        </div>

        {/* Shift Data Table matching Image 3 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-xs">
                <th className="py-2.5 px-3 border-r border-[#223b63] w-14 text-center">Sr. No</th>
                <th className="py-2.5 px-4 border-r border-[#223b63]">Shift Name</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Open Date</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">Next Day</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">Shift For</th>
                <th className="py-2.5 px-3 border-r border-[#223b63] text-center">IsActive</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Updated By</th>
                <th className="py-2.5 px-4 border-r border-[#223b63] text-center">Updated Date</th>
                <th className="py-2.5 px-3 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans text-xs">
              {filteredShifts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    No shifts found matching your search.
                  </td>
                </tr>
              ) : (
                filteredShifts.map((s, idx) => {
                  const isActive = s.isActive !== false;
                  // Format open date nicely like DD-MM-YYYY
                  let displayDate = s.openDate;
                  if (s.openDate.includes('-')) {
                    const parts = s.openDate.split('-');
                    if (parts.length === 3 && parts[0].length === 4) {
                      displayDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                  }

                  return (
                    <tr
                      key={s.id}
                      draggable={canDragRows}
                      onDragStart={(e) => {
                        setDragShiftId(s.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(s.id));
                      }}
                      onDragOver={(e) => {
                        if (dragShiftId === null) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverShiftId !== s.id) setDragOverShiftId(s.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleRowDrop(s.id);
                      }}
                      onDragEnd={() => {
                        setDragShiftId(null);
                        setDragOverShiftId(null);
                      }}
                      className={`hover:bg-slate-50 transition-colors ${canDragRows ? 'cursor-move' : ''} ${dragShiftId === s.id ? 'opacity-40' : ''} ${dragOverShiftId === s.id && dragShiftId !== s.id ? 'outline outline-2 outline-[#1662c6] -outline-offset-2 bg-blue-50' : ''}`}
                    >
                      <td className="py-2.5 px-3 text-center font-mono text-slate-600 border-r border-slate-100">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4 border-r border-slate-100">
                        <div className="flex items-center justify-between gap-2 group">
                          <span
                            onClick={() => handleOpenEdit(s)}
                            className="font-bold text-slate-800 uppercase tracking-wide cursor-pointer hover:text-blue-700 transition-colors"
                            title="Click to edit shift name"
                          >
                            {s.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(s)}
                            className="opacity-70 group-hover:opacity-100 text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-50 rounded transition-all cursor-pointer"
                            title={`Edit Shift Name: ${s.name}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono text-slate-600 border-r border-slate-100">
                        {displayDate}
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-600 border-r border-slate-100">
                        {s.isNextDay ? 'Yes' : 'No'}
                      </td>
                      <td className="py-2.5 px-3 text-center font-semibold text-slate-600 border-r border-slate-100">
                        {s.shiftFor || 'BOTH'}
                      </td>
                      <td className="py-2.5 px-3 text-center border-r border-slate-100">
                        <span
                          onClick={() => handleToggleActive(s.id)}
                          className={`cursor-pointer px-3 py-0.5 rounded-full text-[10px] font-bold uppercase transition-transform active:scale-95 inline-block ${
                            isActive
                              ? 'bg-[#00897b] text-white shadow-sm'
                              : 'bg-[#d32f2f] text-white shadow-sm'
                          }`}
                        >
                          {isActive ? 'ACTIVE' : 'DEACTIVE'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center text-slate-600 font-semibold border-r border-slate-100">
                        {s.updatedBy || 'A100'}
                      </td>
                      <td className="py-2.5 px-4 text-center text-slate-500 font-mono text-[11px] border-r border-slate-100">
                        {s.updatedAt ? new Date(s.updatedAt).toLocaleString('en-GB') : '08-09-2026 20:42 PM'}
                      </td>
                      <td className="py-2.5 px-3 text-center relative">
                        <div className="action-dropdown-container relative inline-block text-left">
                          <button
                            type="button"
                            onClick={() => setActiveActionDropdownId(activeActionDropdownId === s.id ? null : s.id)}
                            className="px-3 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white rounded text-[11px] font-bold shadow-sm inline-flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <span>Action</span>
                            <ChevronDown className="w-3 h-3" />
                          </button>
                          {activeActionDropdownId === s.id && (
                            <div className="absolute right-0 mt-1 w-36 bg-white border border-slate-200 rounded shadow-xl z-30 py-1 text-left animate-in fade-in duration-100 divide-y divide-slate-100">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveActionDropdownId(null);
                                  handleOpenEdit(s);
                                }}
                                className="w-full px-3 py-2 text-xs text-slate-800 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2 font-semibold cursor-pointer text-left"
                              >
                                <Edit2 className="w-3.5 h-3.5 text-blue-600" />
                                <span>Edit Shift</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveActionDropdownId(null);
                                  handleToggleActive(s.id);
                                }}
                                className="w-full px-3 py-2 text-xs text-slate-800 hover:bg-slate-50 flex items-center gap-2 font-semibold cursor-pointer text-left"
                              >
                                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-red-500' : 'bg-green-500'}`} />
                                <span>{isActive ? 'Deactivate' : 'Activate'}</span>
                              </button>
                              {canDeleteShift && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveActionDropdownId(null);
                                    setDeleteTarget(s);
                                  }}
                                  className="w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 font-semibold cursor-pointer text-left"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {/* Table Footer matching Image 3 */}
            <tfoot>
              <tr className="bg-[#152847] text-white font-bold text-xs">
                <th className="py-2 px-3 border-r border-[#223b63] text-center">Sr. No</th>
                <th className="py-2 px-4 border-r border-[#223b63]">Shift Name</th>
                <th className="py-2 px-4 border-r border-[#223b63] text-center">Open Date</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-center">Next Day</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-center">Shift For</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-center">IsActive</th>
                <th className="py-2 px-4 border-r border-[#223b63] text-center">Updated By</th>
                <th className="py-2 px-4 border-r border-[#223b63] text-center">Updated Date</th>
                <th className="py-2 px-3 text-center">Action</th>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Bottom Help Note */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-slate-500 text-xs font-semibold">
          Need Help?
        </div>
      </div>

      {/* Delete confirmation — Yes deletes, No just closes */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded shadow-2xl w-full max-w-[380px] border border-slate-300">
            <div className="bg-[#152847] text-white px-4 py-2.5 rounded-t flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide">Delete Shift</h3>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingShift}
                className="text-white/80 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-5 text-center">
              <p className="text-sm font-semibold text-slate-800">Are you sure delete this shift?</p>
              <p className="text-xs font-bold text-slate-500 uppercase mt-1">{deleteTarget.name}</p>
            </div>
            <div className="px-5 pb-4 flex justify-center gap-3">
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deletingShift}
                className="px-6 py-1.5 bg-[#dc2626] hover:bg-[#b91c1c] disabled:opacity-60 text-white font-bold text-xs rounded shadow-xs cursor-pointer"
              >
                {deletingShift ? 'Deleting...' : 'Yes'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingShift}
                className="px-6 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded shadow-xs cursor-pointer"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Shift Modal matching Image 4 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-300">
            {/* Modal Header matching Image 4 */}
            <div className="bg-[#1b2b48] text-white px-5 py-3 flex items-center justify-between">
              <h2 className="text-base font-bold tracking-wide">
                {editingShift ? `Edit Shift: ${editingShift.name}` : 'Add Shift'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setEditingShift(null);
                }}
                className="text-white hover:text-slate-300 transition-colors p-1 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body — Add Shift keeps its existing single-page form; Edit Shift gets the
                5-tab layout (Info/Time/Config/Company Config/Enable-Disable) below. */}
            {!editingShift ? (
            <form onSubmit={handleSaveShift} className="p-5 space-y-4 text-xs">
              {/* Top Row: 4 Input Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {/* Shift Name */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Shift Name</label>
                  <input
                    type="text"
                    required
                    value={shiftName}
                    onChange={(e) => setShiftName(e.target.value)}
                    placeholder=""
                    className="w-full px-3 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-slate-900 font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs uppercase"
                  />
                </div>

                {/* Open Date */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Open Date</label>
                  <input
                    type="text"
                    value={openDate}
                    onChange={(e) => setOpenDate(e.target.value)}
                    placeholder="08-09-2026"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Next Day */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Next Day</label>
                  <select
                    value={nextDay}
                    onChange={(e) => setNextDay(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="NO">NO</option>
                    <option value="YES">YES</option>
                  </select>
                </div>

                {/* Shift Working For */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Shift Working For</label>
                  <select
                    value={shiftFor}
                    onChange={(e) => setShiftFor(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="Both">Both</option>
                    <option value="Manual">Manual</option>
                    <option value="Auto">Auto</option>
                  </select>
                </div>
              </div>

              {/* 12 Role Cut-Off Timings Grid (3 rows x 4 cols) matching Image 4 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                {ALL_ROLES.map(role => (
                  <div key={role.id}>
                    <label className="block text-slate-600 font-semibold mb-1 text-[11px] truncate">
                      {role.name}
                    </label>
                    {/* A real time input, so the browser supplies its own hour / minute /
                        AM-PM picker and renders the value in 12-hour form the way the live
                        page does ("05:05 PM"). The underlying value stays 24-hour "HH:mm",
                        so every save path below is unaffected. */}
                    <input
                      type="time"
                      value={roleTimings[role.name] || '20:44'}
                      onChange={(e) => handleTimeChange(role.name, e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-500 text-center"
                    />
                  </div>
                ))}
              </div>

              {/* Modal Footer Buttons matching Image 4 */}
              <div className="flex justify-end items-center gap-3 pt-4 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer"
                >
                  {loading ? (editingShift ? 'Updating...' : 'Saving...') : (editingShift ? 'Update Shift' : 'Save')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingShift(null);
                  }}
                  className="px-4 py-2 text-slate-600 hover:text-slate-900 font-bold text-xs cursor-pointer"
                >
                  Close
                </button>
              </div>
            </form>
            ) : (
            <div>
              {/* Tab Bar */}
              <div className="flex items-center border-b border-slate-200 px-5">
                {([
                  ['info', 'Info'],
                  ['time', 'Time'],
                  ['config', 'Config'],
                  ['company', 'Company Config'],
                  ['enable', 'Enable/Disable'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveEditTab(key)}
                    className={`px-3 py-2.5 text-xs font-bold border-b-2 -mb-px transition-colors cursor-pointer ${
                      activeEditTab === key
                        ? 'border-[#1b3a6d] text-[#1b3a6d]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="p-5 text-xs max-h-[70vh] overflow-y-auto">
                {/* INFO TAB */}
                {activeEditTab === 'info' && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      let formattedBackendDate = openDate;
                      if (openDate.includes('-')) {
                        const parts = openDate.split('-');
                        if (parts.length === 3 && parts[0].length === 2) {
                          formattedBackendDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                        }
                      }
                      saveShiftSection('info', {
                        name: shiftName.trim().toUpperCase(),
                        openDate: formattedBackendDate,
                        isNextDay: nextDay === 'YES',
                        shiftFor,
                      }, { closeAfter: true });
                    }}
                    className="grid grid-cols-1 sm:grid-cols-4 gap-3"
                  >
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Shift Name</label>
                      <input
                        type="text"
                        required
                        value={shiftName}
                        onChange={(e) => setShiftName(e.target.value)}
                        className="w-full px-3 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-slate-900 font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Open Date</label>
                      <input
                        type="date"
                        value={(() => {
                          if (openDate.includes('-') && openDate.split('-')[0].length === 2) {
                            const [d, m, y] = openDate.split('-');
                            return `${y}-${m}-${d}`;
                          }
                          return openDate;
                        })()}
                        onChange={(e) => {
                          const [y, m, d] = e.target.value.split('-');
                          setOpenDate(`${d}-${m}-${y}`);
                        }}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Next Day</label>
                      <select
                        value={nextDay}
                        onChange={(e) => setNextDay(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs focus:outline-none focus:border-blue-500"
                      >
                        <option value="NO">NO</option>
                        <option value="YES">YES</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Shift Working For</label>
                      <select
                        value={shiftFor}
                        onChange={(e) => setShiftFor(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs focus:outline-none focus:border-blue-500"
                      >
                        <option value="Both">Both</option>
                        <option value="Manual">Manual</option>
                        <option value="Auto">Auto</option>
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <button
                        type="submit"
                        disabled={savingSection === 'info'}
                        className="px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60"
                      >
                        {savingSection === 'info' ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </form>
                )}

                {/* TIME TAB */}
                {activeEditTab === 'time' && (
                  <div className="space-y-5">
                    <div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {ALL_ROLES.map(role => (
                          <div key={role.id}>
                            <label className="block text-slate-600 font-semibold mb-1 text-[11px] truncate">
                              {role.name}
                            </label>
                            <input
                              type="time"
                              value={roleTimings[role.name] || '20:44'}
                              onChange={(e) => handleTimeChange(role.name, e.target.value)}
                              className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-500 text-center"
                            />
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={savingSection === 'time-roles'}
                        onClick={() => {
                          const roleConfigs = ALL_ROLES.map(r => {
                            const time = roleTimings[r.name] || '20:44';
                            return {
                              roleId: r.id,
                              openTime: '09:00:00',
                              closeTime: time.includes(':') ? (time.split(':').length === 2 ? `${time}:00` : time) : '20:44:00',
                              isActive: true,
                            };
                          });
                          saveShiftSection('time-roles', { roleConfigs }, { closeAfter: true });
                        }}
                        className="mt-3 px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60"
                      >
                        {savingSection === 'time-roles' ? 'Saving...' : 'Save'}
                      </button>
                    </div>

                    <div className="pt-4 border-t border-slate-200">
                      <div className="grid grid-cols-2 gap-3 max-w-md">
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Fanter Panel Time</label>
                          <input
                            type="time"
                            value={fanterPanelTime}
                            onChange={(e) => setFanterPanelTime(e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-500 text-center"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Main Jantri Time</label>
                          <input
                            type="time"
                            value={mainJantriTime}
                            onChange={(e) => setMainJantriTime(e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-800 font-mono text-xs focus:outline-none focus:border-blue-500 text-center"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={savingSection === 'time-extras'}
                        onClick={() => saveShiftSection('time-extras', {
                          fanterPanelTime: fanterPanelTime.split(':').length === 2 ? `${fanterPanelTime}:00` : fanterPanelTime,
                          mainJantriTime: mainJantriTime.split(':').length === 2 ? `${mainJantriTime}:00` : mainJantriTime,
                        }, { closeAfter: true })}
                        className="mt-3 px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60"
                      >
                        {savingSection === 'time-extras' ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}

                {/* CONFIG TAB */}
                {activeEditTab === 'config' && (
                  <div className="space-y-5">
                    <div>
                      <label className="flex items-center gap-2 font-semibold text-slate-700 mb-2 cursor-pointer">
                        <input type="checkbox" checked={applyShiftConfig} onChange={(e) => setApplyShiftConfig(e.target.checked)} />
                        Apply Shift Config on Transactions (Tick Yes- Active) (Tick No- Deactive)
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">D-Rate</label>
                          <input type="number" value={dRate} onChange={(e) => setDRate(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">D-Commission</label>
                          <input type="number" value={dCommission} onChange={(e) => setDCommission(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">A-Rate</label>
                          <input type="number" value={aRate} onChange={(e) => setARate(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">A-Commission</label>
                          <input type="number" value={aCommission} onChange={(e) => setACommission(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Tax</label>
                          <input type="number" value={tax} onChange={(e) => setTax(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <button
                          type="button"
                          disabled={savingSection === 'config-rates'}
                          onClick={() => saveShiftSection('config-rates', {
                            applyShiftConfig,
                            dRate: parseFloat(dRate) || 0,
                            dCommission: parseFloat(dCommission) || 0,
                            aRate: parseFloat(aRate) || 0,
                            aCommission: parseFloat(aCommission) || 0,
                            tax: parseFloat(tax) || 0,
                          }, { closeAfter: true })}
                          className="px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60 h-fit"
                        >
                          {savingSection === 'config-rates' ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-200">
                      <label className="flex items-center gap-2 font-semibold text-slate-700 mb-2 cursor-pointer">
                        <input type="checkbox" checked={transactionCapping} onChange={(e) => setTransactionCapping(e.target.checked)} />
                        Transaction Capping (Tick Yes- Active) (Tick No- Deactive)
                      </label>
                      <div className="flex items-end gap-3">
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Collection Round Off</label>
                          <input type="number" value={collectionRoundOff} onChange={(e) => setCollectionRoundOff(e.target.value)} className="w-40 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <button
                          type="button"
                          disabled={savingSection === 'config-capping'}
                          onClick={() => saveShiftSection('config-capping', {
                            transactionCapping,
                            collectionRoundOff: parseFloat(collectionRoundOff) || 0,
                          }, { closeAfter: true })}
                          className="px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60"
                        >
                          {savingSection === 'config-capping' ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-200 flex items-center gap-6">
                      <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checkLagaiBeforeDeclare}
                          onChange={(e) => {
                            setCheckLagaiBeforeDeclare(e.target.checked);
                            saveShiftSection('config-lagai', { checkLagaiBeforeDeclare: e.target.checked });
                          }}
                        />
                        Check Lagai Before Declare
                      </label>
                      <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={createVapsi}
                          onChange={(e) => {
                            setCreateVapsi(e.target.checked);
                            saveShiftSection('config-vapsi', { createVapsi: e.target.checked });
                          }}
                        />
                        Create Vapsi
                      </label>
                    </div>

                    <div className="pt-4 border-t border-slate-200 flex items-end gap-3">
                      <div>
                        <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Result-Web ShiftId</label>
                        <input type="number" value={resultWebShiftId} onChange={(e) => setResultWebShiftId(e.target.value)} className="w-40 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                      </div>
                      <button
                        type="button"
                        disabled={savingSection === 'config-webid'}
                        onClick={() => saveShiftSection('config-webid', { resultWebShiftId: parseInt(resultWebShiftId, 10) || 0 }, { closeAfter: true })}
                        className="px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60"
                      >
                        {savingSection === 'config-webid' ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}

                {/* COMPANY CONFIG TAB */}
                {activeEditTab === 'company' && (
                  <div className="space-y-5">
                    <div>
                      <label className="flex items-center gap-2 font-semibold text-slate-700 mb-2 cursor-pointer">
                        <input type="checkbox" checked={autoCompanyTransactionActive} onChange={(e) => setAutoCompanyTransactionActive(e.target.checked)} />
                        Auto Company Transaction active ? (Tick Yes- Active) (Tick No- Deactive)
                      </label>
                      <div className="flex items-end gap-3">
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Company URL</label>
                          <input type="text" value={companyUrl} onChange={(e) => setCompanyUrl(e.target.value)} className="w-64 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Company Shift Id</label>
                          <input type="number" value={companyShiftId} onChange={(e) => setCompanyShiftId(e.target.value)} className="w-32 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <button
                          type="button"
                          disabled={savingSection === 'company-basic'}
                          onClick={() => saveShiftSection('company-basic', {
                            autoCompanyTransactionActive,
                            companyUrl,
                            companyShiftId: parseInt(companyShiftId, 10) || 0,
                          }, { closeAfter: true })}
                          className="px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60"
                        >
                          {savingSection === 'company-basic' ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-200">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Company UserName</label>
                          <input type="text" value={companyUsername} onChange={(e) => setCompanyUsername(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Company Password</label>
                          <input type="password" value={companyPassword} onChange={(e) => setCompanyPassword(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">D-Rate</label>
                          <input type="number" value={companyDRate} onChange={(e) => setCompanyDRate(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">D-Comm</label>
                          <input type="number" value={companyDComm} onChange={(e) => setCompanyDComm(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">A-Rate</label>
                          <input type="number" value={companyARate} onChange={(e) => setCompanyARate(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">A-Comm</label>
                          <input type="number" value={companyAComm} onChange={(e) => setCompanyAComm(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Tax</label>
                          <input type="number" value={companyTax} onChange={(e) => setCompanyTax(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-semibold mb-1 text-[11px]">Remark</label>
                          <input type="text" value={companyRemark} onChange={(e) => setCompanyRemark(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs" />
                        </div>
                      </div>
                      <div className="flex gap-3 mt-3">
                        <button
                          type="button"
                          disabled={savingSection === 'company-details'}
                          onClick={() => saveShiftSection('company-details', {
                            companyUsername,
                            companyPassword,
                            companyDRate: parseFloat(companyDRate) || 0,
                            companyDComm: parseFloat(companyDComm) || 0,
                            companyARate: parseFloat(companyARate) || 0,
                            companyAComm: parseFloat(companyAComm) || 0,
                            companyTax: parseFloat(companyTax) || 0,
                            companyRemark,
                          }, { closeAfter: true })}
                          className="px-6 py-2 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-60"
                        >
                          {savingSection === 'company-details' ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCompanyUsername('');
                            setCompanyPassword('');
                            setCompanyDRate('0');
                            setCompanyDComm('0');
                            setCompanyARate('0');
                            setCompanyAComm('0');
                            setCompanyTax('0');
                            setCompanyRemark('');
                          }}
                          className="px-6 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded text-xs transition-colors cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {/* Saved company config listing — reads the actually-persisted shift record
                        (editingShift), not the live form state above, so it reflects what was
                        really saved rather than whatever is currently mid-edit in the inputs. */}
                    <div className="pt-4 border-t border-slate-200 overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#1e3a63] text-white font-bold text-[10px]">
                            <th className="py-1.5 px-2 border-r border-[#2b4c7e]">Sr</th>
                            <th className="py-1.5 px-2 border-r border-[#2b4c7e]">User/Pass</th>
                            <th className="py-1.5 px-2 border-r border-[#2b4c7e]">Rate | Tax</th>
                            <th className="py-1.5 px-2 border-r border-[#2b4c7e] text-center">Allow</th>
                            <th className="py-1.5 px-2 border-r border-[#2b4c7e] text-center">Update</th>
                            <th className="py-1.5 px-2 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {editingShift && (
                            editingShift.companyUsername ||
                            editingShift.companyDRate ||
                            editingShift.companyDComm ||
                            editingShift.companyARate ||
                            editingShift.companyAComm ||
                            editingShift.companyTax
                          ) ? (
                            <tr>
                              <td className="py-1.5 px-2 border-r border-slate-200">1</td>
                              <td className="py-1.5 px-2 border-r border-slate-200">
                                <div>{editingShift.companyUsername || '0'} / {editingShift.companyPassword || '0'}</div>
                                {editingShift.companyRemark && (
                                  <div className="text-[9px] text-slate-400 lowercase">{editingShift.companyRemark}</div>
                                )}
                              </td>
                              <td className="py-1.5 px-2 border-r border-slate-200">
                                {editingShift.companyDRate}-{editingShift.companyDComm}/{editingShift.companyARate}-{editingShift.companyAComm} | {editingShift.companyTax}
                              </td>
                              <td className="py-1.5 px-2 border-r border-slate-200 text-center">
                                <button
                                  type="button"
                                  disabled={savingSection === 'company-allow'}
                                  onClick={async () => {
                                    const nextActive = !editingShift.autoCompanyTransactionActive;
                                    setAutoCompanyTransactionActive(nextActive);
                                    await saveShiftSection('company-allow', {
                                      autoCompanyTransactionActive: nextActive,
                                      companyUrl: editingShift.companyUrl || '',
                                      companyShiftId: editingShift.companyShiftId ?? 0,
                                    });
                                  }}
                                  title="Click to toggle Allow"
                                  className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold cursor-pointer transition-colors disabled:opacity-50 ${
                                    editingShift.autoCompanyTransactionActive
                                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                      : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                                  }`}
                                >
                                  {editingShift.autoCompanyTransactionActive ? 'ACTIVE' : 'INACTIVE'}
                                </button>
                              </td>
                              <td className="py-1.5 px-2 border-r border-slate-200 text-center text-slate-500">
                                <div>{editingShift.updatedBy || 'A100'}</div>
                                <div className="text-[9px] text-slate-400">
                                  {editingShift.updatedAt ? new Date(editingShift.updatedAt).toLocaleString('en-GB') : '-'}
                                </div>
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // Reload the form fields from the saved row (discards any
                                      // unsaved in-progress edits above).
                                      setAutoCompanyTransactionActive(!!editingShift.autoCompanyTransactionActive);
                                      setCompanyUrl(editingShift.companyUrl || '');
                                      setCompanyShiftId(String(editingShift.companyShiftId ?? 0));
                                      setCompanyUsername(editingShift.companyUsername || '');
                                      setCompanyPassword(editingShift.companyPassword || '');
                                      setCompanyDRate(String(editingShift.companyDRate ?? 0));
                                      setCompanyDComm(String(editingShift.companyDComm ?? 0));
                                      setCompanyARate(String(editingShift.companyARate ?? 0));
                                      setCompanyAComm(String(editingShift.companyAComm ?? 0));
                                      setCompanyTax(String(editingShift.companyTax ?? 0));
                                      setCompanyRemark(editingShift.companyRemark || '');
                                    }}
                                    className="px-2.5 py-1 bg-[#1b3a6d] hover:bg-[#152e57] text-white font-bold rounded text-[10px] transition-colors cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!window.confirm('Delete this company config?')) return;
                                      saveShiftSection('company-details', {
                                        companyUsername: '',
                                        companyPassword: '',
                                        companyDRate: 0,
                                        companyDComm: 0,
                                        companyARate: 0,
                                        companyAComm: 0,
                                        companyTax: 0,
                                        companyRemark: '',
                                      });
                                      setCompanyUsername('');
                                      setCompanyPassword('');
                                      setCompanyDRate('0');
                                      setCompanyDComm('0');
                                      setCompanyARate('0');
                                      setCompanyAComm('0');
                                      setCompanyTax('0');
                                      setCompanyRemark('');
                                    }}
                                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-[10px] transition-colors cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            <tr>
                              <td colSpan={6} className="py-4 text-center text-slate-400">No company config saved yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ENABLE/DISABLE TAB */}
                {activeEditTab === 'enable' && (
                  <div>
                    <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isShiftActive}
                        onChange={(e) => {
                          setIsShiftActive(e.target.checked);
                          saveShiftSection('enable-disable', { isActive: e.target.checked });
                        }}
                      />
                      Is shift active ? (Tick Yes- Active) (Tick No- Deactive)
                    </label>
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
