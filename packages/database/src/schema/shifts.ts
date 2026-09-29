import { pgTable, serial, varchar, timestamp, boolean, integer, numeric, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { roles, users } from './auth.js';

export const shifts = pgTable('shifts', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  openDate: varchar('open_date', { length: 10 }).notNull(), // YYYY-MM-DD
  isNextDay: boolean('is_next_day').default(false).notNull(),
  status: varchar('status', { length: 20 }).default('OPEN').notNull(), // OPEN, CLOSED, DECLARED, AUDITED
  declaredNumber: varchar('declared_number', { length: 10 }),
  shiftFor: varchar('shift_for', { length: 20 }).default('BOTH').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  updatedBy: varchar('updated_by', { length: 100 }).default('A100').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  // Time tab — two shift-wide time fields beyond the 12 per-role cut-offs (shift_role_config).
  fanterPanelTime: varchar('fanter_panel_time', { length: 8 }).default('00:00:00').notNull(),
  mainJantriTime: varchar('main_jantri_time', { length: 8 }).default('00:00:00').notNull(),

  // Config tab
  applyShiftConfig: boolean('apply_shift_config').default(false).notNull(),
  dRate: numeric('d_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  dCommission: numeric('d_commission', { precision: 5, scale: 2 }).default('0.00').notNull(),
  aRate: numeric('a_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  aCommission: numeric('a_commission', { precision: 5, scale: 2 }).default('0.00').notNull(),
  tax: numeric('tax', { precision: 5, scale: 2 }).default('0.00').notNull(),
  transactionCapping: boolean('transaction_capping').default(false).notNull(),
  collectionRoundOff: numeric('collection_round_off', { precision: 12, scale: 2 }).default('0.00').notNull(),
  checkLagaiBeforeDeclare: boolean('check_lagai_before_declare').default(false).notNull(),
  createVapsi: boolean('create_vapsi').default(true).notNull(),
  resultWebShiftId: integer('result_web_shift_id').default(0).notNull(),

  // Company Config tab — a single linked external "company" integration profile per shift.
  autoCompanyTransactionActive: boolean('auto_company_transaction_active').default(false).notNull(),
  companyUrl: varchar('company_url', { length: 255 }).default('').notNull(),
  companyShiftId: integer('company_shift_id').default(0).notNull(),
  companyUsername: varchar('company_username', { length: 100 }).default('').notNull(),
  companyPassword: varchar('company_password', { length: 100 }).default('').notNull(),
  companyDRate: numeric('company_d_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  companyDComm: numeric('company_d_comm', { precision: 5, scale: 2 }).default('0.00').notNull(),
  companyARate: numeric('company_a_rate', { precision: 5, scale: 2 }).default('0.00').notNull(),
  companyAComm: numeric('company_a_comm', { precision: 5, scale: 2 }).default('0.00').notNull(),
  companyTax: numeric('company_tax', { precision: 5, scale: 2 }).default('0.00').notNull(),
  companyRemark: varchar('company_remark', { length: 255 }).default('').notNull(),
  // Company Config listing's own Allow flag and last-update stamp
  companyAllow: boolean('company_allow').default(true).notNull(),
  companyUpdatedBy: varchar('company_updated_by', { length: 100 }).default('').notNull(),
  companyUpdatedAt: timestamp('company_updated_at'),

  // Display order set by drag & drop on the Shifts page (1..N). 0 = never ordered, which keeps
  // the original ordering (newest first on Shifts, market order on Dashboard) for that shift.
  sortOrder: integer('sort_order').default(0).notNull(),
}, (t) => ({
  shiftDateIdx: index('shifts_date_idx').on(t.openDate, t.status),
}));

export const shiftRoleConfig = pgTable('shift_role_config', {
  id: serial('id').primaryKey(),
  shiftId: integer('shift_id').references(() => shifts.id, { onDelete: 'cascade' }).notNull(),
  roleId: integer('role_id').references(() => roles.id).notNull(),
  openTime: varchar('open_time', { length: 8 }).notNull(), // HH:mm:ss
  closeTime: varchar('close_time', { length: 8 }).notNull(), // HH:mm:ss
  isActive: boolean('is_active').default(true).notNull(),
}, (t) => ({
  uniqueShiftRole: uniqueIndex('unique_shift_role').on(t.shiftId, t.roleId),
}));

export const operatorShiftPermissions = pgTable('operator_shift_permissions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  shiftId: integer('shift_id').references(() => shifts.id).notNull(),
  shiftDate: varchar('shift_date', { length: 10 }).notNull(),
  canAllow: boolean('can_allow').default(true).notNull(),
  canAdd: boolean('can_add').default(true).notNull(),
  canEdit: boolean('can_edit').default(false).notNull(),
  canDelete: boolean('can_delete').default(false).notNull(),
  canExport: boolean('can_export').default(false).notNull(),
  dataScope: varchar('data_scope', { length: 10 }).default('SELF').notNull(), // ALL or SELF
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
