// Route params of the app's stacks

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  StaffWorking: undefined;
  Profile: undefined;
  Ledgers: undefined;
  AddLedger: undefined;
  UpdateLedger: { id: number };
  AgentGroups: undefined;
  UpdateAgentGroup: { id: number; agentName: string; mainAgentName?: string; parentAgentName?: string };
  Vouchers: { type: 'JOURNAL' | 'LIMIT' };
  VoucherAudit: undefined;
  Staffs: undefined;
  AddStaff: undefined;
  UpdateStaff: { staff: import('../api/types').Staff };
  Shifts: undefined;
  AddShift: { shift?: import('../api/types').Shift } | undefined;
  UpdateShift: { shift: import('../api/types').Shift };
  Transactions: { shiftId: number; shiftName?: string; date?: string };
  DailyReport: undefined;
  AllShiftReport: undefined;
  ProfitLoss: undefined;
  AdminCash: undefined;
  Outstanding: undefined;
  VoucherReport: undefined;
  CashAgentReport: undefined;
  PaidVapsi: undefined;
  PaidHp: undefined;
  SalaryRegister: undefined;
  LimitBalance: undefined;
  ResultReport: undefined;
  CashReportDetails: { ledgerId: number; name: string; from: string; to: string };
  AgentOutstanding: undefined;
  ShiftTransactions: { shiftId: number; shiftName: string; date: string; declared?: boolean };
  Jantri: { shiftId: number; shiftName: string; date: string; net: boolean };
  ProfitLossShift: { shiftId: number; title: string; from: string; to: string };
  Prediction: undefined;
  Productivity: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Master: undefined;
  Report: undefined;
  Chat: undefined;
};
