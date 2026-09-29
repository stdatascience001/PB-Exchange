import { pgTable, serial, varchar, timestamp, integer, numeric, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { shifts } from './shifts.js';
import { ledgers } from './ledgers.js';
import { declarations } from './declarations.js';

// Dashboard "Declare Needed" → ReDeclare popup (DECLARE INFO): the per-party Sale / P&L a
// declaration was made on. Compared against a live recompute of the same shift + cycle date,
// a difference (slip added / edited / deleted, or a party's Comm/Hissa/TPC changed after the
// declare) puts the declaration back in Declare Needed with a ReDeclare button. One header
// row per declaration; RE-DECLARE replaces its party rows and moves snapshot_at forward.
export const declarationSnapshots = pgTable('declaration_snapshots', {
  id: serial('id').primaryKey(),
  declarationId: integer('declaration_id').references(() => declarations.id, { onDelete: 'cascade' }).notNull(),
  shiftId: integer('shift_id').references(() => shifts.id).notNull(),
  cycleDate: varchar('cycle_date', { length: 10 }).notNull(), // YYYY-MM-DD
  totalSale: numeric('total_sale', { precision: 14, scale: 2 }).default('0.00').notNull(),
  totalPl: numeric('total_pl', { precision: 14, scale: 2 }).default('0.00').notNull(),
  redeclareCount: integer('redeclare_count').default(0).notNull(),
  snapshotAt: timestamp('snapshot_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  declarationIdx: uniqueIndex('declaration_snapshots_declaration_idx').on(t.declarationId),
  shiftCycleIdx: index('declaration_snapshots_shift_cycle_idx').on(t.shiftId, t.cycleDate),
}));

export const declarationPartySnapshots = pgTable('declaration_party_snapshots', {
  id: serial('id').primaryKey(),
  snapshotId: integer('snapshot_id').references(() => declarationSnapshots.id, { onDelete: 'cascade' }).notNull(),
  partyId: integer('party_id').references(() => ledgers.id).notNull(),
  partyName: varchar('party_name', { length: 100 }).notNull(),
  sale: numeric('sale', { precision: 14, scale: 2 }).default('0.00').notNull(),
  pl: numeric('pl', { precision: 14, scale: 2 }).default('0.00').notNull(),
}, (t) => ({
  snapshotIdx: index('declaration_party_snapshots_snapshot_idx').on(t.snapshotId),
}));
