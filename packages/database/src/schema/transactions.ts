import { pgTable, serial, varchar, timestamp, boolean, integer, numeric, index } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { shifts } from './shifts.js';
import { ledgers } from './ledgers.js';

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  slipNumber: varchar('slip_number', { length: 40 }).notNull().unique(),
  shiftId: integer('shift_id').references(() => shifts.id).notNull(),
  partyId: integer('party_id').references(() => ledgers.id).notNull(),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, VOIDED, DUPLICATE_FLAGGED, COPIED_NEXT_SHIFT
  idempotencyKey: varchar('idempotency_key', { length: 64 }).unique(),
  isAudited: boolean('is_audited').default(false).notNull(),
  rateStr: varchar('rate_str', { length: 50 }).default('90/10-9/10'),
  ujType: varchar('uj_type', { length: 10 }).default('J'),
  addedBy: varchar('added_by', { length: 50 }).default('SYSTEM'),
  updatedBy: varchar('updated_by', { length: 50 }).default('SYSTEM'),
  isD: boolean('is_d').default(true),
  auditStatus: varchar('audit_status', { length: 20 }).default('NOT-AUDIT'),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  partyShiftIdx: index('trans_party_shift_idx').on(t.shiftId, t.partyId, t.status),
  createdIdx: index('trans_created_idx').on(t.createdAt),
}));

export const transactionEntries = pgTable('transaction_entries', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id').references(() => transactions.id, { onDelete: 'cascade' }).notNull(),
  entryType: varchar('entry_type', { length: 20 }).notNull(), // DARA, HARUF_ANDAR, HARUF_BAHAR
  numberValue: varchar('number_value', { length: 4 }).notNull(), // "00"-"99", or "0"-"9"
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  rate: numeric('rate', { precision: 8, scale: 2 }).notNull(),
  calculatedPayout: numeric('calculated_payout', { precision: 14, scale: 2 }).default('0.00').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  transNumberIdx: index('entry_trans_num_idx').on(t.transactionId, t.numberValue),
  numberShiftIdx: index('entry_number_val_idx').on(t.numberValue),
}));

export const duplicateReviews = pgTable('duplicate_reviews', {
  id: serial('id').primaryKey(),
  originalTransactionId: integer('original_transaction_id').references(() => transactions.id).notNull(),
  duplicateTransactionId: integer('duplicate_transaction_id').references(() => transactions.id).notNull(),
  similarityScore: numeric('similarity_score', { precision: 5, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(), // PENDING, CONFIRMED, DISMISSED
  reviewedBy: integer('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
