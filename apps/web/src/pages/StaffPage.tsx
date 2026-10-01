import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { PartyNameInput } from '../components/PartyNameInput.js';
import { X, Edit2, Trash2 } from 'lucide-react';
import { UserSession } from '@pb/types';

export interface StaffItem {
  id: number;
  userId: number;
  fullName: string;
  partyName?: string;
  role: string;
  designation: string;
  username: string;
  wMode: string;
  mobile: string;
  address: string;
  agent: string;
  isActive: boolean;
  updatedBy: string;
  updatedAt: string;
  monthlySalary?: number;
  isWorkingLive?: boolean;
  assignedStation?: string;
  createdAt?: string;
}

interface StaffPageProps {
  user?: UserSession | null;
}

const ROLES = [
  'ADMIN',
  'MANAGER',
  'MARKETER',
  'AUDITOR',
  'DATA ENTRY OPERATOR',
  'TALLY OPERATOR',
];

const W_MODES = [
  'NONE',
  'COMMAN',
  'WHATSAPP',
  'CALLING',
];

const formatStaffDate = (dateStr?: string) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const strHours = String(hours).padStart(2, '0');
    return `${day}-${month}-${year} ${strHours}:${minutes} ${ampm}`;
  } catch {
    return dateStr;
  }
};

