import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api/client.js';
import { toast } from 'react-toastify';
import { LedgerDto } from '@pb/types';
import { PartyPicker } from '../components/PartyPicker.js';
import { X, Trash2, Edit2, Plus } from 'lucide-react';

interface AssetRecord {
  id: number;
  staffId: number;
  staffName?: string;
  partyName?: string;
  assetName: string;
  amount: number;
  type: string;
  brand: string;
  serialNumber?: string;
  remark: string;
  assignedDate: string;
  returnDate?: string | null;
  notes?: string;
  updatedBy?: string;
  createdAt: string;
}

interface SalaryItem {
  item: string;
  amount: number;
  type: string;
}

interface StaffSalaryAssetItem {
  id: number;
  userId: number;
  fullName: string;
  partyName: string;
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
  monthlySalary: number;
  salaryStructure?: {
    earnings?: SalaryItem[];
    deductions?: SalaryItem[];
  };
  hasSalary: boolean;
  hasAssets: boolean;
  isWorkingLive: boolean;
  assignedStation: string;
  createdAt: string;
  assets?: AssetRecord[];
}

const ASSET_OPTIONS = [
  'LAPTOP',
  'KEYBOARD',
  'MOUSE',
  'MOBILE',
  'DATACABLE',
  'SIM',
  'INVERTOR',
  'CAR',
];

const EARNING_ITEM_OPTIONS = [
  'BASE SALARY',
  'BOUNS NO LEAVE',
  'MOBILE RECH.',
  'BOUNS',
  'GIFT',
  'BRODBAND',
  'TRAVLING',
];

const DEDUCTION_ITEM_OPTIONS = [
  'LOAN',
  'FINE',
  'ADVANCE',
  'PENALTY',
  'LEAVE DEDUCTION',
  'OTHER DEDUCTION',
];

const CALC_TYPES = ['AMOUNT', 'PERCENT', 'PER COUNT'];

