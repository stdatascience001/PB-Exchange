export type ShiftStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'DECLARED' | 'AUDITED';

export interface ShiftRoleConfigDto {
  id?: number;
  shiftId: number;
  roleId: number;
  roleName?: string;
  openTime: string; // HH:mm:ss
  closeTime: string; // HH:mm:ss
  isActive: boolean;
}

export interface ShiftDto {
  id: number;
  name: string;
  openDate: string; // YYYY-MM-DD
  isNextDay: boolean;
  status: ShiftStatus;
  declaredNumber?: string | null;
  createdAt: string;
  roleConfigs?: ShiftRoleConfigDto[];
  timeRemainingSeconds?: number;
  isEntryAllowedForRole?: boolean;
  // Shifts page drag & drop position (1..N); 0 = never ordered.
  sortOrder?: number;
  // True once this shift's cycle cut-off (for the caller's role) has passed — Add Transaction's
  // Save shows "Transaction time has been over!". Undefined when the role has no timing set.
  isTransactionTimeOver?: boolean;
  // A valid Declare Trans Permission override lets this user keep saving past the cut-off.
  hasTimeOverride?: boolean;
  shiftFor?: string;
  isActive?: boolean;
  updatedBy?: string;
  updatedAt?: string;

  // Time tab
  fanterPanelTime?: string;
  mainJantriTime?: string;

  // Config tab
  applyShiftConfig?: boolean;
  dRate?: number;
  dCommission?: number;
  aRate?: number;
  aCommission?: number;
  tax?: number;
  transactionCapping?: boolean;
  collectionRoundOff?: number;
  checkLagaiBeforeDeclare?: boolean;
  createVapsi?: boolean;
  resultWebShiftId?: number;

  // Company Config tab
  autoCompanyTransactionActive?: boolean;
  companyUrl?: string;
  companyShiftId?: number;
  companyUsername?: string;
  companyPassword?: string;
  companyDRate?: number;
  companyDComm?: number;
  companyARate?: number;
  companyAComm?: number;
  companyTax?: number;
  companyRemark?: string;
  companyAllow?: boolean;
  companyUpdatedBy?: string;
  companyUpdatedAt?: string | null;
}
