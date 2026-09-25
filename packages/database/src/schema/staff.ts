import { pgTable, serial, varchar, timestamp, boolean, integer, numeric, text, jsonb } from 'drizzle-orm/pg-core';
import { users } from './auth.js';

export const staff = pgTable('staff', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  fullName: varchar('full_name', { length: 100 }).notNull(),
  role: varchar('role', { length: 50 }).default('TALLY OPERATOR'),
  designation: varchar('designation', { length: 50 }).notNull(), // Data Entry, Auditor, Manager, etc.
  username: varchar('username', { length: 50 }).default('NONE'),
  password: varchar('password', { length: 100 }).default('123456'),
  wMode: varchar('w_mode', { length: 50 }).default('NONE'),
  mobile: varchar('mobile', { length: 50 }),
  address: varchar('address', { length: 255 }).default(''),
  agent: varchar('agent', { length: 100 }).default(''),
  isActive: boolean('is_active').default(true).notNull(),
  updatedBy: varchar('updated_by', { length: 50 }).default('A100'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  monthlySalary: numeric('monthly_salary', { precision: 10, scale: 2 }).default('0.00').notNull(),
  salaryStructure: jsonb('salary_structure').default({ earnings: [], deductions: [] }),
  isWorkingLive: boolean('is_working_live').default(false).notNull(),
  assignedStation: varchar('assigned_station', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});


export const staffAssets = pgTable('staff_assets', {
  id: serial('id').primaryKey(),
  staffId: integer('staff_id').references(() => staff.id).notNull(),
  assetName: varchar('asset_name', { length: 100 }).notNull(), // Laptop, Keyboard, Mouse, Mobile, etc.
  amount: numeric('amount', { precision: 12, scale: 2 }).default('0.00').notNull(),
  type: varchar('type', { length: 20 }).default('Issue').notNull(), // Issue, Return
  brand: varchar('brand', { length: 100 }).default('').notNull(),
  serialNumber: varchar('serial_number', { length: 100 }),
  remark: varchar('remark', { length: 255 }).default('').notNull(),
  assignedDate: timestamp('assigned_date').defaultNow().notNull(),
  returnDate: timestamp('return_date'),
  notes: text('notes'),
  updatedBy: varchar('updated_by', { length: 50 }).default('A100').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