export const StaffPage: React.FC<StaffPageProps> = ({ user }) => {
  // Action menu's Delete is for DEVELOPER only (the API refuses everyone else too)
  const canDeleteStaff = (user?.roleName || '').toUpperCase() === 'DEVELOPER';
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  // Staff Update popup (Action -> Edit): Info / Password tabs, as live
  const [editTab, setEditTab] = useState<'Info' | 'Password'>('Info');
  const [editSaving, setEditSaving] = useState(false);

  // Add Staff popup keyboard flow: opens on Staff Name; Enter walks Staff Name -> Role -> W-Mode
  // -> Username -> Password -> Agent -> Mobile -> Address -> Save (highlighted), and Enter on Save
  // saves. Role / W-Mode change with the Up/Down arrows as usual for a select.
  const handleAddStaffKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if ((target as HTMLButtonElement).type === 'submit') return; // Enter on Save submits
    e.preventDefault();
    const fields = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('input, select, button[type="submit"]')
    ).filter((el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null);
    const next = fields[fields.indexOf(target) + 1];
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    }
  };
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  // Staff Update popup (Action -> Edit) closes on Esc
  useEffect(() => {
    if (!showModal || editingStaffId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showModal, editingStaffId]);

  // Add Staff popup opens with the cursor in Staff Name
  useEffect(() => {
    if (!showModal || editingStaffId !== null) return;
    const id = requestAnimationFrame(() => document.getElementById('staff-add-name')?.focus());
    return () => cancelAnimationFrame(id);
  }, [showModal, editingStaffId]);
  const [actionMenuOpenId, setActionMenuOpenId] = useState<number | null>(null);
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);

  // Form State matching pbmax1.com Image 3
  const [staffName, setStaffName] = useState('');
  const [role, setRole] = useState('ADMIN');
  const [wMode, setWMode] = useState('NONE');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('123456');
  const [agent, setAgent] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');

  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<StaffItem[]>('/staff');
      if (res.data) {
        setStaffList(res.data);
      }
    } catch (err) {
      console.warn('Failed to load staff:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await apiRequest<any[]>('/agents');
      if (res.data) {
        const names = res.data.map((a: any) => a.agentName).filter(Boolean);
        const combined = Array.from(new Set([...names, 'BOOOK SALARIES', 'VIKAS CASH', 'ROYAL AGENT']));
        setAvailableAgents(combined);
      }
    } catch {
      setAvailableAgents(['BOOOK SALARIES', 'VIKAS CASH', 'ROYAL AGENT']);
    }
  };

  useEffect(() => {
    fetchStaff();
    fetchAgents();
  }, []);

  // Keyboard Shortcuts: F2 opens modal, F5 reloads, Escape closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        openCreateModal();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        fetchStaff();
      }
      if (e.key === 'Escape' && showModal) {
        e.preventDefault();
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  // Close action menu on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      setActionMenuOpenId(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const openCreateModal = () => {
    setEditingStaffId(null);
    setStaffName('');
    setRole('ADMIN');
    setWMode('NONE');
    setUsername('');
    setPassword('123456');
    setAgent('');
    setMobile('');
    setAddress('');
    setShowModal(true);
  };

  const openEditModal = (item: StaffItem) => {
    setEditingStaffId(item.id);
    setStaffName(item.fullName || item.partyName || '');
    setRole(item.role || item.designation || 'ADMIN');
    setWMode(item.wMode || 'NONE');
    setUsername(item.username === 'NONE' ? '' : item.username || '');
    setPassword('123456');
    setAgent(item.agent || '');
    setMobile(item.mobile || '');
    setAddress(item.address || '');
    setEditTab('Info');
    setShowModal(true);
    setActionMenuOpenId(null);
  };

  // Staff Update -> Info tab Save: Role / W-Mode / Agent / Mobile / Address only (no Username
  // field here, as live — the login username stays as it is).
  // The password is NOT sent here (it used to go out as "123456" on every edit, resetting it) —
  // it changes only from the Password tab.
  const handleSaveStaffInfo = async () => {
    if (!editingStaffId) return;
    setEditSaving(true);
    try {
      await apiRequest(`/staff/${editingStaffId}`, {
        method: 'PUT',
        body: JSON.stringify({
          role,
          designation: role,
          wMode,
          agent: agent.trim().toUpperCase(),
          mobile: mobile.trim(),
          address: address.trim().toUpperCase(),
        }),
      });
      toast.success(
        <div>
          <div className="font-bold text-base">Success</div>
          <div className="text-sm mt-0.5">Staff info has been updated successfully!</div>
        </div>,
        { toastId: 'staff-info-saved' }
      );
      setShowModal(false);
      fetchStaff();
    } catch (err: any) {
      alert(err.message || 'Failed to update staff member');
    } finally {
      setEditSaving(false);
    }
  };

  // Staff Update -> Password tab Save: the password only
  const handleSaveStaffPassword = async () => {
    if (!editingStaffId) return;
    if (!password.trim()) {
      alert('Please enter a password');
      return;
    }
    setEditSaving(true);
    try {
      await apiRequest(`/staff/${editingStaffId}`, {
        method: 'PUT',
        body: JSON.stringify({ password: password.trim() }),
      });
      toast.success(
        <div>
          <div className="font-bold text-base">Success</div>
          <div className="text-sm mt-0.5">Staff info (Password) has been updated successfully!</div>
        </div>,
        { toastId: 'staff-password-saved' }
      );
      setShowModal(false);
      fetchStaff();
    } catch (err: any) {
      alert(err.message || 'Failed to change password');
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleActive = async (id: number) => {
    try {
      await apiRequest(`/staff/${id}/active`, {
        method: 'PATCH',
      });
      fetchStaff();
    } catch (err: any) {
      alert(err.message || 'Failed to update active status');
    }
  };

  const handleDeleteStaff = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to delete staff member "${name}"?`)) {
      return;
    }
    try {
      await apiRequest(`/staff/${id}`, {
        method: 'DELETE',
      });
      setActionMenuOpenId(null);
      fetchStaff();
    } catch (err: any) {
      alert(err.message || 'Failed to delete staff member');
    }
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    // Staff Name, Username and Password are required (live: "Invalid / Please enter all valid
    // fields!"); the cursor goes to the first one left empty.
    if (!staffName.trim() || !username.trim() || !password.trim()) {
      toast.error(
        <div>
          <div className="font-bold text-base">Invalid</div>
          <div className="text-sm mt-0.5">Please enter all valid fields!</div>
        </div>,
        { toastId: 'staff-invalid-fields' }
      );
      const firstEmpty = !staffName.trim() ? 'staff-add-name' : !username.trim() ? 'staff-add-username' : 'staff-add-password';
      document.getElementById(firstEmpty)?.focus();
      return;
    }

    try {
      const payload = {
        fullName: staffName.trim().toUpperCase(),
        role,
        designation: role,
        wMode,
        username: username.replace(/\s+/g, '').toUpperCase() || 'NONE',
        password: password.trim() || '123456',
        agent: agent.trim().toUpperCase(),
        mobile: mobile.trim(),
        address: address.trim().toUpperCase(),
      };

      if (editingStaffId) {
        await apiRequest(`/staff/${editingStaffId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/staff', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      setShowModal(false);
      fetchStaff();
    } catch (err: any) {
      alert(err.message || 'Failed to save staff member');
    }
  };

  // SUPER ADMIN and DEVELOPER accounts are kept out of the Staff List (display only — the
  // accounts, their logins, roles and permissions are untouched, and other pages reading
  // /staff still get them). Applied before the search so they can't be searched into view.
  const HIDDEN_STAFF_ROLES = ['SUPER ADMIN', 'DEVELOPER'];
  const filteredStaff = staffList.filter((s) => {
    const staffRole = (s.role || s.designation || '').trim().toUpperCase();
    if (HIDDEN_STAFF_ROLES.includes(staffRole)) return false;
    const term = searchTerm.toLowerCase();
    return (
      (s.fullName && s.fullName.toLowerCase().includes(term)) ||
      (s.role && s.role.toLowerCase().includes(term)) ||
      (s.username && s.username.toLowerCase().includes(term)) ||
      (s.mobile && s.mobile.toLowerCase().includes(term)) ||
      (s.address && s.address.toLowerCase().includes(term)) ||
      (s.agent && s.agent.toLowerCase().includes(term)) ||
      (s.wMode && s.wMode.toLowerCase().includes(term)) ||
      (s.updatedBy && s.updatedBy.toLowerCase().includes(term))
    );
  })
    // Newest staff first — a just-created staff member shows at the top of the list
    .sort((a, b) => b.id - a.id);

  return (
    <div className="min-h-full bg-[#eaedf2] p-3 sm:p-4 flex flex-col justify-between text-slate-800 select-none font-sans">
      {/* Outer Card matching pbmax1.com */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden">
        {/* Subheader Filter Bar matching Image 2 */}
        <div className="p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
          <div className="flex items-center gap-4 text-xs">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Staff</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-semibold text-xs">Search</span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder=""
                className="w-44 sm:w-60 px-2.5 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-inner"
              />
            </div>
          </div>

          <button
            onClick={openCreateModal}
            className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center justify-center gap-1.5 shrink-0"
          >
            <span>Add (F2)</span>
          </button>
        </div>

        {/* 12-Column Staff Table matching Image 2 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2 px-2.5 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Party Name</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Role</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Username</th>
                <th className="py-2 px-3 border-r border-[#223b63]">W-Mode</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Mobile</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Address</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Agent</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center w-16">Active</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Updated By</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Updated Date</th>
                <th className="py-2 px-2.5 text-center w-20">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading && staffList.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-slate-400">
                    Loading staff records...
                  </td>
                </tr>
              ) : filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-slate-400">
                    No staff records found.
                  </td>
                </tr>
              ) : (
                filteredStaff.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    {/* Sr */}
                    <td className="py-1.5 px-2.5 text-center font-mono text-slate-600 border-r border-slate-200">
                      {idx + 1}
                    </td>

                    {/* Party Name */}
                    <td className="py-1.5 px-3.5 font-bold text-slate-900 uppercase tracking-tight border-r border-slate-200">
                      {s.fullName || s.partyName}
                    </td>

                    {/* Role */}
                    <td className="py-1.5 px-3 font-semibold text-slate-700 uppercase border-r border-slate-200">
                      {s.role || s.designation}
                    </td>

                    {/* Username */}
                    <td className="py-1.5 px-3 font-medium text-slate-700 uppercase border-r border-slate-200">
                      {s.username || 'NONE'}
                    </td>

                    {/* W-Mode */}
                    <td className="py-1.5 px-3 font-medium text-slate-700 uppercase border-r border-slate-200">
                      {s.wMode || 'NONE'}
                    </td>

                    {/* Mobile */}
                    <td className="py-1.5 px-3 font-mono text-slate-700 border-r border-slate-200">
                      {s.mobile || '-'}
                    </td>

                    {/* Address */}
                    <td className="py-1.5 px-3.5 text-slate-700 uppercase border-r border-slate-200">
                      {s.address || '-'}
                    </td>

                    {/* Agent */}
                    <td className="py-1.5 px-3 font-semibold text-slate-700 uppercase border-r border-slate-200">
                      {s.agent || '-'}
                    </td>

                    {/* Active */}
                    <td className="py-1.5 px-2.5 text-center border-r border-slate-200">
                      <span
                        onClick={() => handleToggleActive(s.id)}
                        title="Click to toggle active status"
                        className={`inline-block min-w-10 px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer transition-transform active:scale-95 ${
                          s.isActive
                            ? 'bg-[#00897b] text-white'
                            : 'bg-[#d32f2f] text-white'
                        }`}
                      >
                        {s.isActive ? 'Yes' : 'No'}
                      </span>
                    </td>

                    {/* Updated By */}
                    <td className="py-1.5 px-3 font-semibold text-slate-700 uppercase border-r border-slate-200">
                      {s.updatedBy || 'A100'}
                    </td>

                    {/* Updated Date */}
                    <td className="py-1.5 px-3.5 font-mono text-slate-600 text-[11px] border-r border-slate-200">
                      {formatStaffDate(s.updatedAt)}
                    </td>

                    {/* Action */}
                    <td className="py-1.5 px-2.5 text-center relative">
                      <div className="inline-block relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionMenuOpenId(actionMenuOpenId === s.id ? null : s.id);
                          }}
                          className="px-2.5 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white rounded text-[10px] font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          Action
                        </button>

                        {/* Action Menu Dropdown */}
                        {actionMenuOpenId === s.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 mt-1 w-32 bg-white border border-slate-200 rounded shadow-xl py-1 z-30 text-xs text-left"
                          >
                            <button
                              type="button"
                              onClick={() => openEditModal(s)}
                              className="w-full px-3 py-1.5 hover:bg-blue-50 text-slate-800 flex items-center gap-2 font-medium"
                            >
                              <Edit2 className="h-3.5 w-3.5 text-blue-600" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleActive(s.id)}
                              className="w-full px-3 py-1.5 hover:bg-slate-50 text-slate-800 flex items-center gap-2 font-medium"
                            >
                              <span className="text-xs">🔄</span>
                              <span>{s.isActive ? 'Deactivate' : 'Activate'}</span>
                            </button>
                            {canDeleteStaff && (
                            <button
                              type="button"
                              onClick={() => handleDeleteStaff(s.id, s.fullName)}
                              className="w-full px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2 font-medium"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                              <span>Delete</span>
                            </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>

            {/* Table Footer matching Image 2 */}
            <tfoot>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center font-mono">
                  {filteredStaff.length || 11}
                </th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Party Name</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Role</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Username</th>
                <th className="py-2 px-3 border-r border-[#223b63]">W-Mode</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Mobile</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Address</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Agent</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Active</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Updated By</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Updated Date</th>
                <th className="py-2 px-2.5 text-center">Action</th>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Bottom Help Bar matching Image 2 */}
        <div className="p-2.5 bg-[#f8fafc] border-t border-slate-200 text-slate-500 text-xs font-semibold">
          <span className="hover:text-slate-800 cursor-pointer">Need Help?</span>
        </div>
      </div>

      {/* Staff Update popup (Action -> Edit), as live: "Staff Update | NAME" with Info / Password */}
      {showModal && editingStaffId !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 overflow-y-auto">
          <div className="bg-white rounded shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-300 my-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-[#152847] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide">Staff Update | {staffName}</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-semibold">
              {(['Info', 'Password'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setEditTab(tab)}
                  className={`px-5 py-2 border-b-2 transition-colors ${
                    editTab === tab ? 'border-[#152847] text-[#152847] bg-white' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {editTab === 'Info' ? (
              <div className="p-4 space-y-3.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded font-bold text-slate-800 text-xs focus:outline-none focus:border-blue-500 uppercase"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">W-Mode</label>
                    <select
                      value={wMode}
                      onChange={(e) => setWMode(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded font-bold text-slate-800 text-xs focus:outline-none focus:border-blue-500 uppercase"
                    >
                      {W_MODES.map((wm) => (
                        <option key={wm} value={wm}>{wm}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Agent</label>
                    <input
                      type="text"
                      list="staff-agents-list-edit"
                      value={agent}
                      onChange={(e) => setAgent(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                    />
                    <datalist id="staff-agents-list-edit">
                      {availableAgents.map((ag) => (
                        <option key={ag} value={ag} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Mobile</label>
                    <input
                      type="text"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="MOBILE"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono text-slate-800 text-xs placeholder:text-slate-300 placeholder:font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Address</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="ADDRESSS"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs uppercase placeholder:text-slate-300 placeholder:font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={handleSaveStaffInfo}
                  className="w-full sm:w-1/4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs transition-colors shadow-xs disabled:opacity-50"
                >
                  {editSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-3 text-xs max-w-xs">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Password</label>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-bold text-slate-800 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={handleSaveStaffPassword}
                  className="w-full py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs transition-colors shadow-xs disabled:opacity-50"
                >
                  {editSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Staff Add Modal matching Image 3 */}
      {showModal && editingStaffId === null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 overflow-y-auto">
          <div className="bg-white rounded shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-300 my-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header matching Image 3 */}
            <div className="bg-[#152847] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide">Staff</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body Form matching Image 3 */}
            <form onSubmit={handleSaveStaff} onKeyDown={handleAddStaffKeyDown}>
              <div className="p-4 space-y-3.5 text-xs">
                {/* Row 1: Staff Name (yellow), Role, W-Mode */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-6">
                    <label className="block text-slate-700 font-medium mb-1">
                      Staff Name
                    </label>
                    <input
                      id="staff-add-name"
                      type="text"
                      autoFocus
                      value={staffName}
                      onChange={(e) => setStaffName(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-slate-700 font-medium mb-1">
                      Role
                    </label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded font-bold text-slate-800 text-xs focus:outline-none focus:border-blue-500 uppercase"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-slate-700 font-medium mb-1">
                      W-Mode
                    </label>
                    <select
                      value={wMode}
                      onChange={(e) => setWMode(e.target.value)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded font-bold text-slate-800 text-xs focus:outline-none focus:border-blue-500 uppercase"
                    >
                      {W_MODES.map((wm) => (
                        <option key={wm} value={wm}>
                          {wm}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 2: Username, Password, Agent, Mobile */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Username
                    </label>
                    <input
                      id="staff-add-username"
                      type="text"
                      value={username}
                      // No spaces in a login username — typed or pasted spaces are dropped
                      onChange={(e) => setUsername(e.target.value.replace(/\s+/g, ''))}
                      placeholder="USERNAME"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 placeholder:text-slate-300 placeholder:font-bold uppercase focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Password
                    </label>
                    <input
                      id="staff-add-password"
                      type="text"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="123456"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-bold text-slate-800 text-xs focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Agent
                    </label>
                    {/* Agent list on focus; ↑/↓ writes the highlighted agent in, Enter keeps it and
                        moves on (an empty box just moves on) */}
                    <PartyNameInput
                      id="staff-add-agent"
                      value={agent}
                      onChange={setAgent}
                      names={availableAgents}
                      pickOnEmpty={false}
                      fillOnArrow
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500 focus:bg-[#fde68a]"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-medium mb-1">
                      Mobile
                    </label>
                    <input
                      type="text"
                      value={mobile}
                      inputMode="numeric"
                      maxLength={10}
                      // Digits only, at most 10 — letters / symbols / an 11th digit are dropped
                      onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="MOBILE"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded font-mono text-slate-800 text-xs placeholder:text-slate-300 placeholder:font-bold focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Row 3: Address (matching Image 3 width) */}
                <div className="w-full sm:w-[28%]">
                  <label className="block text-slate-700 font-medium mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="ADDRESSS"
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-slate-800 text-xs uppercase placeholder:text-slate-300 placeholder:font-bold focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Modal Footer matching Image 3 */}
              <div className="p-3 bg-white border-t border-slate-200 flex justify-end items-center gap-3">
                <button
                  type="submit"
                  className="px-6 py-1.5 bg-[#152847] hover:bg-[#1e3a68] active:bg-[#0f1d33] text-white font-bold rounded text-xs transition-colors shadow-xs outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#152847]"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 text-slate-700 hover:text-slate-900 font-semibold text-xs transition-colors"
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
