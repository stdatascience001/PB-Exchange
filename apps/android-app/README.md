# PB Exchange — Mobile (Android / iOS)

React Native + Expo (SDK 52, TypeScript strict) app for PB Exchange. It talks to the existing
backend (`/api/v1`) — no backend or database changes.

## Screens

| Tab / menu | Screen | API |
|---|---|---|
| Login | username, password, captcha | `GET /auth/captcha`, `POST /auth/login` |
| Dashboard | greeting, shift cards (result / sale), shift sheet → transactions | `GET /dashboard/stream` (SSE) + `GET /dashboard/metrics` |
| ⋮ / briefcase | Staff Working (live timer) | dashboard feed |
| ⋮ | Profile, Change Password, Logout | `GET /staff`, `POST /auth/change-password` |
| Master | Ledger Management (list, filters, search, Add Ledger) | `GET/POST /ledgers`, `GET /agents` |
| Master | Agent Groups (list, Add Agent Group) | `GET/POST /agents` |
| Master | Payment Transfer / Limit Transfer (list, Add Voucher) | `GET /vouchers/manual`, `POST /vouchers` |
| Master | Voucher Audit / Verify (Allow / Cancel) | `GET /vouchers/manual`, `PATCH /vouchers/:id/audit` |
| Master | All Staffs, All Shifts | `GET /staff`, `GET /shifts` |
| Report | Daily Report, Productivity Report | `GET /transactions/daily-report`, `/transactions/productivity-report` |
| Chat | role messages | `GET /messages/mine` |

Token is kept in the device's secure storage (`expo-secure-store`). A 401 or `SESSION_REPLACED`
signs the app out and shows the reason on the login screen.

## Setup

1. API address — `.env`:
   ```
   EXPO_PUBLIC_API_URL=https://punjabking.supremetechnologiesindia.com/api/v1
   ```
   For a local API use the PC's LAN IP from a phone (`http://192.168.x.x:4000/api/v1`), or
   `http://10.0.2.2:4000/api/v1` from the Android emulator — not `localhost`.
2. Install (from the repo root, this folder is an npm workspace):
   ```
   npm install
   ```

## Run

```
cd apps/android-app
npx expo start          # scan the QR code with Expo Go (Android / iOS)
npx expo start --android
```

## Build

```
npm install -g eas-cli
eas login
npm run build:apk       # installable Android APK (preview profile)
npm run build:android   # Play Store bundle (.aab)
npm run build:ios       # iOS build (Apple account needed)
```

## Checks

```
npm run typecheck
npx expo install --check
```

`_web-copy-backup/` is the copy of the web app that was in this folder before; it is kept for
reference only and is excluded from the mobile build (metro.config.js, tsconfig.json).
