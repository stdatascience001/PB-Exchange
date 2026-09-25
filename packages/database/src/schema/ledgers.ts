import { pgTable, serial, varchar, timestamp, boolean, integer, numeric } from 'drizzle-orm/pg-core';
import { users } from './auth.js';

export const agents = pgTable('agents', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  agentName: varchar('agent_name', { length: 100 }).notNull(),
  mainAgentName: varchar('main_agent_name', { length: 100 }),
  parentAgentName: varchar('parent_agent_name', { length: 100 }),
  parentAgentId: integer('parent_agent_id'),
  commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  hissaPercentage: numeric('hissa_percentage', { precision: 5, scale: 2 }).default('0.00').notNull(),
  contactNumber: varchar('contact_number', { length: 20 }),
  updatedBy: varchar('updated_by', { length: 50 }).default('A100').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ledgers = pgTable('ledgers', {
  id: serial('id').primaryKey(),
  partyName: varchar('party_name', { length: 100 }).notNull().unique(),
  realName: varchar('real_name', { length: 100 }),
  groupName: varchar('group_name', { length: 100 }),
  agentId: integer('agent_id').references(() => agents.id),
  distributorId: integer('distributor_id'),
  retailerId: integer('retailer_id'),
  refLedgerId: integer('ref_ledger_id'),
  hpLedgerId: integer('hp_ledger_id'),
  telegram: varchar('telegram', { length: 100 }),
  mobile: varchar('mobile', { length: 20 }),
  address: varchar('address', { length: 255 }).default(''),
  grantor: varchar('grantor', { length: 255 }).default(''),
  dealing: varchar('dealing', { length: 20 }).default('DAILY'),
  rebate: numeric('rebate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  dibba: boolean('dibba').default(false).notNull(),
  dAmt: numeric('d_amt', { precision: 12, scale: 2 }).default('0.00').notNull(),
  daraRate: numeric('dara_rate', { precision: 8, scale: 2 }).default('90.00').notNull(),
  akharRate: numeric('akhar_rate', { precision: 8, scale: 2 }).default('9.00').notNull(),
  commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  hissaPercentage: numeric('hissa_percentage', { precision: 5, scale: 2 }).default('0.00').notNull(),
  betLimit: numeric('bet_limit', { precision: 12, scale: 2 }).default('0.00').notNull(),
  capping: numeric('capping', { precision: 12, scale: 2 }).default('0.00').notNull(),
  userName: varchar('user_name', { length: 50 }),
  vapsiTpr: varchar('vapsi_tpr', { length: 50 }).default('10 | NO').notNull(),
  hasLimit: boolean('has_limit').default(false).notNull(),
  isLocked: boolean('is_locked').default(false).notNull(),
  isRisky: boolean('is_risky').default(false).notNull(),
  updatedBy: varchar('updated_by', { length: 100 }).default('A100').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  // Ledger Update popup — Password / Account tabs
  password: varchar('password', { length: 100 }).default('123456').notNull(),
  isHidden: boolean('is_hidden').default(false).notNull(),

  // Ledger Update popup — Re-Config tab's 2 checkboxes
  masterLedgerConfig: boolean('master_ledger_config').default(false).notNull(),
  isTransactionAllow: boolean('is_transaction_allow').default(true).notNull(),
});

// Ledger Update popup's Re-Config tab — Hissa Party / 3rd Party Comm / 3rd Party Rebate are
// each a small multi-row list of (party name, split%) attached to one "owner" ledger; unified
// into one table (linkType tells them apart) rather than three near-identical ones.
export const ledgerThirdPartyLinks = pgTable('ledger_third_party_links', {
  id: serial('id').primaryKey(),
  ledgerId: integer('ledger_id').references(() => ledgers.id, { onDelete: 'cascade' }).notNull(),
  linkType: varchar('link_type', { length: 10 }).notNull(), // HISSA, TPC (3rd Party Comm), TPV (3rd Party Rebate)
  partyName: varchar('party_name', { length: 100 }).notNull(),
  percent: numeric('percent', { precision: 5, scale: 2 }).default('0.00').notNull(),
  dComm: numeric('d_comm', { precision: 5, scale: 2 }).default('0.00').notNull(),
  aComm: numeric('a_comm', { precision: 5, scale: 2 }).default('0.00').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