const formatUpdatedDate = (dateStr?: string) => {
  if (!dateStr) return '02-01-2025 04:57 PM';
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

export const StaffAssetsPage: React.FC = () => {
  const [staffList, setStaffList] = useState<StaffSalaryAssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  // Rows Search fetched from the server for the searched staff (null = no search -> everyone)
  const [searchedRows, setSearchedRows] = useState<StaffSalaryAssetItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'assets' | 'salary'>('assets');
  const [actionMenuOpenId, setActionMenuOpenId] = useState<number | null>(null);

  // Selected Party in Modal
  const [selectedStaffId, setSelectedStaffId] = useState<number>(0);

  // Form State under Assets Tab (matching pbmax1 Image 1)
  const [selectedAsset, setSelectedAsset] = useState('LAPTOP');
  const [assetAmount, setAssetAmount] = useState('');
  const [issueType, setIssueType] = useState('Issue'); // Issue or Return
  const [brand, setBrand] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [remark, setRemark] = useState('');

  // Form State under Salary Tab (matching pbmax1 Image 2, 3, 4)
  // 1. Current inputs for new Earning row
  const [newEarningItem, setNewEarningItem] = useState('BASE SALARY');
  const [newEarningAmount, setNewEarningAmount] = useState('');
  const [newEarningType, setNewEarningType] = useState('AMOUNT');

  // 2. Current inputs for new Deduction row
  const [newDeductionItem, setNewDeductionItem] = useState('LOAN');
  const [newDeductionAmount, setNewDeductionAmount] = useState('');
  const [newDeductionType, setNewDeductionType] = useState('AMOUNT');

  // 3. Saved lists for Earning and Deduction
  const [earningsList, setEarningsList] = useState<SalaryItem[]>([]);
  const [deductionsList, setDeductionsList] = useState<SalaryItem[]>([]);
  const [structureSaving, setStructureSaving] = useState(false);
  // Add (F2) opens the popup with an empty, searchable Party box (as live); Action opens it on
  // its row's staff, shown read-only
  const [partyPickMode, setPartyPickMode] = useState(false);
  const [partyQuery, setPartyQuery] = useState('');
  const [partyListOpen, setPartyListOpen] = useState(false);
  const [partyHi, setPartyHi] = useState(0);
  const staffLabel = (st: StaffSalaryAssetItem) => st.fullName || st.partyName || '';
  const partyMatches = partyQuery.trim()
    ? staffList.filter(st => staffLabel(st).toUpperCase().includes(partyQuery.trim().toUpperCase()))
    : staffList;
  // Live red "Message" toast for the popup's checks
  const popupToast = (text: string, id: string) =>
    toast.error(
      <div>
        <div className="font-bold text-base">Message</div>
        <div className="text-sm mt-0.5">{text}</div>
      </div>,
      { toastId: id }
    );
  // A staff's saved salary structure, loaded into the Earning / Deduction lists (live shows the
  // already-saved rows, e.g. BASE SALARY 15000)
  const loadStructureOf = (st?: StaffSalaryAssetItem) => {
    setEarningsList(st?.salaryStructure?.earnings ? [...st.salaryStructure.earnings] : []);
    setDeductionsList(st?.salaryStructure?.deductions ? [...st.salaryStructure.deductions] : []);
  };
  // Popup Enter flow (as live): Party -> the open tab's first box; Assets: Assets -> Amount ->
  // Type -> Brand -> Serial No -> Remark -> Save; Salary: Items -> Amount -> Type -> "+" (each
  // of Earning / Deduction). Enter on a button presses it.
  const focusGroupStart = (group: 'assets' | 'earning' | 'deduction') => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-sa-group="${group}"] select, [data-sa-group="${group}"] input`);
      el?.focus();
    });
  };
  const handlePopupEnter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'BUTTON') return;
    const group = t.closest('[data-sa-group]');
    if (!group) return;
    e.preventDefault();
    const items = Array.from(group.querySelectorAll<HTMLElement>('input, select, button'))
      .filter(el => !(el as HTMLInputElement).readOnly && !(el as HTMLButtonElement).disabled && !el.hidden);
    const next = items[items.indexOf(t) + 1];
    next?.focus();
    if (next instanceof HTMLInputElement) next.select();
  };
  const pickParty = (st: StaffSalaryAssetItem) => {
    setSelectedStaffId(st.id);
    setPartyQuery(staffLabel(st));
    setPartyListOpen(false);
    loadStructureOf(st);
    focusGroupStart(activeTab === 'salary' ? 'earning' : 'assets');
  };

  const searchInputRef = useRef<HTMLInputElement>(null);
  // Search box lists the party names that start with the typed text (as live); picking one
  // moves to Search, which reloads with a spinner
  const [searchParties, setSearchParties] = useState<LedgerDto[]>([]);
  useEffect(() => {
    apiRequest<LedgerDto[]>('/ledgers')
      .then(res => { if (res.data) setSearchParties(res.data); })
      .catch(err => console.warn('Failed to load parties:', err));
  }, []);
  // Page opens with the cursor in Search (as live)
  useEffect(() => {
    const id = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<StaffSalaryAssetItem[]>('/staff');
      if (res.data) {
        setStaffList(res.data);
        if (res.data.length > 0 && !selectedStaffId) {
          const first = res.data[0];
          setSelectedStaffId(first.id);
        }
      }
    } catch (err) {
      console.warn('Failed to load staff salary/assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStaffSalaryStructure = (_staffItem?: StaffSalaryAssetItem) => {
    setEarningsList([]);
    setDeductionsList([]);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Close action dropdown on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      setActionMenuOpenId(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Keyboard Shortcuts: F2 opens modal, F5 reloads, Escape closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        openModal();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        fetchData();
      }
      if (e.key === 'Escape' && showModal) {
        e.preventDefault();
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const openModal = (staffItem?: StaffSalaryAssetItem, tab: 'assets' | 'salary' = 'assets') => {
    // Add (F2): no party yet, typed / picked in the popup. Action: the row's staff.
    setPartyPickMode(!staffItem);
    setPartyQuery('');
    setPartyListOpen(false);
    setPartyHi(0);
    setSelectedStaffId(staffItem ? staffItem.id : 0);

    // Lists start from the chosen staff's own saved structure (empty until a party is picked);
    // never another staff's leftovers
    loadStructureOf(staffItem);
    // Action (party already known): the cursor starts in the open tab's first box
    if (staffItem) focusGroupStart(tab === 'salary' ? 'earning' : 'assets');

    setActiveTab(tab);
    setSelectedAsset('LAPTOP');
    setAssetAmount('');
    setIssueType('Issue');
    setBrand('');
    setSerialNo('');
    setRemark('');
    setNewEarningAmount('');
    setNewDeductionAmount('');
    setNewEarningItem('BASE SALARY');
    setNewDeductionItem('LOAN');
    setNewEarningType('AMOUNT');
    setNewDeductionType('AMOUNT');
    setShowModal(true);
    setActionMenuOpenId(null);
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || searching) return;
    const term = searchTerm.trim();
    setSubmittedSearch(term);
    if (!term) {
      // Empty Search: everyone again (full reload)
      setSearchedRows(null);
      fetchData();
      return;
    }
    // Live: Search asks the server for just the searched staff (spinner while it runs)
    setSearching(true);
    try {
      const res = await apiRequest<StaffSalaryAssetItem[]>(`/staff?search=${encodeURIComponent(term)}`);
      setSearchedRows(res.data || []);
      if (!res.data || res.data.length === 0) {
        toast.error(
          <div>
            <div className="font-bold text-base">Error</div>
            <div className="text-sm mt-0.5">Record not avaliable!</div>
          </div>,
          { toastId: 'staff-assets-search-none' }
        );
      }
    } catch (err) {
      console.warn('Failed to search staff:', err);
    } finally {
      setSearching(false);
    }
  };

  // Add Earning row on click '+'
  const handleAddEarningRow = () => {
    if (!selectedStaffId) return popupToast('Please select a valid party!', 'salary-no-party');
    // Live: the same item can't be added twice
    if (earningsList.some(r => r.item.toUpperCase() === newEarningItem.toUpperCase())) {
      return popupToast('Selected item is already exist!', 'salary-earning-dup');
    }
    const amt = parseFloat(newEarningAmount || '0');
    focusGroupStart('earning');
    setEarningsList(prev => [
      ...prev,
      { item: newEarningItem, amount: amt, type: newEarningType },
    ]);
    setNewEarningAmount('');
  };

  // Remove Earning row on click 'x'
  const handleRemoveEarningRow = (index: number) => {
    setEarningsList(prev => prev.filter((_, i) => i !== index));
  };

  // Add Deduction row on click '+'
  const handleAddDeductionRow = () => {
    if (!selectedStaffId) return popupToast('Please select a valid party!', 'salary-no-party');
    if (deductionsList.some(r => r.item.toUpperCase() === newDeductionItem.toUpperCase())) {
      return popupToast('Selected item is already exist!', 'salary-deduction-dup');
    }
    const amt = parseFloat(newDeductionAmount || '0');
    focusGroupStart('deduction');
    setDeductionsList(prev => [
      ...prev,
      { item: newDeductionItem, amount: amt, type: newDeductionType },
    ]);
    setNewDeductionAmount('');
  };

  // Remove Deduction row on click 'x'
  const handleRemoveDeductionRow = (index: number) => {
    setDeductionsList(prev => prev.filter((_, i) => i !== index));
  };

  // Save Complete Structure (PATCH /staff/:id/salary with { earnings, deductions })
  const handleSaveCompleteStructure = async () => {
    if (!selectedStaffId) {
      popupToast('Please select a valid party!', 'salary-no-party');
      return;
    }
    setStructureSaving(true);
    try {
      await apiRequest(`/staff/${selectedStaffId}/salary`, {
        method: 'PATCH',
        body: JSON.stringify({
          earnings: earningsList,
          deductions: deductionsList,
        }),
      });
      fetchData();
      alert('Complete salary structure saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to save salary structure');
    } finally {
      setStructureSaving(false);
    }
  };

  // Handle Save Asset (POST /staff/assets)
  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId) {
      popupToast('Please select a valid party!', 'asset-no-party');
      return;
    }

    if (!window.confirm('Save Action : Are you are?')) return;

    try {
      await apiRequest('/staff/assets', {
        method: 'POST',
        body: JSON.stringify({
          staffId: selectedStaffId,
          assetName: selectedAsset,
          amount: parseFloat(assetAmount || '0'),
          type: issueType,
          brand: brand.trim().toUpperCase(),
          serialNumber: serialNo.trim().toUpperCase(),
          remark: remark.trim(),
        }),
      });

      setAssetAmount('');
      setBrand('');
      setSerialNo('');
      setRemark('');
      fetchData();
      // Saved: green toast, then the popup closes (as live)
      toast.success(
        <div>
          <div className="font-bold text-base">Success</div>
          <div className="text-sm mt-0.5">Staff assets has been saved successfully!</div>
        </div>,
        { toastId: `asset-saved-${Date.now()}` }
      );
      setShowModal(false);
    } catch (err: any) {
      alert(err.message || 'Failed to save asset');
    }
  };

  // Handle Delete Asset
  const handleDeleteAsset = async (assetId: number) => {
    if (!window.confirm('Are you sure you want to delete this asset record?')) return;
    try {
      await apiRequest(`/staff/assets/${assetId}`, {
        method: 'DELETE',
      });
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete asset');
    }
  };

  const currentSelectedStaff = staffList.find(s => s.id === selectedStaffId);

  // The table filters by what was searched — typing alone doesn't change it; Search (Enter /
  // click) applies the box, and Search on an empty box shows everyone again
  const activeSearch = submittedSearch;
  // After a Search the table shows the server's rows for it; otherwise the full list. The
  // fresh copy of each searched row (after a save / reload) is taken from the full list.
  const tableSource = searchedRows
    ? searchedRows.map(r => staffList.find(st => st.id === r.id) || r)
    : staffList;
  const filteredStaff = tableSource.filter(s => {
    const term = activeSearch.toLowerCase().trim();
    if (!term) return true;
    return (
      (s.fullName && s.fullName.toLowerCase().includes(term)) ||
      (s.partyName && s.partyName.toLowerCase().includes(term)) ||
      (s.role && s.role.toLowerCase().includes(term)) ||
      (s.username && s.username.toLowerCase().includes(term)) ||
      (s.updatedBy && s.updatedBy.toLowerCase().includes(term))
    );
  });

  return (
    <div className="min-h-full bg-[#eaedf2] p-3 sm:p-4 flex flex-col justify-between text-slate-800 select-none font-sans">
      {/* Outer Card matching pbmax1.com Image 1 */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden">
        {/* Subheader Filter Bar */}
        <div className="p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-3 text-xs">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">
              Staff Salary/Assets
            </span>
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-medium text-xs">Search</span>
              <div className="w-44 sm:w-64">
                <PartyPicker
                  // Suggestions are this page's own staff names (B24, B21, ...) — the list the
                  // table shows — not the ledger master
                  parties={staffList.map(st => ({ id: st.id, partyName: st.fullName || st.partyName || '' }) as unknown as LedgerDto).filter(p => p.partyName)}
                  value={searchTerm}
                  onChange={setSearchTerm}
                  onPick={(p) => { setSearchTerm(p.partyName); document.getElementById('sa-search-btn')?.focus(); }}
                  onInvalid={() => document.getElementById('sa-search-btn')?.focus()}
                  inputRef={searchInputRef}
                  className="w-full px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:bg-[#fde68a] focus:border-amber-300 shadow-xs"
                />
              </div>
            </div>
            <button
              id="sa-search-btn"
              type="submit"
              disabled={loading || searching}
              className="px-4 py-1 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#1662c6] disabled:opacity-80 inline-flex items-center gap-1.5"
            >
              Search
              {/* Spinner while the list reloads, as on live */}
              {(loading || searching) && <span className="inline-block h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            </button>
          </form>

          <button
            onClick={() => openModal()}
            className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center justify-center gap-1.5 shrink-0"
          >
            <span>Add (F2)</span>
          </button>
        </div>

        {/* 8-Column Table matching pbmax1 Image 1 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2 px-2.5 border-r border-[#223b63] w-12 text-center">Sr</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Party Name</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Role</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Username</th>
                <th className="py-2 px-3.5 border-r border-[#223b63] text-center w-20">Salary</th>
                <th className="py-2 px-3.5 border-r border-[#223b63] text-center w-20">Assets</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Updated</th>
                <th className="py-2 px-2.5 text-center w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {loading && staffList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    Loading staff salary/assets...
                  </td>
                </tr>
              ) : filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
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
                    <td className="py-1.5 px-3.5 font-semibold uppercase text-slate-700 border-r border-slate-200">
                      {s.role || s.designation}
                    </td>

                    {/* Username */}
                    <td className="py-1.5 px-3.5 font-semibold text-slate-700 border-r border-slate-200">
                      {s.username === 'NONE' ? '-' : s.username}
                    </td>

                    {/* Salary Badge */}
                    <td className="py-1.5 px-3.5 text-center border-r border-slate-200">
                      <span
                        onClick={() => openModal(s, 'salary')}
                        title={`Click to manage salary: ₹${s.monthlySalary}`}
                        className={`inline-block min-w-10 px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer transition-transform active:scale-95 ${
                          s.hasSalary || s.monthlySalary > 0
                            ? 'bg-[#00897b] text-white'
                            : 'bg-[#d32f2f] text-white'
                        }`}
                      >
                        {s.hasSalary || s.monthlySalary > 0 ? 'YES' : 'NO'}
                      </span>
                    </td>

                    {/* Assets Badge */}
                    <td className="py-1.5 px-3.5 text-center border-r border-slate-200">
                      <span
                        onClick={() => openModal(s, 'assets')}
                        title="Click to view/manage assets"
                        className={`inline-block min-w-10 px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer transition-transform active:scale-95 ${
                          s.hasAssets
                            ? 'bg-[#00897b] text-white'
                            : 'bg-[#d32f2f] text-white'
                        }`}
                      >
                        {s.hasAssets ? 'YES' : 'NO'}
                      </span>
                    </td>

                    {/* Updated (Two-line cell matching Image 1) */}
                    <td className="py-1 px-3.5 border-r border-slate-200">
                      <div className="font-semibold text-slate-800 text-[11px] uppercase">
                        {s.updatedBy || 'A100'}
                      </div>
                      <div className="font-mono text-slate-500 text-[10px]">
                        {formatUpdatedDate(s.updatedAt || s.createdAt)}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-1.5 px-2.5 text-center relative">
                      <div className="inline-block relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Live: Action opens the STAFF SALARY/ASSETS Manage popup directly on
                            // its Assets tab (Salary is the popup's second tab)
                            setActionMenuOpenId(null);
                            openModal(s, 'assets');
                          }}
                          className="px-2.5 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white rounded text-[10px] font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          Action
                        </button>

                        {/* Action Menu Dropdown */}
                        {actionMenuOpenId === s.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 mt-1 w-36 bg-white border border-slate-200 rounded shadow-xl py-1 z-30 text-xs text-left"
                          >
                            <button
                              type="button"
                              onClick={() => openModal(s, 'assets')}
                              className="w-full px-3 py-1.5 hover:bg-blue-50 text-slate-800 flex items-center gap-2 font-medium"
                            >
                              <Edit2 className="h-3.5 w-3.5 text-blue-600" />
                              <span>Manage Assets</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openModal(s, 'salary')}
                              className="w-full px-3 py-1.5 hover:bg-emerald-50 text-slate-800 flex items-center gap-2 font-medium"
                            >
                              <Edit2 className="h-3.5 w-3.5 text-emerald-600" />
                              <span>Manage Salary</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>

            {/* Table Footer matching pbmax1 Image 1 */}
            <tfoot>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center font-mono">
                  {filteredStaff.length}
                </th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Party Name</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Role</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Username</th>
                <th className="py-2 px-3.5 border-r border-[#223b63] text-center">Salary</th>
                <th className="py-2 px-3.5 border-r border-[#223b63] text-center">Assets</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Updated</th>
                <th className="py-2 px-2.5 text-center">Action</th>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Bottom Help Bar */}
        <div className="p-2.5 bg-[#f8fafc] border-t border-slate-200 text-slate-500 text-xs font-semibold">
          <span className="hover:text-slate-800 cursor-pointer">Need Help?</span>
        </div>
      </div>

      {/* STAFF SALARY/ASSETS Manage Modal matching pbmax1 Images 1, 2, 3, 4 */}
      {showModal && (
        <div
          // A click on the dimmed area outside the box closes the popup (as Esc / X / Close do);
          // only a press that starts AND ends there counts
          onMouseDown={(e) => { (e.currentTarget as HTMLElement).dataset.downOnBackdrop = e.target === e.currentTarget ? '1' : ''; }}
          onClick={(e) => { if (e.target === e.currentTarget && (e.currentTarget as HTMLElement).dataset.downOnBackdrop === '1') setShowModal(false); }}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 overflow-y-auto"
        >
          <div className="bg-white rounded shadow-2xl max-w-5xl w-full overflow-hidden border border-slate-300 my-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header matching Screenshot */}
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide uppercase">
                STAFF SALARY/ASSETS Manage
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-0.5 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 text-xs" onKeyDown={handlePopupEnter}>
              {/* Party Selection Field matching Screenshot 1 */}
              <div className="flex items-center gap-3">
                <label className="text-slate-700 font-bold text-xs min-w-12">
                  Party
                </label>
                <div className="relative max-w-xs w-full">
                  {partyPickMode ? (
                    <>
                      {/* Add (F2): type to search the staff list; arrows + Enter / click pick */}
                      <input
                        type="text"
                        autoFocus
                        value={partyQuery}
                        onChange={(e) => { setPartyQuery(e.target.value); setSelectedStaffId(0); loadStructureOf(undefined); setPartyListOpen(true); setPartyHi(0); }}
                        onFocus={() => setPartyListOpen(true)}
                        onBlur={() => setTimeout(() => setPartyListOpen(false), 150)}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            setPartyListOpen(true);
                            setPartyHi(i => e.key === 'ArrowDown' ? Math.min(i + 1, Math.max(partyMatches.length - 1, 0)) : Math.max(i - 1, 0));
                          } else if (e.key === 'Enter') {
                            e.preventDefault();
                            const st = partyMatches[partyHi];
                            if (partyListOpen && st) pickParty(st);
                            else if (!selectedStaffId) popupToast('Please select a valid party!', 'asset-no-party');
                          } else if (e.key === 'Escape' && partyListOpen) {
                            e.stopPropagation();
                            setPartyListOpen(false);
                          }
                        }}
                        autoComplete="off"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:bg-[#fde68a] focus:border-amber-300"
                      />
                      {partyListOpen && partyMatches.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-0.5 bg-white border border-slate-400 shadow-xl z-50 max-h-56 overflow-y-auto">
                          {partyMatches.map((st, idx) => (
                            <div
                              key={st.id}
                              ref={idx === partyHi ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                              onMouseDown={(e) => { e.preventDefault(); pickParty(st); }}
                              onMouseEnter={() => setPartyHi(idx)}
                              className={`px-2.5 py-1 text-xs uppercase cursor-pointer ${idx === partyHi ? 'bg-[#f6c343] font-bold text-slate-900' : 'text-slate-800'}`}
                            >
                              {staffLabel(st)}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    /* Action: the party the popup was opened for, read-only (live) */
                    <input
                      type="text"
                      readOnly
                      value={(() => {
                        const cur = staffList.find(st => st.id === selectedStaffId);
                        return cur ? staffLabel(cur) : '';
                      })()}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none cursor-default"
                    />
                  )}
                  <select
                    hidden
                    value={selectedStaffId}
                    onChange={(e) => {
                      const id = parseInt(e.target.value, 10);
                      setSelectedStaffId(id);
                      setEarningsList([]);
                      setDeductionsList([]);
                      setNewEarningAmount('');
                      setNewDeductionAmount('');
                    }}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-900 uppercase focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id} className="bg-white text-slate-900 font-semibold">
                        {s.fullName || s.partyName} {s.username && s.username !== 'NONE' ? `(${s.username})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tabs matching Screenshot 1 & 2 */}
              <div className="flex border-b border-slate-200 gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('assets')}
                  className={`px-6 py-2 font-bold text-xs transition-colors border-b-2 cursor-pointer ${
                    activeTab === 'assets'
                      ? 'border-[#1662c6] text-[#1662c6]'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Assets
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('salary')}
                  className={`px-6 py-2 font-bold text-xs transition-colors border-b-2 cursor-pointer ${
                    activeTab === 'salary'
                      ? 'border-[#1662c6] text-[#1662c6]'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Salary
                </button>
              </div>

              {/* ======================================================== */}
              {/* TAB 1: ASSETS MANAGEMENT (Matching Image 1)               */}
              {/* ======================================================== */}
              {activeTab === 'assets' && (
                <div className="space-y-4">
                  {/* Form Strip with Dark Navy Headers matching Image 1 */}
                  <form onSubmit={handleSaveAsset} data-sa-group="assets">
                    <div className="border border-slate-300 rounded overflow-hidden shadow-xs">
                      {/* Strip Headers */}
                      <div className="bg-[#152847] text-white font-bold text-[11px] grid grid-cols-7 divide-x divide-[#223b63]">
                        <div className="py-2 px-2.5">Assets</div>
                        <div className="py-2 px-2.5">Amount</div>
                        <div className="py-2 px-2.5">Type</div>
                        <div className="py-2 px-2.5">Brand</div>
                        <div className="py-2 px-2.5">Serial No</div>
                        <div className="py-2 px-2.5">Remark</div>
                        <div className="py-2 px-2.5 text-center">Save</div>
                      </div>

                      {/* Strip Inputs matching Image 1 */}
                      <div className="bg-white grid grid-cols-7 divide-x divide-slate-200 p-1.5 items-center gap-1">
                        {/* 1. Assets Dropdown */}
                        <div className="px-1">
                          <select
                            value={selectedAsset}
                            onChange={(e) => setSelectedAsset(e.target.value)}
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                          >
                            {ASSET_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* 2. Amount Input */}
                        <div className="px-1">
                          <input
                            type="number"
                            value={assetAmount}
                            onChange={(e) => setAssetAmount(e.target.value)}
                            placeholder="AMOUNT"
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500 placeholder:text-slate-400 font-medium"
                          />
                        </div>

                        {/* 3. Type Dropdown */}
                        <div className="px-1">
                          <select
                            value={issueType}
                            onChange={(e) => setIssueType(e.target.value)}
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                          >
                            <option value="Issue">Issue</option>
                            <option value="Return">Return</option>
                          </select>
                        </div>

                        {/* 4. Brand Input */}
                        <div className="px-1">
                          <input
                            type="text"
                            value={brand}
                            onChange={(e) => setBrand(e.target.value)}
                            placeholder="BRAND"
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500 placeholder:text-slate-400"
                          />
                        </div>

                        {/* 5. Serial No Input */}
                        <div className="px-1">
                          <input
                            type="text"
                            value={serialNo}
                            onChange={(e) => setSerialNo(e.target.value)}
                            placeholder="SERIAL NO"
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500 placeholder:text-slate-400 font-mono"
                          />
                        </div>

                        {/* 6. Remark Input */}
                        <div className="px-1">
                          <input
                            type="text"
                            value={remark}
                            onChange={(e) => setRemark(e.target.value)}
                            placeholder="REMARK"
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500 placeholder:text-slate-400"
                          />
                        </div>

                        {/* 7. Save Button (Teal `#00897b`) */}
                        <div className="px-1 flex justify-center">
                          <button
                            type="submit"
                            className="w-full py-1.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow-xs transition-colors cursor-pointer"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  </form>

                  {/* Assigned Assets History Table */}
                  {currentSelectedStaff?.assets && currentSelectedStaff.assets.length > 0 && (
                    <div className="space-y-1.5 pt-2">
                      <h3 className="font-bold text-xs text-slate-700">
                        Assigned Assets for {currentSelectedStaff?.fullName}:
                      </h3>
                      <div className="border border-slate-200 rounded overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-100 text-slate-700 font-bold text-[11px] border-b border-slate-200">
                              <th className="py-1.5 px-2.5 w-10 text-center">Sr</th>
                              <th className="py-1.5 px-3">Asset</th>
                              <th className="py-1.5 px-2.5 text-center w-20">Type</th>
                              <th className="py-1.5 px-3">Brand</th>
                              <th className="py-1.5 px-3 font-mono">Serial No</th>
                              <th className="py-1.5 px-3 text-right">Amount</th>
                              <th className="py-1.5 px-3">Remark</th>
                              <th className="py-1.5 px-3 font-mono text-slate-500">Date</th>
                              <th className="py-1.5 px-2 text-center w-16">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-sans text-xs">
                            {currentSelectedStaff.assets.map((ast, i) => (
                              <tr key={ast.id} className="hover:bg-slate-50">
                                <td className="py-1.5 px-2.5 text-center font-mono text-slate-500">
                                  {i + 1}
                                </td>
                                <td className="py-1.5 px-3 font-bold text-slate-800 uppercase">
                                  {ast.assetName}
                                </td>
                                <td className="py-1.5 px-2.5 text-center">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                      ast.type === 'Return'
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-teal-100 text-teal-800'
                                    }`}
                                  >
                                    {ast.type}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 uppercase text-slate-700">
                                  {ast.brand || '-'}
                                </td>
                                <td className="py-1.5 px-3 font-mono text-slate-700">
                                  {ast.serialNumber || '-'}
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono font-semibold text-slate-800">
                                  {ast.amount ? `₹${ast.amount.toLocaleString('en-IN')}` : '-'}
                                </td>
                                <td className="py-1.5 px-3 text-slate-600">
                                  {ast.remark || ast.notes || '-'}
                                </td>
                                <td className="py-1.5 px-3 font-mono text-slate-500 text-[10px]">
                                  {formatUpdatedDate(ast.createdAt || ast.assignedDate)}
                                </td>
                                <td className="py-1.5 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAsset(ast.id)}
                                    title="Delete asset record"
                                    className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
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
              )}

              {/* ======================================================== */}
              {/* TAB 2: SALARY MANAGEMENT (Matching Images 2, 3, 4)        */}
              {/* ======================================================== */}
              {activeTab === 'salary' && (
                <div className="space-y-6 py-1">
                  {/* Two Side-by-Side Sections: Earning & Deduction matching Image 2 & 4 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* ----------------- LEFT: EARNING SECTION ----------------- */}
                    <div className="space-y-2.5">
                      <h3 className="text-base font-bold text-slate-900 tracking-tight">
                        Earning
                      </h3>

                      {/* Earning Header Strip & Inputs matching Image 2, 3, 4 */}
                      <div className="border border-slate-300 rounded overflow-hidden shadow-xs">
                        {/* Headers */}
                        <div className="bg-[#152847] text-white font-bold text-[11px] grid grid-cols-12 divide-x divide-[#223b63]">
                          <div className="col-span-5 py-2 px-2.5">Items</div>
                          <div className="col-span-3 py-2 px-2.5">Amount</div>
                          <div className="col-span-3 py-2 px-2.5">Type</div>
                          <div className="col-span-1 py-2 px-1 text-center"></div>
                        </div>

                        {/* Input Row */}
                        <div data-sa-group="earning" className="bg-white grid grid-cols-12 divide-x divide-slate-200 p-1 items-center gap-1">
                          {/* Items dropdown */}
                          <div className="col-span-5 px-1">
                            <select
                              value={newEarningItem}
                              onChange={(e) => setNewEarningItem(e.target.value)}
                              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                            >
                              {EARNING_ITEM_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Amount input */}
                          <div className="col-span-3 px-1">
                            <input
                              type="number"
                              value={newEarningAmount}
                              onChange={(e) => setNewEarningAmount(e.target.value)}
                              placeholder="AMOUNT"
                              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:border-blue-500 placeholder:text-slate-400 font-semibold"
                            />
                          </div>

                          {/* Type dropdown (AMOUNT, PERCENT, PER COUNT) */}
                          <div className="col-span-3 px-1">
                            <select
                              value={newEarningType}
                              onChange={(e) => setNewEarningType(e.target.value)}
                              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                            >
                              {CALC_TYPES.map(t => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* '+' Teal Square Button matching Image 4 */}
                          <div className="col-span-1 flex justify-center">
                            <button
                              type="button"
                              onClick={handleAddEarningRow}
                              title="Add Earning Item"
                              className="w-7 h-7 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white flex items-center justify-center font-bold text-sm rounded-xs shadow-xs transition-colors cursor-pointer"
                            >
                              <Plus className="h-4 w-4 stroke-[3]" />
                            </button>
                          </div>
                        </div>

                        {/* List of Added Earnings matching Image 4 */}
                        {earningsList.map((earning, idx) => (
                          <div
                            key={idx}
                            className="bg-white grid grid-cols-12 divide-x divide-slate-200 border-t border-slate-200 py-1.5 px-1 items-center text-xs font-medium text-slate-800"
                          >
                            <div className="col-span-5 px-2.5 font-bold uppercase">
                              {earning.item}
                            </div>
                            <div className="col-span-3 px-2.5 font-mono font-semibold">
                              {earning.amount}
                            </div>
                            <div className="col-span-3 px-2.5 uppercase font-semibold text-slate-600">
                              {earning.type}
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveEarningRow(idx)}
                                title="Remove Item"
                                className="w-5 h-5 bg-[#d32f2f] hover:bg-[#b71c1c] text-white flex items-center justify-center rounded-xs transition-colors cursor-pointer font-bold"
                              >
                                <X className="h-3.5 w-3.5 stroke-[3]" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ----------------- RIGHT: DEDUCTION SECTION ----------------- */}
                    <div className="space-y-2.5">
                      <h3 className="text-base font-bold text-slate-900 tracking-tight">
                        Deduction
                      </h3>

                      {/* Deduction Header Strip & Inputs matching Image 2, 3, 4 */}
                      <div className="border border-slate-300 rounded overflow-hidden shadow-xs">
                        {/* Headers */}
                        <div className="bg-[#152847] text-white font-bold text-[11px] grid grid-cols-12 divide-x divide-[#223b63]">
                          <div className="col-span-5 py-2 px-2.5">Items</div>
                          <div className="col-span-3 py-2 px-2.5">Amount</div>
                          <div className="col-span-3 py-2 px-2.5">Type</div>
                          <div className="col-span-1 py-2 px-1 text-center"></div>
                        </div>

                        {/* Input Row */}
                        <div data-sa-group="deduction" className="bg-white grid grid-cols-12 divide-x divide-slate-200 p-1 items-center gap-1">
                          {/* Items dropdown */}
                          <div className="col-span-5 px-1">
                            <select
                              value={newDeductionItem}
                              onChange={(e) => setNewDeductionItem(e.target.value)}
                              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                            >
                              {DEDUCTION_ITEM_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Amount input */}
                          <div className="col-span-3 px-1">
                            <input
                              type="number"
                              value={newDeductionAmount}
                              onChange={(e) => setNewDeductionAmount(e.target.value)}
                              placeholder="AMOUNT"
                              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-900 focus:outline-none focus:border-blue-500 placeholder:text-slate-400 font-semibold"
                            />
                          </div>

                          {/* Type dropdown (AMOUNT, PERCENT, PER COUNT) */}
                          <div className="col-span-3 px-1">
                            <select
                              value={newDeductionType}
                              onChange={(e) => setNewDeductionType(e.target.value)}
                              className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                            >
                              {CALC_TYPES.map(t => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* '+' Teal Square Button matching Image 4 */}
                          <div className="col-span-1 flex justify-center">
                            <button
                              type="button"
                              onClick={handleAddDeductionRow}
                              title="Add Deduction Item"
                              className="w-7 h-7 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white flex items-center justify-center font-bold text-sm rounded-xs shadow-xs transition-colors cursor-pointer"
                            >
                              <Plus className="h-4 w-4 stroke-[3]" />
                            </button>
                          </div>
                        </div>

                        {/* List of Added Deductions matching Image 4 */}
                        {deductionsList.map((deduction, idx) => (
                          <div
                            key={idx}
                            className="bg-white grid grid-cols-12 divide-x divide-slate-200 border-t border-slate-200 py-1.5 px-1 items-center text-xs font-medium text-slate-800"
                          >
                            <div className="col-span-5 px-2.5 font-bold uppercase">
                              {deduction.item}
                            </div>
                            <div className="col-span-3 px-2.5 font-mono font-semibold">
                              {deduction.amount}
                            </div>
                            <div className="col-span-3 px-2.5 uppercase font-semibold text-slate-600">
                              {deduction.type}
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveDeductionRow(idx)}
                                title="Remove Item"
                                className="w-5 h-5 bg-[#d32f2f] hover:bg-[#b71c1c] text-white flex items-center justify-center rounded-xs transition-colors cursor-pointer font-bold"
                              >
                                <X className="h-3.5 w-3.5 stroke-[3]" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Centered Teal Button: 'Save Complete Structure' matching Image 2, 3, 4 */}
                  <div className="pt-6 pb-2 flex justify-center">
                    <button
                      type="button"
                      disabled={structureSaving}
                      onClick={handleSaveCompleteStructure}
                      className="px-10 py-2.5 bg-[#00897b] hover:bg-[#00796b] active:bg-[#00695c] text-white font-bold text-xs rounded shadow transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {structureSaving ? 'Saving Structure...' : 'Save Complete Structure'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-white border-t border-slate-200 flex justify-end items-center">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-1.5 text-slate-700 hover:text-slate-900 font-semibold text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
