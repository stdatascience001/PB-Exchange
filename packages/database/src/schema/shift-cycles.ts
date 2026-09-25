import { pgTable, serial, integer, varchar, numeric, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { shifts } from './shifts.js';

export const shiftCycles = pgTable('shift_cycles', {
  id: serial('id').primaryKey(),
  shiftId: integer('shift_id').references(() => shifts.id).notNull(),
  cycleDate: varchar('cycle_date', { length: 10 }).notNull(), // YYYY-MM-DD
  status: varchar('status', { length: 20 }).default('OPEN').notNull(), // OPEN, CLOSED, DECLARED
  declaredNumber: varchar('declared_number', { length: 10 }),
  totalCollected: numeric('total_collected', { precision: 14, scale: 2 }).default('0.00').notNull(),
  totalPayout: numeric('total_payout', { precision: 14, scale: 2 }).default('0.00').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqueShiftCycle: uniqueIndex('unique_shift_cycle').on(t.shiftId, t.cycleDate),
}));
