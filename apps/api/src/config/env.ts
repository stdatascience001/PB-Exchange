import dotenv from 'dotenv';

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  API_PREFIX: process.env.API_PREFIX || '/api/v1',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
  JWT_SECRET: process.env.JWT_SECRET || 'pb_exchange_jwt_secret_key_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1d',
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
};
