import { pgTable, serial, varchar, timestamp, boolean, integer, numeric } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { shifts } from './shifts.js';

export const declarations = pgTable('declarations', {
  id: serial('id').primaryKey(),
  shiftId: integer('shift_id').references(() => shifts.id).notNull(),
  winningNumber: varchar('winning_number', { length: 10 }).notNull(),
  totalCollected: numeric('total_collected', { precision: 14, scale: 2 }).default('0.00').notNull(),
  totalPayout: numeric('total_payout', { precision: 14, scale: 2 }).default('0.00').notNull(),
  netProfitLoss: numeric('net_profit_loss', { precision: 14, scale: 2 }).default('0.00').notNull(),
  declaredBy: integer('declared_by').references(() => users.id).notNull(),
  declaredAt: timestamp('declared_at').defaultNow().notNull(),
  isReversed: boolean('is_reversed').default(false).notNull(),
  reversedBy: integer('reversed_by').references(() => users.id),
  reversedAt: timestamp('reversed_at'),
});
