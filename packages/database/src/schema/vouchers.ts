import { pgTable, serial, varchar, timestamp, integer, numeric, text } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { ledgers } from './ledgers.js';
import { shifts } from './shifts.js';

export const vouchers = pgTable('vouchers', {
  id: serial('id').primaryKey(),
  voucherNumber: varchar('voucher_number', { length: 40 }).notNull().unique(),
  // WINNING_PAYOUT, BET_COLLECTION, COMMISSION, CASH_RECEIPT, CASH_PAYMENT (system-generated)
  // JOURNAL, LIMIT, KIST, VAPSI, HAWA_PATTI (manual double-entry vouchers)
  voucherType: varchar('voucher_type', { length: 30 }).notNull(),
  shiftId: integer('shift_id').references(() => shifts.id),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
  narration: text('narration'),
  auditStatus: varchar('audit_status', { length: 20 }).default('FOR_AUDIT').notNull(), // FOR_AUDIT, ALLOWED, CANCELED
  createdBy: integer('created_by').references(() => users.id).notNull(),
  updatedBy: varchar('updated_by', { length: 50 }).default('SYSTEM'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const voucherEntries = pgTable('voucher_entries', {
  id: serial('id').primaryKey(),
  voucherId: integer('voucher_id').references(() => vouchers.id, { onDelete: 'cascade' }).notNull(),
  ledgerId: integer('ledger_id').references(() => ledgers.id).notNull(),
  entrySide: varchar('entry_side', { length: 2 }).notNull(), // DR or CR
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
