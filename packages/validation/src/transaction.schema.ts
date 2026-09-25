import { z } from 'zod';

export const transactionEntrySchema = z.object({
  entryType: z.enum(['DARA', 'HARUF_ANDAR', 'HARUF_BAHAR']),
  // Up to 4 characters, matching the transaction_entries.number_value varchar(4) column and
  // the ranges Add Transaction's own "Utar Mode Instructions" advertise: Dara 1-100 (3 chars
  // at the top end), Bahar Akhar 000-999 (3), Andar Akhar 0000-9999 (4). This was max(2),
  // which rejected every 3- and 4-character entry with a bare "Validation failed" 400 even
  // though the column and the on-screen instructions both allow them.
  numberValue: z.string().min(1).max(4),
  amount: z.number().positive('Amount must be positive'),
});

export const createTransactionSchema = z.object({
  shiftId: z.number().int().positive('Shift ID required'),
  partyId: z.number().int().positive('Party ID required'),
  idempotencyKey: z.string().optional(),
  entries: z.array(transactionEntrySchema).min(1, 'At least one number entry is required'),
});

export const crossGenerateSchema = z.object({
  digits: z.array(z.number().int().min(0).max(9)).min(2, 'At least 2 digits required for crossing'),
  withJoda: z.boolean().default(true),
  amount: z.number().positive('Amount must be positive'),
});

export const fromToGenerateSchema = z.object({
  fromNumber: z.number().int().min(0).max(99),
  toNumber: z.number().int().min(0).max(99),
  withPalti: z.boolean().default(false),
  amount: z.number().positive('Amount must be positive'),
}).refine(data => data.fromNumber <= data.toNumber, {
  message: 'fromNumber must be less than or equal to toNumber',
  path: ['fromNumber'],
});

export const randomGenerateSchema = z.object({
  count: z.number().int().min(1).max(100),
  amount: z.number().positive('Amount must be positive'),
});
