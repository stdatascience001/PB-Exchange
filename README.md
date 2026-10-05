# PB Exchange

Role-based transaction and operational management system (shifts, ledgers, transactions, Jantri, declarations, vouchers, reports, staff and payroll). An npm-workspaces monorepo: an Express API, a React web app, a background worker and shared packages.

## Project layout

```
apps/
  api/        Express + TypeScript REST API (port 4000, prefix /api/v1)
  web/        React + Vite + Tailwind front end (port 3000, proxies /api to the API)
  worker/     Daily shift rollover job
packages/
  database/   Drizzle ORM schema, Postgres client, migrate / seed / live-data import
  types/      Shared TypeScript types (DTOs, roles)
  validation/ Shared Zod request schemas
scripts/      One-off maintenance and check scripts (.mjs)
tests/        Domain tests
```

API modules live in `apps/api/src/modules/`: `auth`, `access-control`, `shifts`, `ledgers`, `agents`, `staff`, `transactions`, `jantri`, `declarations`, `duplicate`, `vouchers`, `dashboard`, `audit`, `messages`, `payroll`.

## Requirements

- Node.js 22+
- PostgreSQL (local dev uses port 5434)
- Redis (caching, plus pub/sub for the live SSE updates)

## Setup

```bash
npm install
```

Create the environment files. `apps/api/.env.example` is the template; `packages/database/.env` takes the same keys.

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | api, database, worker | Postgres connection string |
| `PORT`, `API_PREFIX`, `CORS_ORIGIN` | api | Defaults: `4000`, `/api/v1`, `http://localhost:3000` |
| `JWT_SECRET` | api | Token signing secret. Set your own in production |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | api | Redis connection |
| `LOGIN_BLOCK_MINUTES` | api | Optional. `0` (default) means an IP blocked after 3 wrong logins stays blocked until an admin unblocks it |
| `ROLLOVER_TIME`, `NEXT_DAY_ROLLOVER_TIME` | worker | Defaults: `00:05` and `06:00` (server local time) |
| `VITE_API_URL` | web | Only for split deploys. See `apps/web/.env.example` |

Create the tables. The migrate script runs from the database package's build output, so build it first:

```bash
npm run build --workspace=packages/database
npm run db:migrate
npm run db:seed        # optional: roles and starting data
```

## Running locally

Run each in its own terminal:

```bash
npm run dev:api        # http://localhost:4000
npm run dev:web        # http://localhost:3000
npm run dev:worker     # shift rollover
```

## Build

```bash
npm run build                                   # every workspace
npm run start --workspace=apps/api              # serves the built API
npm run preview --workspace=apps/web            # serves the built web app
```

## Importing live panel data

`packages/database/src/import-live.ts` creates or overwrites ledgers, agents and staff from the live panel's JSON exports. Put `ledgers.json` and `staffs.json` in `packages/database/live-data/`. That folder is git-ignored because it holds real party and staff data.

```bash
cd packages/database
npx tsx src/import-live.ts            # dry run: reports counts, writes nothing
npx tsx src/import-live.ts --apply    # writes to DATABASE_URL
```

- A ledger whose Party Name already exists is overwritten. Ledgers missing from the JSON are left alone.
- Existing staff logins keep their passwords. New logins get password `123456`.
- Take a database backup (`pg_dump`) before `--apply` on any shared database.
- It never runs on its own: not on deploy, and not from `db:migrate`.

## Security behaviour

- **Login:** a JWT valid for 1 day. There is no refresh; after it expires the user logs in again.
- **One account per IP:** a new login from an IP signs out every other open session on that IP (error code `SESSION_REPLACED`).
- **IP block:** 3 wrong logins in a row block the IP. Admins can also block and unblock IPs on the Access Block page. A blocked IP is sent to google.com.
- **Inactive staff:** an inactive staff member who signs in with the right password has that IP sent to google.com for 24 hours.

## Useful commands

| Command | What it does |
|---|---|
| `npm run db:migrate` | Create or upgrade tables and columns (no data) |
| `npm run db:seed` | Seed the base data |
| `npm run db:generate` | Generate Drizzle migration files |
| `npm test` | Run the workspaces' tests |
