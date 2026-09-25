import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api/client.js';
import { Send, X } from 'lucide-react';

interface LedgerItem {
  id: number;
  partyName: string;
  realName?: string;
  userName?: string;
  groupName?: string;
  agentId?: number;
  agentName?: string;
  telegram?: string;
  mobile?: string;
  daraRate: number;
  akharRate: number;
  commissionRate: number;
  hissaPercentage: number;
  betLimit: number;
  capping: number;
  hasLimit: boolean;
  vapsiTpr: string;
  isLocked: boolean;
  isRisky: boolean;
  updatedBy: string;
  updatedAt: string;
  deletedAt?: string | null;
}

interface AgentOption {
  id: number;
  agentName: string;
}

interface LedgerDetail extends LedgerItem {
  distributorId?: number | null;
  retailerId?: number | null;
  refLedgerId?: number | null;
  hpLedgerId?: number | null;
  distributorName?: string | null;
  retailerName?: string | null;
  refLedgerName?: string | null;
  hpLedgerName?: string | null;
  address?: string;
  grantor?: string;
  dealing?: string;
  rebate?: number;
  dibba?: boolean;
  dAmt?: number;
  password?: string;
  isHidden?: boolean;
  masterLedgerConfig?: boolean;
  isTransactionAllow?: boolean;
}

interface ThirdPartyLink {
  id: number;
  ledgerId: number;
  linkType: 'HISSA' | 'TPC' | 'TPV';
  partyName: string;
  percent: number;
  dComm: number;
  aComm: number;
}

interface LinkedStats {
  inVoucher: number;
  totalDr: number;
  totalCr: number;
  inHissa: number;
  inTpc: number;
  inTpv: number;
  inHpLedger: number;
  linkedParties: string[];
}

const UPDATE_TABS = ['Info', 'Re-Name', 'Re-Config', 'Linked', 'Password', 'Account'] as const;
type UpdateTab = typeof UPDATE_TABS[number];

const GROUPS = [
  'Company',
  'Distributor',
  'Fanter',
  'Cash Agent',
  'Direct Expense',
  'Indirect Expense',
  'Profit & Loss',
];

// Percent/comm fields come back as DB numeric strings ("10.00") — the live reference shows
// them as plain numbers ("10"), so trailing decimal zeros are stripped for display only.
const numOnly = (v: any): string => {
  const n = parseFloat(v);
  return isNaN(n) ? String(v ?? '') : n.toString();
};

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return '01-07-2026 05:13 PM';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '01-07-2026 05:13 PM';

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
};

