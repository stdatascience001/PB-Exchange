import { pgTable, serial, varchar, timestamp, boolean, integer, text } from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 60 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  roleId: integer('role_id').references(() => roles.id).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const blockedIps = pgTable('blocked_ips', {
  id: serial('id').primaryKey(),
  ipAddress: varchar('ip_address', { length: 45 }).notNull().unique(),
  reason: text('reason'),
  blockedBy: integer('blocked_by').references(() => users.id).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  unblockedAt: timestamp('unblocked_at'),
});
