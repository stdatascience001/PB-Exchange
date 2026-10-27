// Shapes returned by the existing PB Exchange API (same as the web app reads them)

export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

export interface UserSession {
  userId: number;
  username: string;
  roleId: number;
  roleName: string;
}

export interface Captcha {
  id: string;
  question: string;
}

export interface LoginResult {
  token: string;
  user: UserSession;
}

export interface DashboardShift {
  id: number;
  name: string;
  openDate: string;
  rawOpenDate: string;
  status: string;
  declaredNumber: string | null;
  totalAmount: number;
  totalCount: number;
  totalPayout: number;
  netAmount: number;
  cutoffPassed: boolean;
  timeRemainingSeconds: number;
  isActive?: boolean;
}

export interface StaffWorking {
  id: number;
  code: string;
  fullName: string;
  username?: string;
  partyName?: string;
  role?: string;
  designation: string;
  isWorkingLive: boolean;
  status: 'WORKING' | 'IDLE';
  timestamp: string;
}

export interface DashboardMetrics {
  shifts: DashboardShift[];
  declareNeeded: Array<{ id: number; name: string; openDate: string; status: string; isDeclared?: boolean }>;
  unverifiedShifts: Array<{ id: number; name: string; declaredNumber: string | null; openDate: string }>;
  staffWorking: StaffWorking[];
}

export interface Ledger {
  id: number;
  partyName: string;
  realName?: string | null;
  userName?: string | null;
  groupName?: string | null;
  agentId?: number | null;
  agentName?: string | null;
  mobile?: string | null;
  daraRate: number | string;
  akharRate: number | string;
  commissionRate: number | string;
  isLocked?: boolean;
  addedBy?: string | null;
  updatedBy?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface Agent {
  id: number;
  agentName: string;
  group?: string;
  mainAgentName?: string;
  parentAgentName?: string;
  updatedBy?: string;
  updatedAt?: string;
  createdAt: string;
}

export interface Staff {
  id: number;
  userId: number;
  fullName: string;
  partyName?: string;
  role: string;
  designation: string;
  username: string;
  wMode?: string;
  agent?: string;
  mobile: string;
  address: string;
  isActive: boolean;
  updatedBy: string;
  updatedAt: string;
  createdAt?: string;
}

export interface Shift {
  id: number;
  name: string;
  openDate: string;
  status: string;
  declaredNumber?: string | null;
  isNextDay: boolean;
  isActive?: boolean;
  shiftFor?: string;
  roleConfigs?: ShiftRoleTime[];
  updatedBy?: string;
  updatedAt?: string;
  createdAt: string;
}

// One role's entry window of a shift (GET /shifts/:id/timings, or a shift's roleConfigs)
export interface ShiftRoleTime {
  roleId: number;
  roleName?: string;
  openTime?: string;
  closeTime: string;
  isActive?: boolean;
}

export interface ManualVoucher {
  id: number;
  voucherNumber: string;
  totalAmount: number;
  narration: string | null;
  auditStatus: string;
  partyLedgerId: number;
  partyName: string;
  entrySide: string;
  oppositeLedgerId: number;
  oppositePartyName: string;
  createdByUsername: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  addedAt?: string;
}

export interface TransactionRow {
  id: number;
  slipNumber: string;
  partyName: string;
  totalAmount: number;
  rateStr?: string;
  addedBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt?: string;
  status?: string;
}

export interface MyMessage {
  message: string;
  flashMessage: string;
  updatedAt: string | null;
}
