import { z } from 'zod';

export const createShiftRoleConfigSchema = z.object({
  roleId: z.number().int().positive(),
  openTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/, 'Format must be HH:mm:ss'),
  closeTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/, 'Format must be HH:mm:ss'),
  isActive: z.boolean().default(true),
});

export const createShiftSchema = z.object({
  name: z.string().min(2, 'Shift name required'),
  openDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD'),
  isNextDay: z.boolean().default(false),
  roleConfigs: z.array(createShiftRoleConfigSchema).optional(),
});

export const declareShiftSchema = z.object({
  winningNumber: z.string().regex(/^\d{1,2}$/, 'Winning number must be 1 or 2 digits (0-99)'),
});

export const updateShiftSchema = z.object({
  name: z.string().min(2, 'Shift name required').optional(),
  openDate: z.string().optional(),
  isNextDay: z.boolean().optional(),
  shiftFor: z.string().optional(),
  roleConfigs: z.array(createShiftRoleConfigSchema).optional(),
});