export const LedgersPage: React.FC = () => {
  const [ledgers, setLedgers] = useState<LedgerItem[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Filters matching pbmax1.com
  const [searchTerm, setSearchTerm] = useState('');
  const [cashAgentFilter, setCashAgentFilter] = useState('-- ALL --');
  const [agentFilter, setAgentFilter] = useState('-- ALL --');
  const [cappingFilter, setCappingFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('Active');
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);

  // Modal Form State (matching screenshots 3, 4, 5)
  const [partyName, setPartyName] = useState('');
  const [realName, setRealName] = useState('');
  const [userName, setUserName] = useState('');
  const [groupName, setGroupName] = useState('Fanter');
  const [distributor, setDistributor] = useState('');
  const [daraRate, setDaraRate] = useState('90');
  const [daraComm, setDaraComm] = useState('10');
  const [akharRate, setAkharRate] = useState('9');
  const [akharComm, setAkharComm] = useState('10');
  const [tpComm, setTpComm] = useState('NO');
  const [rebate, setRebate] = useState('10');
  const [tpR, setTpR] = useState('NO');
  const [hissa, setHissa] = useState('NO');
  const [limitType, setLimitType] = useState('Yes');
  const [agentName, setAgentName] = useState('');
  const [refLedger, setRefLedger] = useState('');
  const [addDibba, setAddDibba] = useState<'YES' | 'NO'>('NO');
  const [addDibbaAmount, setAddDibbaAmount] = useState('');
  const [grantor, setGrantor] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [vapsiTpr, setVapsiTpr] = useState('10 | NO');
  const [capping, setCapping] = useState(0);
  const [isRisky, setIsRisky] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // Add (F2) popup validation — matches the live site's own error banners/fields exactly.
  const [addFormError, setAddFormError] = useState<{ title: string; message: string } | null>(null);
  const [addErrorField, setAddErrorField] = useState<
    'daraRate' | 'akharRate' | 'mobile' | 'distributor' | 'agent' | null
  >(null);

  // Add New Ledger popup — which fields show depends on the selected Group, matching the live
  // reference exactly: Company/Distributor/Fanter get the rate box, only Distributor/Fanter
  // additionally get the Limit/Agent/Ref Ledger/Dibba row, and only Fanter also gets its own
  // "Distributor" (parent) field. Cash Agent/Direct Expense/Indirect Expense/Profit & Loss get
  // none of these — just the basic Ledger Name/Real Name/Group/Grantor/Mobile/Address fields.
  const addGroupHasRateBox = groupName === 'Company' || groupName === 'Distributor' || groupName === 'Fanter';
  const addGroupHasLimitRow = groupName === 'Distributor' || groupName === 'Fanter';
  const addGroupHasDistributorField = groupName === 'Fanter';
  // Real, dynamic distributor list (plus the virtual "SELF" option) — used both for the
  // Distributor field's suggestions and to validate it actually exists.
  const distributorOptions = ['SELF', ...ledgers.filter((l) => l.groupName === 'Distributor').map((l) => l.partyName)];

  // Ledger Update popup state (Action button) — separate from the Add (F2) modal above.
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateTab, setUpdateTab] = useState<UpdateTab>('Info');
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateSaving, setUpdateSaving] = useState(false);
  const [updateLedgerDetail, setUpdateLedgerDetail] = useState<LedgerDetail | null>(null);
  const [updDistributorId, setUpdDistributorId] = useState<number | ''>('');
  const [updRetailerId, setUpdRetailerId] = useState<number | ''>('');
  const [updDaraRate, setUpdDaraRate] = useState('100');
  const [updAkharRate, setUpdAkharRate] = useState('10');
  const [updRebate, setUpdRebate] = useState('0');
  const [updHasLimit, setUpdHasLimit] = useState<'Yes' | 'No'>('Yes');
  const [updDibba, setUpdDibba] = useState<'YES' | 'NO'>('NO');
  const [updDAmt, setUpdDAmt] = useState('0');
  const [updAgentName, setUpdAgentName] = useState('');
  const [updHpLedgerId, setUpdHpLedgerId] = useState<number | ''>('');
  const [updRefLedgerId, setUpdRefLedgerId] = useState<number | ''>('');
  const [updRealName, setUpdRealName] = useState('');
  const [updGrantor, setUpdGrantor] = useState('');
  const [updDealing, setUpdDealing] = useState('DAILY');
  const [updMobile, setUpdMobile] = useState('');
  const [updAddress, setUpdAddress] = useState('');

  // Re-Name tab
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  // Re-Config tab
  const [rcDaraRate, setRcDaraRate] = useState('0');
  const [rcDaraComm, setRcDaraComm] = useState('0');
  const [rcAkharRate, setRcAkharRate] = useState('0');
  const [rcAkharComm, setRcAkharComm] = useState('0');
  const [rcSelfHissa, setRcSelfHissa] = useState('0');
  const [rcCappingAmt, setRcCappingAmt] = useState('0');
  const [rcMasterLedgerConfig, setRcMasterLedgerConfig] = useState(false);
  const [rcIsTransactionAllow, setRcIsTransactionAllow] = useState(true);
  const [rcSaving, setRcSaving] = useState(false);
  const [hissaLinks, setHissaLinks] = useState<ThirdPartyLink[]>([]);
  const [newHissaParty, setNewHissaParty] = useState('');
  const [newHissaPercent, setNewHissaPercent] = useState('');
  const [tpcLinks, setTpcLinks] = useState<ThirdPartyLink[]>([]);
  const [newTpcParty, setNewTpcParty] = useState('');
  const [newTpcDComm, setNewTpcDComm] = useState('');
  const [newTpcAComm, setNewTpcAComm] = useState('');
  const [tpvLinks, setTpvLinks] = useState<ThirdPartyLink[]>([]);
  const [newTpvParty, setNewTpvParty] = useState('');
  const [newTpvPercent, setNewTpvPercent] = useState('');

  // Linked tab
  const [linkedStats, setLinkedStats] = useState<LinkedStats | null>(null);
  const [linkedLoading, setLinkedLoading] = useState(false);

  // Password tab
  const [pwValue, setPwValue] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  // Account tab
  const [acctSaving, setAcctSaving] = useState<string | null>(null);

  const fetchLedgers = async () => {
    setLoading(true);
    try {
      const url = statusFilter === 'Deleted' ? '/ledgers?status=Deleted' : '/ledgers';
      const res = await apiRequest<LedgerItem[]>(url);
      if (res.data) {
        setLedgers(res.data);
      }
    } catch (err) {
      console.warn('Failed to load ledgers:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await apiRequest<AgentOption[]>('/agents');
      if (res.data) {
        setAgents(res.data);
      }
    } catch (err) {
      console.warn('Failed to load agents:', err);
    }
  };

  useEffect(() => {
    fetchLedgers();
    fetchAgents();
  }, [statusFilter]);

  // Clear any leftover validation banner/highlight whenever the Add (F2) popup opens or closes.
  useEffect(() => {
    setAddFormError(null);
    setAddErrorField(null);
  }, [showModal]);

  // Keyboard shortcuts: F2 opens Add modal, F5 reloads, Escape closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setShowModal(true);
      }
      if (e.key === 'F5') {
        e.preventDefault();
        fetchLedgers();
      }
      if (e.key === 'Escape' && showModal) {
        e.preventDefault();
        setShowModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const resetForm = () => {
    setPartyName('');
    setRealName('');
    setUserName('');
    setGroupName('Fanter');
    setDistributor('');
    setDaraRate('90');
    setDaraComm('10');
    setAkharRate('9');
    setAkharComm('10');
    setTpComm('NO');
    setRebate('10');
    setTpR('NO');
    setHissa('NO');
    setLimitType('Yes');
    setAgentName('');
    setRefLedger('');
    setAddDibba('NO');
    setAddDibbaAmount('');
    setGrantor('');
    setMobile('');
    setAddress('');
    setVapsiTpr('10 | NO');
    setCapping(0);
    setIsRisky(false);
    setIsLocked(false);
  };

  const handleCreateLedger = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim()) return;

    if (!window.confirm('Are you sure?')) return;

    const daraNum = parseFloat(daraRate.toString().split('/')[0]);
    const akharNum = parseFloat(akharRate.toString().split('/')[0]);
    // Dara Commission (= 100 - Dara Rate) is capped at 50 — i.e. Dara Rate itself must be
    // 50 or higher — the same rule the live site enforces before anything else.
    const daraCommResult = daraRate === '' || isNaN(daraNum) ? NaN : 100 - daraNum;
    if (addGroupHasRateBox && (daraRate === '' || isNaN(daraNum) || isNaN(daraCommResult) || daraCommResult > 50)) {
      setAddErrorField('daraRate');
      setAddFormError({ title: 'Invalid', message: 'Please enter all valid Dara Rate max 50!' });
      return;
    }

    if (!mobile.trim() || (addGroupHasRateBox && (akharRate === '' || isNaN(akharNum)))) {
      setAddErrorField(!mobile.trim() ? 'mobile' : 'akharRate');
      setAddFormError({ title: 'Invalid', message: 'Please enter all valid fields!' });
      return;
    }

    if (addGroupHasDistributorField) {
      const distValid =
        distributor.trim().toUpperCase() === 'SELF' ||
        ledgers.some(
          (l) => l.groupName === 'Distributor' && l.partyName.trim().toUpperCase() === distributor.trim().toUpperCase()
        );
      if (!distValid) {
        setAddErrorField('distributor');
        setAddFormError({ title: 'Message', message: 'Distributor is not exist!' });
        return;
      }
    }

    if (addGroupHasLimitRow) {
      const agentValid = agents.some((a) => a.agentName.trim().toUpperCase() === agentName.trim().toUpperCase());
      if (!agentValid) {
        setAddErrorField('agent');
        setAddFormError({ title: 'Message', message: 'Please Enter valid Agent!' });
        return;
      }
    }

    setAddFormError(null);
    setAddErrorField(null);

    try {
      const commNum = parseFloat(daraComm.toString()) || 0;

      await apiRequest('/ledgers', {
        method: 'POST',
        body: JSON.stringify({
          partyName: partyName.trim().toUpperCase(),
          realName: realName.trim() || undefined,
          userName: userName || Math.floor(10000000 + Math.random() * 90000000).toString(),
          groupName,
          agentName: agentName.trim() || undefined,
          mobile: mobile.trim() || undefined,
          address: address.trim() || undefined,
          grantor: grantor.trim() || undefined,
          refLedger: refLedger.trim() || undefined,
          daraRate: isNaN(daraNum) ? 90 : daraNum,
          akharRate: isNaN(akharNum) ? 9 : akharNum,
          commissionRate: commNum,
          hasLimit: limitType === 'Yes',
          dibba: addGroupHasLimitRow ? addDibba === 'YES' : undefined,
          dAmt: addGroupHasLimitRow ? parseFloat(addDibbaAmount) || 0 : undefined,
          vapsiTpr,
          capping,
          isRisky,
          isLocked,
        }),
      });

      setShowModal(false);
      resetForm();
      fetchLedgers();
    } catch (err: any) {
      alert(err.message || 'Failed to create ledger');
    }
  };

  const handleToggleLock = async (l: LedgerItem) => {
    try {
      await apiRequest(`/ledgers/${l.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isLocked: !l.isLocked }),
      });
      fetchLedgers();
    } catch (err: any) {
      alert(err.message || 'Failed to update ledger lock status');
    }
  };

  // "Action" button -> Ledger Update popup (Info tab fully wired; Re-Name/Re-Config/Linked/
  // Password/Account have no reference screenshot yet, so they render as placeholder tabs
  // rather than fabricated fields).
  const handleOpenUpdateModal = async (l: LedgerItem) => {
    setUpdateTab('Info');
    setShowUpdateModal(true);
    setUpdateLoading(true);
    try {
      const res = await apiRequest<LedgerDetail>(`/ledgers/${l.id}`);
      if (res.data) {
        const d = res.data;
        setUpdateLedgerDetail(d);
        setUpdDistributorId(d.distributorId || '');
        setUpdRetailerId(d.retailerId || '');
        setUpdDaraRate(String(d.daraRate ?? 100));
        setUpdAkharRate(String(d.akharRate ?? 10));
        setUpdRebate(String(d.rebate ?? 0));
        setUpdHasLimit(d.hasLimit ? 'Yes' : 'No');
        setUpdDibba(d.dibba ? 'YES' : 'NO');
        setUpdDAmt(String(d.dAmt ?? 0));
        setUpdAgentName(d.agentName || '');
        setUpdHpLedgerId(d.hpLedgerId || '');
        setUpdRefLedgerId(d.refLedgerId || '');
        setUpdRealName(d.realName || '');
        setUpdGrantor(d.grantor || '');
        setUpdDealing(d.dealing || 'DAILY');
        setUpdMobile(d.mobile || '');
        setUpdAddress(d.address || '');

        setRenameValue(d.partyName || '');

        setRcDaraRate(String(d.daraRate ?? 0));
        setRcDaraComm(String(d.commissionRate ?? 0));
        setRcAkharRate(String(d.akharRate ?? 0));
        setRcAkharComm(String(d.commissionRate ?? 0));
        setRcSelfHissa(String(d.hissaPercentage ?? 0));
        setRcCappingAmt(String(d.capping ?? 0));
        setRcMasterLedgerConfig(!!d.masterLedgerConfig);
        setRcIsTransactionAllow(d.isTransactionAllow !== false);

        setPwValue(d.password || '');

        setLinkedStats(null);
        setHissaLinks([]);
        setTpcLinks([]);
        setTpvLinks([]);

        // Info tab's 3rd Party Commission/Rebate/Hissa summary fields need the real linked
        // rows right away (Info is the tab shown by default) — fetched here rather than lazily
        // on Re-Config-tab-open like before, since they were previously always hardcoded to
        // '-' and never reflected any real saved data at all.
        apiRequest<ThirdPartyLink[]>(`/ledgers/${d.id}/links`).then(linkRes => {
          const all = linkRes.data || [];
          setHissaLinks(all.filter(l => l.linkType === 'HISSA'));
          setTpcLinks(all.filter(l => l.linkType === 'TPC'));
          setTpvLinks(all.filter(l => l.linkType === 'TPV'));
        }).catch(() => {});
      }
    } catch (err: any) {
      alert(err.message || 'Failed to load ledger detail');
      setShowUpdateModal(false);
    } finally {
      setUpdateLoading(false);
    }
  };

  // Linked tab's stats are still fetched lazily (only once that tab is actually opened) since
  // it's a heavier aggregate computation, unlike the link lists above which Info needs upfront.
  useEffect(() => {
    if (!showUpdateModal || !updateLedgerDetail) return;
    const ledgerId = updateLedgerDetail.id;

    if (updateTab === 'Linked' && !linkedStats) {
      setLinkedLoading(true);
      apiRequest<LinkedStats>(`/ledgers/${ledgerId}/linked`).then(res => {
        if (res.data) setLinkedStats(res.data);
      }).catch(() => {}).finally(() => setLinkedLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateTab, showUpdateModal, updateLedgerDetail?.id]);

  const handleRename = async () => {
    if (!updateLedgerDetail || !renameValue.trim()) return;
    setRenameSaving(true);
    try {
      await apiRequest(`/ledgers/${updateLedgerDetail.id}`, {
        method: 'PUT',
        body: JSON.stringify({ partyName: renameValue.trim() }),
      });
      setUpdateLedgerDetail({ ...updateLedgerDetail, partyName: renameValue.trim().toUpperCase() });
      fetchLedgers();
    } catch (err: any) {
      alert(err.message || 'Failed to rename ledger');
    } finally {
      setRenameSaving(false);
    }
  };

  const handleSaveReconfig = async () => {
    if (!updateLedgerDetail) return;
    setRcSaving(true);
    try {
      await apiRequest(`/ledgers/${updateLedgerDetail.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          daraRate: parseFloat(rcDaraRate) || 0,
          akharRate: parseFloat(rcAkharRate) || 0,
          commissionRate: parseFloat(rcDaraComm) || 0,
          hissaPercentage: parseFloat(rcSelfHissa) || 0,
          capping: parseFloat(rcCappingAmt) || 0,
        }),
      });
      fetchLedgers();
    } catch (err: any) {
      alert(err.message || 'Failed to save reconfig');
    } finally {
      setRcSaving(false);
    }
  };

  const handleSaveReconfigCheckboxes = async (field: 'masterLedgerConfig' | 'isTransactionAllow', value: boolean) => {
    if (!updateLedgerDetail) return;
    try {
      await apiRequest(`/ledgers/${updateLedgerDetail.id}`, {
        method: 'PUT',
        body: JSON.stringify({ [field]: value }),
      });
    } catch (err: any) {
      alert(err.message || 'Failed to save');
    }
  };

  const handleAddLink = async (linkType: 'HISSA' | 'TPC' | 'TPV', payload: any) => {
    if (!updateLedgerDetail) return;
    try {
      const res = await apiRequest<ThirdPartyLink>(`/ledgers/${updateLedgerDetail.id}/links`, {
        method: 'POST',
        body: JSON.stringify({ linkType, ...payload }),
      });
      if (res.data) {
        if (linkType === 'HISSA') { setHissaLinks(prev => [...prev, res.data]); setNewHissaParty(''); setNewHissaPercent(''); }
        else if (linkType === 'TPC') { setTpcLinks(prev => [...prev, res.data]); setNewTpcParty(''); setNewTpcDComm(''); setNewTpcAComm(''); }
        else { setTpvLinks(prev => [...prev, res.data]); setNewTpvParty(''); setNewTpvPercent(''); }
      }
    } catch (err: any) {
      alert(err.message || 'Failed to add');
    }
  };

  const handleDeleteLink = async (linkType: 'HISSA' | 'TPC' | 'TPV', linkId: number) => {
    try {
      await apiRequest(`/ledgers/links/${linkId}`, { method: 'DELETE' });
      if (linkType === 'HISSA') setHissaLinks(prev => prev.filter(l => l.id !== linkId));
      else if (linkType === 'TPC') setTpcLinks(prev => prev.filter(l => l.id !== linkId));
      else setTpvLinks(prev => prev.filter(l => l.id !== linkId));
    } catch (err: any) {
      alert(err.message || 'Failed to remove');
    }
  };

  const handleSavePassword = async () => {
    if (!updateLedgerDetail || !pwValue.trim()) return;
    setPwSaving(true);
    try {
      await apiRequest(`/ledgers/${updateLedgerDetail.id}`, {
        method: 'PUT',
        body: JSON.stringify({ password: pwValue.trim() }),
      });
      alert('Password updated successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to change password');
    } finally {
      setPwSaving(false);
    }
  };

  const handleAccountToggle = async (field: 'isLocked' | 'isHidden', value: boolean) => {
    if (!updateLedgerDetail) return;
    setAcctSaving(field);
    try {
      await apiRequest(`/ledgers/${updateLedgerDetail.id}`, {
        method: 'PUT',
        body: JSON.stringify({ [field]: value }),
      });
      setUpdateLedgerDetail({ ...updateLedgerDetail, [field]: value });
      fetchLedgers();
    } catch (err: any) {
      alert(err.message || 'Failed to update');
    } finally {
      setAcctSaving(null);
    }
  };

  const handleDeleteRestore = async () => {
    if (!updateLedgerDetail) return;
    const isCurrentlyActive = !updateLedgerDetail.deletedAt;
    if (!window.confirm(isCurrentlyActive ? 'Delete this ledger?' : 'Restore this ledger?')) return;
    setAcctSaving('delete-restore');
    try {
      if (isCurrentlyActive) {
        await apiRequest(`/ledgers/${updateLedgerDetail.id}`, { method: 'DELETE' });
        setUpdateLedgerDetail({ ...updateLedgerDetail, deletedAt: new Date().toISOString() });
      } else {
        await apiRequest(`/ledgers/${updateLedgerDetail.id}/restore`, { method: 'PATCH' });
        setUpdateLedgerDetail({ ...updateLedgerDetail, deletedAt: null });
      }
      fetchLedgers();
    } catch (err: any) {
      alert(err.message || 'Failed to update account status');
    } finally {
      setAcctSaving(null);
    }
  };

  const handleSaveUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updateLedgerDetail) return;
    setUpdateSaving(true);
    try {
      let agentId: number | null = updateLedgerDetail.agentId ?? null;
      const cleanAgentName = updAgentName.trim().toUpperCase();
      if (cleanAgentName) {
        const matched = agents.find(a => a.agentName.toUpperCase() === cleanAgentName);
        agentId = matched ? matched.id : agentId;
      } else {
        agentId = null;
      }

      await apiRequest(`/ledgers/${updateLedgerDetail.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          distributorId: updDistributorId || null,
          retailerId: updRetailerId || null,
          daraRate: parseFloat(updDaraRate) || 0,
          akharRate: parseFloat(updAkharRate) || 0,
          rebate: parseFloat(updRebate) || 0,
          hasLimit: updHasLimit === 'Yes',
          dibba: updDibba === 'YES',
          dAmt: parseFloat(updDAmt) || 0,
          agentId,
          hpLedgerId: updHpLedgerId || null,
          refLedgerId: updRefLedgerId || null,
          realName: updRealName.trim() || undefined,
          grantor: updGrantor.trim(),
          dealing: updDealing,
          mobile: updMobile.trim() || undefined,
          address: updAddress.trim(),
        }),
      });
      setShowUpdateModal(false);
      fetchLedgers();
    } catch (err: any) {
      alert(err.message || 'Failed to update ledger');
    } finally {
      setUpdateSaving(false);
    }
  };

  // Dynamic filter logic matching pbmax1.com controls
  const filteredLedgers = ledgers.filter(l => {
    const searchLower = searchTerm.trim().toLowerCase();
    const matchesSearch =
      !searchLower ||
      l.partyName.toLowerCase().includes(searchLower) ||
      (l.userName && l.userName.includes(searchLower)) ||
      (l.agentName && l.agentName.toLowerCase().includes(searchLower)) ||
      (l.realName && l.realName.toLowerCase().includes(searchLower));

    const matchesCashAgent =
      cashAgentFilter === '-- ALL --' ||
      (cashAgentFilter === 'Cash Agent' && l.groupName === 'Cash Agent');

    const matchesAgent =
      agentFilter === '-- ALL --' ||
      !agentFilter ||
      (l.agentName && l.agentName.toLowerCase() === agentFilter.toLowerCase());

    const matchesCapping =
      cappingFilter === 'ALL' ||
      (cappingFilter === '0' && l.capping === 0) ||
      (cappingFilter === '1000+' && l.capping > 0);

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'Active' && !l.isLocked) ||
      (statusFilter === 'Hidden' && l.isLocked) ||
      (statusFilter === 'Deleted' && !!l.deletedAt);

    return matchesSearch && matchesCashAgent && matchesAgent && matchesCapping && matchesStatus;
  });

  return (
    <div className="min-h-full bg-[#eaedf2] p-3 sm:p-4 flex flex-col justify-between text-slate-800 select-none">
      {/* Outer Card */}
      <div className="bg-white rounded-md shadow-sm border border-slate-300 overflow-hidden">
        {/* Subheader Controls & Filters matching pbmax1.com */}
        <div className="p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-bold text-sm text-slate-900 tracking-tight mr-1">Ledger</span>

            {/* Search Input */}
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-semibold text-xs">Search</span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="SEARCH PARTY..."
                className="w-40 sm:w-56 px-2.5 py-1 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-blue-500 uppercase"
              />
            </div>

            {/* Cash Agent Filter */}
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-semibold text-xs">Cash Agent</span>
              <select
                value={cashAgentFilter}
                onChange={(e) => setCashAgentFilter(e.target.value)}
                className="px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
              >
                <option value="-- ALL --">-- ALL --</option>
                <option value="Cash Agent">Cash Agent</option>
              </select>
            </div>

            {/* Agent Filter */}
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-semibold text-xs">Agent</span>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="min-w-28 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
              >
                <option value="-- ALL --">-- ALL --</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.agentName}>
                    {a.agentName}
                  </option>
                ))}
              </select>
            </div>

            {/* Capping Filter */}
            <div className="flex items-center gap-2">
              <span className="text-slate-600 font-semibold text-xs">Capping</span>
              <select
                value={cappingFilter}
                onChange={(e) => setCappingFilter(e.target.value)}
                className="px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">ALL</option>
                <option value="0">0</option>
                <option value="1000+">1000+</option>
              </select>
            </div>
          </div>

          {/* Add (F2) Button */}
          <button
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
            className="px-5 py-1.5 bg-[#1662c6] hover:bg-[#1354ab] active:bg-[#0f4691] text-white font-bold text-xs rounded shadow-xs transition-colors flex items-center justify-center gap-1.5 shrink-0"
          >
            <span>Add (F2)</span>
          </button>
        </div>

        {/* Main Ledgers Table matching pbmax1.com */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center w-12">Sr</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center w-14">Telegram</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Party Name</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-center">UserName</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Group</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Agent</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Dara</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Akhar</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Limit</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Vapsi | TPR</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Capping</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Risky</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Locked</th>
                <th className="py-2 px-3.5 border-r border-[#223b63] text-center">Updated</th>
                <th className="py-2 px-2.5 text-center w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs whitespace-nowrap">
              {filteredLedgers.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-8 text-center text-slate-400">
                    No ledgers found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredLedgers.map((l, idx) => {
                  const isSelected = selectedRowId === l.id;

                  return (
                    <tr
                      key={l.id}
                      onClick={() => setSelectedRowId(l.id)}
                      className={`transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/80 text-slate-900'
                          : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      {/* Sr */}
                      <td className="py-1.5 px-2.5 text-center font-mono border-r border-slate-200 text-slate-600">
                        {idx + 1}
                      </td>

                      {/* Telegram */}
                      <td className="py-1.5 px-2.5 text-center border-r border-slate-200 text-sky-600">
                        <Send className="h-3.5 w-3.5 mx-auto opacity-90 cursor-pointer hover:scale-110 transition-transform" />
                      </td>

                      {/* Party Name */}
                      <td className="py-1.5 px-3.5 font-bold uppercase tracking-tight border-r border-slate-200 text-slate-900">
                        {l.partyName}
                      </td>

                      {/* UserName */}
                      <td className="py-1.5 px-3 text-center font-mono border-r border-slate-200 text-slate-600">
                        {l.userName || '00154263'}
                      </td>

                      {/* Group */}
                      <td className="py-1.5 px-3 font-medium border-r border-slate-200 text-slate-700">
                        {l.groupName || 'Fanter'}
                      </td>

                      {/* Agent */}
                      <td className="py-1.5 px-3 font-medium uppercase border-r border-slate-200 text-slate-700">
                        {l.agentName || '-NA-'}
                      </td>

                      {/* Dara */}
                      <td className="py-1.5 px-2.5 text-center font-mono border-r border-slate-200 text-slate-800">
                        {l.daraRate === 100 ? '100/0' : `${l.daraRate}/10`}
                      </td>

                      {/* Akhar */}
                      <td className="py-1.5 px-2.5 text-center font-mono border-r border-slate-200 text-slate-800">
                        {l.akharRate === 10 ? '10/0' : `${l.akharRate}/10`}
                      </td>

                      {/* Limit */}
                      <td className="py-1.5 px-2.5 text-center border-r border-slate-200">
                        <span
                          className={`inline-block min-w-10 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            l.hasLimit
                              ? 'bg-[#00897b] text-white'
                              : 'bg-[#d32f2f] text-white'
                          }`}
                        >
                          {l.hasLimit ? 'YES' : 'No'}
                        </span>
                      </td>

                      {/* Vapsi | TPR */}
                      <td className="py-1.5 px-2.5 text-center font-mono border-r border-slate-200 text-slate-700">
                        {l.vapsiTpr}
                      </td>

                      {/* Capping */}
                      <td className="py-1.5 px-2.5 text-center font-mono border-r border-slate-200 text-slate-700">
                        {l.capping}
                      </td>

                      {/* Risky */}
                      <td className="py-1.5 px-2.5 text-center border-r border-slate-200">
                        <span
                          className={`inline-block min-w-10 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            l.isRisky
                              ? 'bg-[#d32f2f] text-white'
                              : 'bg-[#00897b] text-white'
                          }`}
                        >
                          {l.isRisky ? 'YES' : 'NO'}
                        </span>
                      </td>

                      {/* Locked */}
                      <td className="py-1.5 px-2.5 text-center border-r border-slate-200">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleLock(l);
                          }}
                          className={`inline-block min-w-12 px-2 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer transition-transform active:scale-95 ${
                            l.isLocked
                              ? 'bg-[#d32f2f] text-white'
                              : 'bg-[#00897b] text-white'
                          }`}
                        >
                          {l.isLocked ? 'LOCKED' : 'NO'}
                        </span>
                      </td>

                      {/* Updated */}
                      <td className="py-1 px-3.5 text-center border-r border-slate-200 text-[10px]">
                        <div className="font-semibold text-rose-600 tracking-wider">
                          {l.updatedBy || 'A100'}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono">
                          {formatDateTime(l.updatedAt)}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-1.5 px-2.5 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenUpdateModal(l);
                          }}
                          className="px-2.5 py-1 bg-[#1662c6] hover:bg-[#1354ab] text-white rounded text-[10px] font-bold shadow-xs transition-colors"
                        >
                          Action
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Table Footer matching pbmax1.com */}
            <tfoot>
              <tr className="bg-[#152847] text-white font-bold text-[11px] whitespace-nowrap">
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center font-mono">
                  {3241}
                </th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Telegram</th>
                <th className="py-2 px-3.5 border-r border-[#223b63]">Party Name</th>
                <th className="py-2 px-3 border-r border-[#223b63] text-center">UserName</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Group</th>
                <th className="py-2 px-3 border-r border-[#223b63]">Agent</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Dara</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Akhar</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Limit</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Vapsi | TPR</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Capping</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Risky</th>
                <th className="py-2 px-2.5 border-r border-[#223b63] text-center">Locked</th>
                <th className="py-2 px-3.5 border-r border-[#223b63] text-center">Updated</th>
                <th className="py-2 px-2.5 text-center">Action</th>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Bottom Help & Status Bar matching pbmax1.com */}
        <div className="p-2.5 bg-[#f8fafc] border-t border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-600">
          <div className="text-slate-500 hover:text-slate-700 cursor-pointer">Need Help?</div>
          <div className="font-mono text-slate-500 tracking-wider">[ F5 = ReLoad Ledgers ]</div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1 bg-[#fef08a] border border-amber-300 rounded text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-400"
            >
              <option value="Active">Active</option>
              <option value="Hidden">Hidden</option>
              <option value="Deleted">Deleted</option>
            </select>
          </div>
        </div>
      </div>

      {/* Add "New User Ledger" Modal matching Screenshots 3, 4, 5 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 overflow-y-auto">
          {/* Validation banner — matches the live site's "Invalid"/"Message" error popups exactly */}
          {addFormError && (
            <div className="fixed top-3 right-3 z-[60] w-full max-w-sm rounded shadow-2xl border border-red-800 bg-red-600 text-white animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="flex items-start justify-between px-4 pt-3 pb-1">
                <h3 className="font-bold text-sm">{addFormError.title}</h3>
                <button
                  type="button"
                  onClick={() => setAddFormError(null)}
                  className="text-white/80 hover:text-white -mt-1 -mr-1 p-1"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-4 pb-3 text-xs">{addFormError.message}</div>
            </div>
          )}
          <div className="bg-white rounded shadow-2xl max-w-4xl w-full overflow-hidden border border-slate-300 my-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-[#152847] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide">Ledger</h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLedger}>
              {/* Modal Body: 2 Columns */}
              <div className="p-4 flex flex-col md:flex-row gap-4 text-xs">
                {/* Left Column (Inputs) */}
                <div className="w-full md:w-[63%] space-y-3">
                  {/* Row 1: Ledger Name, Real Name, Group */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Ledger Name</label>
                      <input
                        type="text"
                        required
                        autoFocus
                        value={partyName}
                        onChange={(e) => setPartyName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs font-semibold text-slate-900 uppercase focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Real Name</label>
                      <input
                        type="text"
                        value={realName}
                        onChange={(e) => setRealName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Group</label>
                      <select
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        {GROUPS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 2: Distributor — only for the Fanter group (links to its parent distributor) */}
                  {addGroupHasDistributorField && (
                    <div className="w-full sm:w-1/2">
                      <label className="block text-slate-700 font-medium mb-1">Distributor</label>
                      <input
                        list="modal-distributors"
                        type="text"
                        value={distributor}
                        onChange={(e) => {
                          setDistributor(e.target.value);
                          if (addErrorField === 'distributor') {
                            setAddErrorField(null);
                            setAddFormError(null);
                          }
                        }}
                        className={`w-full px-2.5 py-1.5 bg-white border rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500 ${
                          addErrorField === 'distributor' ? 'border-red-500 ring-1 ring-red-400' : 'border-slate-300'
                        }`}
                      />
                      <datalist id="modal-distributors">
                        {distributorOptions.map((d) => (
                          <option key={d} value={d} />
                        ))}
                      </datalist>
                    </div>
                  )}

                  {/* Row 3: Rates Grid — only for Company/Distributor/Fanter; hidden entirely for
                      Cash Agent/Direct Expense/Indirect Expense/Profit & Loss */}
                  {addGroupHasRateBox && (
                    <div>
                      {/* 8-column rate table as shown in Image 3 */}
                      <div className="border border-[#152847] rounded overflow-hidden">
                        <div className="grid grid-cols-8 bg-[#152847] text-white text-[10px] font-bold text-center py-1">
                          <div className="border-r border-[#223b63]">Dara Rate</div>
                          <div className="border-r border-[#223b63]">Commission</div>
                          <div className="border-r border-[#223b63]">Akhar Rate</div>
                          <div className="border-r border-[#223b63]">Commission</div>
                          <div className="border-r border-[#223b63]">TP Comm</div>
                          <div className="border-r border-[#223b63]">Rebate</div>
                          <div className="border-r border-[#223b63]">TP-R</div>
                          <div>Hissa</div>
                        </div>
                        <div className="grid grid-cols-8 bg-white p-1 gap-1 text-center items-center">
                          <input
                            type="number"
                            value={daraRate}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDaraRate(val);
                              // Dara Commission = 100 - Dara Rate (e.g. 90 -> 10, 1 -> 99) —
                              // matches the "90/10" rate/commission pairing shown everywhere
                              // else in the app, derived live from the screenshots' own
                              // rate->commission transitions rather than hardcoded.
                              setDaraComm(val === '' ? '' : String(100 - (parseFloat(val) || 0)));
                              if (addErrorField === 'daraRate') {
                                setAddErrorField(null);
                                setAddFormError(null);
                              }
                            }}
                            className={`w-full px-1 py-1 text-center font-mono font-semibold text-[11px] border rounded ${
                              addErrorField === 'daraRate' ? 'border-red-500 ring-1 ring-red-400' : 'border-slate-300'
                            }`}
                          />
                          <input
                            type="text"
                            readOnly
                            value={daraComm}
                            className="w-full px-1 py-1 text-center font-mono font-semibold text-[11px] border border-slate-300 rounded bg-slate-50 text-slate-600 cursor-not-allowed"
                          />
                          <input
                            type="number"
                            value={akharRate}
                            onChange={(e) => {
                              const val = e.target.value;
                              setAkharRate(val);
                              // Akhar Commission = 100 - (Akhar Rate x 10) (e.g. 9 -> 10, 1 -> 90,
                              // 10 -> 0) — Akhar rates run on a 0-10 scale (vs Dara's 0-100), so
                              // the x10 keeps the commission on the same 0-100 scale.
                              setAkharComm(val === '' ? '' : String(100 - (parseFloat(val) || 0) * 10));
                              if (addErrorField === 'akharRate') {
                                setAddErrorField(null);
                                setAddFormError(null);
                              }
                            }}
                            className={`w-full px-1 py-1 text-center font-mono font-semibold text-[11px] border rounded ${
                              addErrorField === 'akharRate' ? 'border-red-500 ring-1 ring-red-400' : 'border-slate-300'
                            }`}
                          />
                          <input
                            type="text"
                            readOnly
                            value={akharComm}
                            className="w-full px-1 py-1 text-center font-mono font-semibold text-[11px] border border-slate-300 rounded bg-slate-50 text-slate-600 cursor-not-allowed"
                          />
                          <button
                            type="button"
                            onClick={() => setTpComm(tpComm === 'YES' ? 'NO' : 'YES')}
                            className="w-full py-1 text-center font-bold text-[10px] border border-slate-300 rounded bg-slate-50 hover:bg-slate-100 text-slate-700"
                          >
                            {tpComm}
                          </button>
                          <input
                            type="text"
                            value={rebate}
                            onChange={(e) => setRebate(e.target.value)}
                            className="w-full px-1 py-1 text-center font-mono font-semibold text-[11px] border border-slate-300 rounded"
                          />
                          <button
                            type="button"
                            onClick={() => setTpR(tpR === 'YES' ? 'NO' : 'YES')}
                            className="w-full py-1 text-center font-bold text-[10px] border border-slate-300 rounded bg-slate-50 hover:bg-slate-100 text-slate-700"
                          >
                            {tpR}
                          </button>
                          <button
                            type="button"
                            onClick={() => setHissa(hissa === 'YES' ? 'NO' : 'YES')}
                            className="w-full py-1 text-center font-bold text-[10px] border border-slate-300 rounded bg-slate-50 hover:bg-slate-100 text-slate-700"
                          >
                            {hissa}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Row 4: Limit Type, Agent, Ref Ledger, Dibba, Dibba Amount — only for
                      Distributor/Fanter (Image 5) */}
                  {addGroupHasLimitRow && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Limit Type</label>
                      <select
                        value={limitType}
                        onChange={(e) => setLimitType(e.target.value)}
                        className="w-full px-2 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Agent</label>
                      <input
                        list="modal-agents"
                        type="text"
                        value={agentName}
                        onChange={(e) => {
                          setAgentName(e.target.value);
                          if (addErrorField === 'agent') {
                            setAddErrorField(null);
                            setAddFormError(null);
                          }
                        }}
                        className={`w-full px-2.5 py-1.5 bg-white border rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500 ${
                          addErrorField === 'agent' ? 'border-red-500 ring-1 ring-red-400' : 'border-slate-300'
                        }`}
                      />
                      <datalist id="modal-agents">
                        {agents.map((a) => (
                          <option key={a.id} value={a.agentName} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Ref Ledger</label>
                      <input
                        type="text"
                        value={refLedger}
                        onChange={(e) => setRefLedger(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Dibba</label>
                      <select
                        value={addDibba}
                        onChange={(e) => setAddDibba(e.target.value as 'YES' | 'NO')}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        <option value="NO">NO</option>
                        <option value="YES">YES</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Dibba Amount</label>
                      <input
                        type="text"
                        value={addDibbaAmount}
                        onChange={(e) => setAddDibbaAmount(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  )}

                  {/* Row 5: Grantor/Rmk */}
                  <div className="w-full sm:w-2/3">
                    <label className="block text-slate-700 font-medium mb-1">Grantor/Rmk</label>
                    <input
                      type="text"
                      value={grantor}
                      onChange={(e) => setGrantor(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Row 6: Mobile and Address */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Mobile</label>
                      <input
                        type="text"
                        value={mobile}
                        onChange={(e) => {
                          setMobile(e.target.value);
                          if (addErrorField === 'mobile') {
                            setAddErrorField(null);
                            setAddFormError(null);
                          }
                        }}
                        placeholder="MOBILE"
                        className={`w-full px-2.5 py-1.5 bg-white border rounded text-xs text-slate-800 placeholder:text-slate-300 placeholder:font-bold focus:outline-none focus:border-blue-500 uppercase ${
                          addErrorField === 'mobile' ? 'border-red-500 ring-1 ring-red-400' : 'border-slate-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Address</label>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="ADDRESSS"
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 placeholder:text-slate-300 placeholder:font-bold focus:outline-none focus:border-blue-500 uppercase"
                      />
                    </div>
                  </div>
                </div>

                {/* Right Column (3 Tables matching Screenshots 3, 4) */}
                <div className="w-full md:w-[37%] space-y-3 flex flex-col justify-start">
                  {/* Table 1: 3rd Party | D-Comm | A-Comm */}
                  <div className="border border-[#152847] rounded overflow-hidden shadow-2xs">
                    <div className="bg-[#152847] text-white text-[10px] font-bold px-2 py-1 flex items-center justify-between">
                      <span>3rd Party</span>
                      <div className="flex gap-4">
                        <span>D-Comm</span>
                        <span>A-Comm</span>
                      </div>
                    </div>
                    <div className="h-16 bg-white overflow-y-auto p-1.5 text-center text-slate-300 text-[11px] flex items-center justify-center">
                      No 3rd party entries
                    </div>
                  </div>

                  {/* Table 2: 3rd Party | Rebate */}
                  <div className="border border-[#152847] rounded overflow-hidden shadow-2xs">
                    <div className="bg-[#152847] text-white text-[10px] font-bold px-2 py-1 flex items-center justify-between">
                      <span>3rd Party</span>
                      <span>Rebate</span>
                    </div>
                    <div className="h-16 bg-white overflow-y-auto p-1.5 text-center text-slate-300 text-[11px] flex items-center justify-center">
                      No rebate entries
                    </div>
                  </div>

                  {/* Table 3: Party | Hissa */}
                  <div className="border border-[#152847] rounded overflow-hidden shadow-2xs">
                    <div className="bg-[#152847] text-white text-[10px] font-bold px-2 py-1 flex items-center justify-between">
                      <span>Party</span>
                      <span>Hissa</span>
                    </div>
                    <div className="h-16 bg-white overflow-y-auto p-1.5 text-center text-slate-300 text-[11px] flex items-center justify-center">
                      No hissa entries
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer matching Screenshot 3 */}
              <div className="p-3 bg-white border-t border-slate-200 flex justify-end items-center gap-3">
                <button
                  type="submit"
                  className="px-6 py-1.5 bg-[#152847] hover:bg-[#1e3a68] active:bg-[#0f1d33] text-white font-bold rounded text-xs transition-colors shadow-xs"
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

      {/* Ledger Update Modal (Action button) matching the pbmax1.com "Ledger Update" popup */}
      {showUpdateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 z-50 overflow-y-auto">
          <div className="bg-white rounded shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-300 my-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-[#1f4277] text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wide">
                Ledger Update {updateLedgerDetail ? `| ${updateLedgerDetail.partyName}` : ''}
              </h2>
              <button
                type="button"
                onClick={() => setShowUpdateModal(false)}
                className="text-white hover:text-slate-300 transition-colors p-0.5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-slate-200 bg-slate-50 text-xs font-semibold">
              {UPDATE_TABS.map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setUpdateTab(tab)}
                  className={`px-4 py-2 border-b-2 transition-colors ${
                    updateTab === tab
                      ? 'border-[#1f4277] text-[#1f4277] bg-white'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {updateLoading ? (
              <div className="py-16 text-center text-slate-400 text-xs font-medium">Loading ledger detail...</div>
            ) : updateTab === 'Re-Name' ? (
              <div className="p-4 max-w-sm text-xs">
                <label className="block text-slate-700 font-medium mb-1">Ledger Name</label>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500 mb-3"
                />
                <button
                  type="button"
                  disabled={renameSaving}
                  onClick={handleRename}
                  className="w-full px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs transition-colors shadow-xs disabled:opacity-50"
                >
                  {renameSaving ? 'Renaming...' : 'Re-Name'}
                </button>
              </div>
            ) : updateTab === 'Re-Config' ? (
              <div className="p-4 space-y-4 text-xs">
                {/* Rates row */}
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 items-end">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Dara Rate</label>
                    <input type="text" value={rcDaraRate} onChange={(e) => setRcDaraRate(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-center" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Commission</label>
                    <input type="text" value={rcDaraComm} onChange={(e) => setRcDaraComm(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-center" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Akhar Rate</label>
                    <input type="text" value={rcAkharRate} onChange={(e) => setRcAkharRate(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-center" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Commission</label>
                    <input type="text" value={rcAkharComm} onChange={(e) => setRcAkharComm(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-center" />
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Self Hissa</label>
                    <input type="text" value={rcSelfHissa} onChange={(e) => setRcSelfHissa(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-center" />
                  </div>
                  <button
                    type="button"
                    disabled={rcSaving}
                    onClick={handleSaveReconfig}
                    className="px-4 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs transition-colors shadow-xs disabled:opacity-50"
                  >
                    {rcSaving ? 'Saving...' : 'Save Reconfig'}
                  </button>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Capping Amt</label>
                    <input type="text" value={rcCappingAmt} onChange={(e) => setRcCappingAmt(e.target.value)} className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-center" />
                  </div>
                </div>

                {/* Hissa Party + 3rd Party Comm */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="border border-[#152847] rounded overflow-hidden">
                      <div className="grid grid-cols-[1fr_70px_36px] bg-[#152847] text-white text-[10px] font-bold text-center py-1.5">
                        <div>Hissa Party</div>
                        <div>Percent</div>
                        <div>+</div>
                      </div>
                      <div className="grid grid-cols-[1fr_70px_36px] bg-white p-1 gap-1">
                        <input list="ledger-names" type="text" value={newHissaParty} onChange={(e) => setNewHissaParty(e.target.value)} placeholder="PARTY NAME" className="px-1.5 py-1 text-xs border border-slate-300 rounded uppercase" />
                        <input type="text" value={newHissaPercent} onChange={(e) => setNewHissaPercent(e.target.value)} placeholder="%" className="px-1 py-1 text-xs border border-slate-300 rounded text-center" />
                        <button type="button" onClick={() => handleAddLink('HISSA', { partyName: newHissaParty, percent: parseFloat(newHissaPercent) || 0 })} className="bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-sm">+</button>
                      </div>
                      {/* Self Hissa always shows as a baseline row under the party's own name —
                          not a real link row, so no delete button (edit Self Hissa above instead). */}
                      {parseFloat(rcSelfHissa) > 0 && (
                        <div className="grid grid-cols-[1fr_70px_36px] border-t border-slate-100 items-center px-1.5 py-1 text-xs bg-slate-50">
                          <div className="font-semibold text-slate-800">{updateLedgerDetail?.partyName}</div>
                          <div className="text-center font-mono">{numOnly(rcSelfHissa)}</div>
                          <div />
                        </div>
                      )}
                      {hissaLinks.map(l => (
                        <div key={l.id} className="grid grid-cols-[1fr_70px_36px] border-t border-slate-100 items-center px-1.5 py-1 text-xs">
                          <div className="font-semibold text-slate-800">{l.partyName}</div>
                          <div className="text-center font-mono">{numOnly(l.percent)}</div>
                          <button type="button" onClick={() => handleDeleteLink('HISSA', l.id)} className="text-rose-600 hover:text-rose-800 font-bold">x</button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="border border-[#152847] rounded overflow-hidden">
                      <div className="grid grid-cols-[1fr_55px_55px_36px] bg-[#152847] text-white text-[10px] font-bold text-center py-1.5">
                        <div>3rd Party Comm</div>
                        <div>D-Comm</div>
                        <div>A-Comm</div>
                        <div>+</div>
                      </div>
                      <div className="grid grid-cols-[1fr_55px_55px_36px] bg-white p-1 gap-1">
                        <input list="ledger-names" type="text" value={newTpcParty} onChange={(e) => setNewTpcParty(e.target.value)} placeholder="PARTY NAME" className="px-1.5 py-1 text-xs border border-slate-300 rounded uppercase" />
                        <input type="text" value={newTpcDComm} onChange={(e) => setNewTpcDComm(e.target.value)} className="px-1 py-1 text-xs border border-slate-300 rounded text-center" />
                        <input type="text" value={newTpcAComm} onChange={(e) => setNewTpcAComm(e.target.value)} className="px-1 py-1 text-xs border border-slate-300 rounded text-center" />
                        <button type="button" onClick={() => handleAddLink('TPC', { partyName: newTpcParty, dComm: parseFloat(newTpcDComm) || 0, aComm: parseFloat(newTpcAComm) || 0 })} className="bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-sm">+</button>
                      </div>
                      {tpcLinks.map(l => (
                        <div key={l.id} className="grid grid-cols-[1fr_55px_55px_36px] border-t border-slate-100 items-center px-1.5 py-1 text-xs">
                          <div className="font-semibold text-slate-800">{l.partyName}</div>
                          <div className="text-center font-mono">{numOnly(l.dComm)}</div>
                          <div className="text-center font-mono">{numOnly(l.aComm)}</div>
                          <button type="button" onClick={() => handleDeleteLink('TPC', l.id)} className="text-rose-600 hover:text-rose-800 font-bold">x</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { /* re-fetch already reflects latest state client-side */ }}
                  className="px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs transition-colors shadow-xs"
                >
                  Update Hissa/TPC
                </button>

                {/* 3rd Party Rebate */}
                <div className="max-w-md">
                  <div className="border border-[#152847] rounded overflow-hidden">
                    <div className="grid grid-cols-[1fr_70px_36px] bg-[#152847] text-white text-[10px] font-bold text-center py-1.5">
                      <div>3rd Party Rebate</div>
                      <div>Percent</div>
                      <div>+</div>
                    </div>
                    <div className="grid grid-cols-[1fr_70px_36px] bg-white p-1 gap-1">
                      <input list="ledger-names" type="text" value={newTpvParty} onChange={(e) => setNewTpvParty(e.target.value)} placeholder="PARTY NAME" className="px-1.5 py-1 text-xs border border-slate-300 rounded uppercase" />
                      <input type="text" value={newTpvPercent} onChange={(e) => setNewTpvPercent(e.target.value)} placeholder="%" className="px-1 py-1 text-xs border border-slate-300 rounded text-center" />
                      <button type="button" onClick={() => handleAddLink('TPV', { partyName: newTpvParty, percent: parseFloat(newTpvPercent) || 0 })} className="bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-sm">+</button>
                    </div>
                    {tpvLinks.map(l => (
                      <div key={l.id} className="grid grid-cols-[1fr_70px_36px] border-t border-slate-100 items-center px-1.5 py-1 text-xs">
                        <div className="font-semibold text-slate-800">{l.partyName}</div>
                        <div className="text-center font-mono">{numOnly(l.percent)}</div>
                        <button type="button" onClick={() => handleDeleteLink('TPV', l.id)} className="text-rose-600 hover:text-rose-800 font-bold">x</button>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { /* rows already save individually on add/remove */ }}
                  className="px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs transition-colors shadow-xs"
                >
                  Update TPV
                </button>

                <datalist id="ledger-names">
                  {ledgers.filter(o => o.id !== updateLedgerDetail?.id).map(o => (
                    <option key={o.id} value={o.partyName} />
                  ))}
                </datalist>

                <div className="pt-2 border-t border-slate-200 flex items-center gap-6">
                  <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rcMasterLedgerConfig}
                      onChange={(e) => { setRcMasterLedgerConfig(e.target.checked); handleSaveReconfigCheckboxes('masterLedgerConfig', e.target.checked); }}
                    />
                    Master Ledger Config
                  </label>
                  <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rcIsTransactionAllow}
                      onChange={(e) => { setRcIsTransactionAllow(e.target.checked); handleSaveReconfigCheckboxes('isTransactionAllow', e.target.checked); }}
                    />
                    Is Transaction Allow
                  </label>
                </div>
              </div>
            ) : updateTab === 'Linked' ? (
              <div className="p-4 text-xs">
                {linkedLoading || !linkedStats ? (
                  <div className="py-16 text-center text-slate-400 font-medium">Loading linked data...</div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
                      <div className="bg-[#00897b] text-white font-bold text-center py-2 rounded text-xs">InVoucher: {linkedStats.inVoucher}</div>
                      <div className="bg-[#00897b] text-white font-bold text-center py-2 rounded text-xs">TotalDr: {linkedStats.totalDr.toLocaleString('en-IN')}</div>
                      <div className="bg-[#00897b] text-white font-bold text-center py-2 rounded text-xs">TotalCr: {linkedStats.totalCr.toLocaleString('en-IN')}</div>
                      <div className="bg-[#00897b] text-white font-bold text-center py-2 rounded text-xs">InHissa: {linkedStats.inHissa}</div>
                      <div className="bg-[#00897b] text-white font-bold text-center py-2 rounded text-xs">InTPC: {linkedStats.inTpc}</div>
                      <div className="bg-[#00897b] text-white font-bold text-center py-2 rounded text-xs">InTPV: {linkedStats.inTpv}</div>
                      <div className="bg-[#00897b] text-white font-bold text-center py-2 rounded text-xs">InHPLedger: {linkedStats.inHpLedger}</div>
                    </div>
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#1e3a63] text-white font-bold text-[10px]">
                          <th className="py-1.5 px-2 border-r border-[#2b4c7e] w-12">Sr</th>
                          <th className="py-1.5 px-2">LinkedIn Party</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linkedStats.linkedParties.length === 0 ? (
                          <tr><td colSpan={2} className="py-4 text-center text-slate-400">No linked parties.</td></tr>
                        ) : (
                          linkedStats.linkedParties.map((p, idx) => (
                            <tr key={p} className="border-b border-slate-100">
                              <td className="py-1.5 px-2 text-slate-600">{idx + 1}</td>
                              <td className="py-1.5 px-2 font-semibold text-slate-800">{p}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            ) : updateTab === 'Password' ? (
              <div className="p-4 max-w-sm text-xs">
                <label className="block text-slate-700 font-medium mb-1">Password</label>
                <input
                  type="text"
                  value={pwValue}
                  onChange={(e) => setPwValue(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500 mb-3"
                />
                <button
                  type="button"
                  disabled={pwSaving}
                  onClick={handleSavePassword}
                  className="w-full px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs transition-colors shadow-xs disabled:opacity-50"
                >
                  {pwSaving ? 'Changing...' : 'Change'}
                </button>
              </div>
            ) : updateTab === 'Account' ? (
              <div className="p-4 text-xs space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Login Status</label>
                    <button
                      type="button"
                      disabled={acctSaving === 'isLocked'}
                      onClick={() => handleAccountToggle('isLocked', !updateLedgerDetail?.isLocked)}
                      className={`w-full py-1.5 rounded font-bold text-xs text-white transition-colors ${updateLedgerDetail?.isLocked ? 'bg-[#dc2626] hover:bg-[#b91c1c]' : 'bg-[#00897b] hover:bg-[#00796b]'}`}
                    >
                      {updateLedgerDetail?.isLocked ? 'Locked' : 'Active'}
                    </button>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Account Status</label>
                    <div className={`w-full py-1.5 rounded font-bold text-xs text-white text-center ${updateLedgerDetail?.deletedAt ? 'bg-[#dc2626]' : 'bg-[#00897b]'}`}>
                      {updateLedgerDetail?.deletedAt ? 'Deleted' : 'Active'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Is Hide</label>
                    <button
                      type="button"
                      disabled={acctSaving === 'isHidden'}
                      onClick={() => handleAccountToggle('isHidden', !updateLedgerDetail?.isHidden)}
                      className={`w-full py-1.5 rounded font-bold text-xs text-white transition-colors ${updateLedgerDetail?.isHidden ? 'bg-[#dc2626] hover:bg-[#b91c1c]' : 'bg-slate-400 hover:bg-slate-500'}`}
                    >
                      {updateLedgerDetail?.isHidden ? 'Yes' : 'No'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Delete / Restore</label>
                  <button
                    type="button"
                    disabled={acctSaving === 'delete-restore'}
                    onClick={handleDeleteRestore}
                    className="px-6 py-1.5 bg-[#00897b] hover:bg-[#00796b] text-white font-bold rounded text-xs transition-colors shadow-xs disabled:opacity-50"
                  >
                    {updateLedgerDetail?.deletedAt ? 'Its Deleted! Restore Now!' : 'Its Active! Delete Now!'}
                  </button>
                  <p className="text-slate-500 text-[11px] mt-2 max-w-md">
                    अगर आप अकाउंट रिस्टोर कर रहे है तो अकाउंट के 3rd Party-Comm/Rebate and Hissa को पुनः चेक कर लें! धन्यवाद
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveUpdate} className="p-4 flex flex-col md:flex-row gap-4 text-xs">
                {/* Left column: main inputs */}
                <div className="w-full md:w-[63%] space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Distributor</label>
                      <select
                        value={updDistributorId}
                        onChange={(e) => setUpdDistributorId(e.target.value ? parseInt(e.target.value, 10) : '')}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        <option value="">-Direct-</option>
                        {ledgers.filter(o => o.id !== updateLedgerDetail?.id).map(o => (
                          <option key={o.id} value={o.id}>{o.partyName}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Retailer</label>
                      <select
                        value={updRetailerId}
                        onChange={(e) => setUpdRetailerId(e.target.value ? parseInt(e.target.value, 10) : '')}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        <option value="">-Direct-</option>
                        {ledgers.filter(o => o.id !== updateLedgerDetail?.id).map(o => (
                          <option key={o.id} value={o.id}>{o.partyName}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2.5">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Rate</label>
                      <div className="flex items-center justify-center gap-0.5 border border-slate-300 rounded px-1 py-1 bg-white overflow-hidden">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={updDaraRate}
                          onChange={(e) => setUpdDaraRate(e.target.value)}
                          className="w-5 min-w-0 text-center font-mono text-[11px] focus:outline-none"
                        />
                        {/* Commission isn't its own stored field — same 100-minus-rate
                            relationship as the Add popup, computed live from the real
                            Dara/Akhar rate here rather than left blank or hardcoded. */}
                        <span className="text-slate-400 text-[11px]">/</span>
                        <span className="w-5 text-center font-mono text-[11px] text-slate-500">
                          {updDaraRate === '' ? '' : 100 - (parseFloat(updDaraRate) || 0)}
                        </span>
                        <span className="text-slate-400 text-[11px]">-</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={updAkharRate}
                          onChange={(e) => setUpdAkharRate(e.target.value)}
                          className="w-4 min-w-0 text-center font-mono text-[11px] focus:outline-none"
                        />
                        <span className="text-slate-400 text-[11px]">/</span>
                        <span className="w-5 text-center font-mono text-[11px] text-slate-500">
                          {updAkharRate === '' ? '' : 100 - (parseFloat(updAkharRate) || 0) * 10}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Rebate</label>
                      <input
                        type="text"
                        value={updRebate}
                        onChange={(e) => setUpdRebate(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Limit</label>
                      <select
                        value={updHasLimit}
                        onChange={(e) => setUpdHasLimit(e.target.value as 'Yes' | 'No')}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Dibba</label>
                      <select
                        value={updDibba}
                        onChange={(e) => setUpdDibba(e.target.value as 'YES' | 'NO')}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        <option value="NO">NO</option>
                        <option value="YES">YES</option>
                      </select>
                    </div>
                  </div>

                  <div className="w-1/4 pr-1.5">
                    <label className="block text-slate-700 font-medium mb-1">D-Amt</label>
                    <input
                      type="text"
                      value={updDAmt}
                      onChange={(e) => setUpdDAmt(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Agent</label>
                      <input
                        list="update-agents"
                        type="text"
                        value={updAgentName}
                        onChange={(e) => setUpdAgentName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 uppercase focus:outline-none focus:border-blue-500"
                      />
                      <datalist id="update-agents">
                        {agents.map((a) => <option key={a.id} value={a.agentName} />)}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">HP Ledger</label>
                      <select
                        value={updHpLedgerId}
                        onChange={(e) => setUpdHpLedgerId(e.target.value ? parseInt(e.target.value, 10) : '')}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        <option value="">-</option>
                        {ledgers.filter(o => o.id !== updateLedgerDetail?.id).map(o => (
                          <option key={o.id} value={o.id}>{o.partyName}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Ref-Ledger</label>
                      <select
                        value={updRefLedgerId}
                        onChange={(e) => setUpdRefLedgerId(e.target.value ? parseInt(e.target.value, 10) : '')}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        <option value="">-</option>
                        {ledgers.filter(o => o.id !== updateLedgerDetail?.id).map(o => (
                          <option key={o.id} value={o.id}>{o.partyName}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Real Name</label>
                      <input
                        type="text"
                        value={updRealName}
                        onChange={(e) => setUpdRealName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#fef08a] border border-amber-300 rounded text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Grantor/Rmk</label>
                      <input
                        type="text"
                        value={updGrantor}
                        onChange={(e) => setUpdGrantor(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Dealing</label>
                      <select
                        value={updDealing}
                        onChange={(e) => setUpdDealing(e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500"
                      >
                        <option value="DAILY">DAILY</option>
                        <option value="WEEKLY">WEEKLY</option>
                        <option value="MONTHLY">MONTHLY</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Mobile</label>
                      <input
                        type="text"
                        value={updMobile}
                        onChange={(e) => setUpdMobile(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium mb-1">Address</label>
                      <input
                        type="text"
                        value={updAddress}
                        onChange={(e) => setUpdAddress(e.target.value)}
                        placeholder="ADDRESSS"
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-blue-500 uppercase"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={updateSaving}
                      className="px-6 py-1.5 bg-[#152847] hover:bg-[#1e3a68] active:bg-[#0f1d33] text-white font-bold rounded text-xs transition-colors shadow-xs disabled:opacity-50"
                    >
                      {updateSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Right column: 3rd Party summary (read-only) — reflects the real rows
                    configured on the Re-Config tab (ledger_third_party_links), each shown as
                    its own stacked box, matching the live reference exactly. Hissa always
                    includes the party's own Self Hissa as a trailing "{%} | {own name}" box
                    alongside any real 3rd-party Hissa links, since live shows both together. */}
                <div className="w-full md:w-[37%] space-y-3 flex flex-col justify-start">
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">3rd Party Commission</label>
                    {tpcLinks.length > 0 ? (
                      <div className="space-y-1">
                        {tpcLinks.map(l => (
                          <div key={l.id} className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 cursor-not-allowed">
                            {numOnly(l.dComm)}/{numOnly(l.aComm)} | {l.partyName}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="w-full px-2.5 py-1.5 text-xs text-slate-800">-</div>
                    )}
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">3rd Party Rebate</label>
                    {tpvLinks.length > 0 ? (
                      <div className="space-y-1">
                        {tpvLinks.map(l => (
                          <div key={l.id} className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 cursor-not-allowed">
                            {numOnly(l.percent)} | {l.partyName}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="w-full px-2.5 py-1.5 text-xs text-slate-800">-</div>
                    )}
                  </div>
                  <div>
                    <label className="block text-slate-700 font-medium mb-1">Hissa</label>
                    {(hissaLinks.length > 0 || (updateLedgerDetail?.hissaPercentage ?? 0) > 0) ? (
                      <div className="space-y-1">
                        {hissaLinks.map(l => (
                          <div key={l.id} className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 cursor-not-allowed">
                            {numOnly(l.percent)} | {l.partyName}
                          </div>
                        ))}
                        {(updateLedgerDetail?.hissaPercentage ?? 0) > 0 && (
                          <div className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs font-bold text-slate-800 cursor-not-allowed">
                            {numOnly(updateLedgerDetail!.hissaPercentage)} | {updateLedgerDetail!.partyName}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-full px-2.5 py-1.5 text-xs text-slate-800">-</div>
                    )}
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
