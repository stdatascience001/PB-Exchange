import { z } from 'zod';

export const loginSchema = z.object({
  // Any non-empty username: staff log in with short ones like T1 / T2 (a 3-character minimum
  // refused them with "Validation failed" before the password was even checked)
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(4, 'Password must be at least 4 characters'),
  captchaId: z.string().optional(),
  captchaAnswer: z.string().optional(),
});

export const blockIpSchema = z.object({
  ipAddress: z.string().min(7, 'Invalid IP address'),
  reason: z.string().optional(),
});
