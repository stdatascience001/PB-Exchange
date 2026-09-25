export interface VoucherDto {
  id: number;
  voucherNumber: string;
  voucherType: string;
  shiftId: number | null;
  shiftName: string;
  totalAmount: number;
  narration: string | null;
  auditStatus: string;
  createdBy: number;
  createdByUsername: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VoucherEntryDto {
  id: number;
  ledgerId: number;
  partyName: string | null;
  entrySide: string;
  amount: number;
  createdAt: string;
}

export interface ManualVoucherDto extends VoucherDto {
  partyLedgerId: number;
  partyName: string;
  entrySide: string;
  oppositeLedgerId: number;
  oppositePartyName: string;
}

export interface VoucherDuplicateGroupDto {
  partyLedgerId: number;
  partyName: string;
  amount: number;
  voucherDate: string;
  entrySide: string;
  oppositePartyName: string;
  count: number;
  voucherIds: number[];
}
