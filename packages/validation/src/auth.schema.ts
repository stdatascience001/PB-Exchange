import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(4, 'Password must be at least 4 characters'),
  captchaId: z.string().optional(),
  captchaAnswer: z.string().optional(),
});

export const blockIpSchema = z.object({
  ipAddress: z.string().min(7, 'Invalid IP address'),
  reason: z.string().optional(),
});
