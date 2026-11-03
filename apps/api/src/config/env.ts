import dotenv from 'dotenv';

dotenv.config();

// Browser origins allowed to call the API (CORS). CORS_ORIGIN may list several, comma-separated
// (e.g. "https://punjabking.supremetechnologiesindia.com,http://localhost:3000"). The Android
// app's web build in development (`expo start --web` on 8081 / 8082, or 19006) is always allowed
// too, so it can talk to this API straight from the browser. The phone app itself is not a
// browser and is not affected by CORS.
const EXPO_WEB_DEV_ORIGINS = [
  'http://localhost:8081', 'http://localhost:8082', 'http://localhost:19006',
  'http://127.0.0.1:8081', 'http://127.0.0.1:8082', 'http://127.0.0.1:19006',
];
const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  API_PREFIX: process.env.API_PREFIX || '/api/v1',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
  CORS_ORIGINS: [...new Set([...configuredOrigins, ...EXPO_WEB_DEV_ORIGINS])],
  JWT_SECRET: process.env.JWT_SECRET || 'pb_exchange_jwt_secret_key_2026',
  // How many reverse proxies sit in front of the API (live: nginx = 1). The client IP used for
  // login blocking / Access Block / sessions is the address the nearest trusted proxy saw — not
  // the first X-Forwarded-For entry, which any client can write itself.
  TRUST_PROXY_HOPS: Math.max(0, parseInt(process.env.TRUST_PROXY_HOPS || '1', 10) || 0),
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
};
