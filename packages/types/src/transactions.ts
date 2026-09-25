export type EntryType = 'DARA' | 'HARUF_ANDAR' | 'HARUF_BAHAR';

export type TransactionStatus = 'ACTIVE' | 'VOIDED' | 'DUPLICATE_FLAGGED' | 'COPIED_NEXT_SHIFT';

export interface TransactionEntryInput {
  entryType: EntryType;
  numberValue: string; // e.g. "00".."99", or "0".."9"
  amount: number;
}

export interface TransactionCreateInput {
  shiftId: number;
  partyId: number;
  idempotencyKey?: string;
  entries: TransactionEntryInput[];
}

export interface TransactionEntryDto {
  id: number;
  transactionId: number;
  entryType: EntryType;
  numberValue: string;
  amount: number;
  rate: number;
  calculatedPayout: number;
}

export interface TransactionDto {
  id: number;
  slipNumber: string;
  shiftId: number;
  shiftName?: string;
  partyId: number;
  partyName?: string;
  totalAmount: number;
  status: TransactionStatus;
  isAudited: boolean;
  createdBy: number;
  creatorUsername?: string;
  entries?: TransactionEntryDto[];
  createdAt: string;
  updatedAt: string;
}

// Input generator payloads for Cross, From-To, Random
export interface CrossGenerateInput {
  digits: number[]; // e.g. [1, 3, 5, 7]
  withJoda: boolean; // include 11, 33, etc.
  amount: number;
}

export interface FromToGenerateInput {
  fromNumber: number; // 0 to 99
  toNumber: number; // 0 to 99
  withPalti: boolean; // include reverse pairs
  amount: number;
}

export interface RandomGenerateInput {
  count: number; // e.g. 10 random numbers
  amount: number;
}
