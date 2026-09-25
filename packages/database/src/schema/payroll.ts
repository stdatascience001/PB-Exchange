import { pgTable, serial, integer, varchar, numeric, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { staff } from './staff.js';

export const staffLeaves = pgTable('staff_leaves', {
  id: serial('id').primaryKey(),
  staffId: integer('staff_id').references(() => staff.id).notNull(),
  leaveFrom: varchar('leave_from', { length: 10 }).notNull(),
  leaveTo: varchar('leave_to', { length: 10 }).notNull(),
  lType: varchar('l_type', { length: 20 }).default('ABSENT').notNull(),
  remark: varchar('remark', { length: 255 }).default(''),
  updatedBy: varchar('updated_by', { length: 50 }).default('A100').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const staffAttendance = pgTable('staff_attendance', {
  id: serial('id').primaryKey(),
  staffId: integer('staff_id').references(() => staff.id).notNull(),
  month: varchar('month', { length: 7 }).notNull(), // YYYY-MM
  tDays: integer('t_days').default(0).notNull(),
  present: integer('present').default(0).notNull(),
  payLeave: integer('pay_leave').default(0).notNull(),
  tCount: numeric('t_count', { precision: 14, scale: 2 }).default('0.00').notNull(),
  updatedBy: varchar('updated_by', { length: 50 }).default('A100').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  uniqueStaffMonth: uniqueIndex('unique_staff_attendance_month').on(t.staffId, t.month),
}));

export const salaryRegister = pgTable('salary_register', {
  id: serial('id').primaryKey(),
  staffId: integer('staff_id').references(() => staff.id).notNull(),
  month: varchar('month', { length: 7 }).notNull(), // YYYY-MM
  monthlySalary: numeric('monthly_salary', { precision: 12, scale: 2 }).default('0.00').notNull(),
  presentDays: integer('present_days').default(0).notNull(),
  payLeaveDays: integer('pay_leave_days').default(0).notNull(),
  tDays: integer('t_days').default(0).notNull(),
  netSalary: numeric('net_salary', { precision: 12, scale: 2 }).default('0.00').notNull(),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(), // PENDING, PAID
  paidAt: timestamp('paid_at'),
  updatedBy: varchar('updated_by', { length: 50 }).default('A100').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  uniqueStaffSalaryMonth: uniqueIndex('unique_staff_salary_month').on(t.staffId, t.month),
}));
