import { pgTable, serial, varchar, timestamp, integer, numeric, text, index } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { ledgers } from './ledgers.js';
import { vouchers } from './vouchers.js';

// Kist Voucher page's "Create Kist Voucher" popup: a credit given to a party that is
// recovered in fixed installments (kists) on a DAILY / WEEKLY / MONTHLY cycle.
export const kistPlans = pgTable('kist_plans', {
  id: serial('id').primaryKey(),
  partyLedgerId: integer('party_ledger_id').references(() => ledgers.id).notNull(),
  creditAmount: numeric('credit_amount', { precision: 14, scale: 2 }).notNull(),
  oneKistAmount: numeric('one_kist_amount', { precision: 14, scale: 2 }).notNull(),
  kistType: varchar('kist_type', { length: 10 }).notNull(), // DAILY, WEEKLY, MONTHLY
  startDate: varchar('start_date', { length: 10 }).notNull(), // YYYY-MM-DD
  remark: text('remark'),
  createdBy: integer('created_by').references(() => users.id).notNull(),
  updatedBy: varchar('updated_by', { length: 50 }).default('SYSTEM'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// One row per installment of a plan. PENDING until Auto Kist (F3) posts it as a KIST voucher
// (Party Dr / KIST A/C Cr) on its due date, then DONE with that voucher linked.
export const kistSchedule = pgTable('kist_schedule', {
  id: serial('id').primaryKey(),
  planId: integer('plan_id').references(() => kistPlans.id, { onDelete: 'cascade' }).notNull(),
  partyLedgerId: integer('party_ledger_id').references(() => ledgers.id).notNull(),
  kistNo: integer('kist_no').notNull(),
  kistDate: varchar('kist_date', { length: 10 }).notNull(), // YYYY-MM-DD
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  status: varchar('status', { length: 10 }).default('PENDING').notNull(), // PENDING, DONE
  voucherId: integer('voucher_id').references(() => vouchers.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  partyIdx: index('kist_schedule_party_idx').on(t.partyLedgerId, t.kistDate),
  dueIdx: index('kist_schedule_due_idx').on(t.status, t.kistDate),
}));
