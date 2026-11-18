import { Request } from 'express';
import { env } from '../config/env.js';
import { ForbiddenError } from '../common/errors.js';

// Server-side mirror of the website's role rules (apps/web/src/config/roleAccess.ts). The web
// app and the Android app only hide pages; this makes the API refuse the same things, so a
// signed-in user can't reach them by calling the API directly. Checked from authenticate()
// right after the token is accepted, before each route's own requireRoles().
//
// - MANAGER / DATA ENTRY OPERATOR / TALLY OPERATOR have an allow-list: only the endpoints the
//   pages they can open (and the app shell: header, messages, heartbeat) actually call.
// - ADMIN has a deny-list: the endpoints called ONLY by the pages / menus the website hides
//   from ADMIN (ADMIN_RESTRICTED_PAGES + the Utilities and Payroll menus).
// - Every other role is unrestricted here, exactly as on the website.

type Rule = { methods: string[] | '*'; path: RegExp };
const any = (path: RegExp): Rule => ({ methods: '*', path });
const get = (path: RegExp): Rule => ({ methods: ['GET', 'HEAD'], path });
const on = (methods: string[], path: RegExp): Rule => ({ methods, path });

// Every signed-in page: header / profile, dashboard, role message, live shift list, heartbeat
const SHELL: Rule[] = [
  any(/^\/auth\//),
  get(/^\/dashboard(\/metrics|\/stream)?$/),
  get(/^\/messages\/mine$/),
  get(/^\/settings\/declare-highlight$/),
  get(/^\/shifts(\/stream)?$/),
  on(['POST'], /^\/staff\/heartbeat$/),
  // Dashboard → ReDeclare popup (each route still requires an admin role itself)
  any(/^\/declarations\/redeclare\/\d+$/),
  on(['POST'], /^\/declarations\/\d+\/verify$/),
];

// Live / Declare Transactions, Add / Edit Entry and the Jantri views they open
const TRANSACTION_PAGES: Rule[] = [
  get(/^\/ledgers(\/search)?$/),
  get(/^\/jantri\/\d+(\/net|\/distributor\/\d+)?$/),
  get(/^\/transactions$/),
  get(/^\/transactions\/(absent-parties|collection|kwada|cut-factors)$/),
  get(/^\/transactions\/\d+(\/entries)?$/),
  on(['POST'], /^\/transactions(\/declare)?$/),
  on(['POST'], /^\/transactions\/generate\/(cross|from-to|random)$/),
  on(['PATCH'], /^\/transactions\/\d+(\/entries|\/declare-entries)?$/),
  on(['DELETE'], /^\/transactions\/\d+$/),
  on(['POST'], /^\/transactions\/\d+\/copy-next-shift$/),
];

const ALLOW: Record<string, Rule[]> = {
  // Dashboard + OutStanding / Daily / All Shift reports
  MANAGER: [
    ...SHELL,
    get(/^\/agents$/),
    get(/^\/transactions\/(outstanding|daily-report|all-shift-report|collection)$/),
    get(/^\/vouchers\/cash-agent-ledgers$/),
  ],
  // Dashboard + Transactions / Declare Transactions (+ Add / Edit Entry)
  'DATA ENTRY OPERATOR': [...SHELL, ...TRANSACTION_PAGES],
  // Dashboard + Transactions / Declare Transactions / Declare Trans Audit + Daily Report
  'TALLY OPERATOR': [
    ...SHELL,
    ...TRANSACTION_PAGES,
    get(/^\/agents$/),
    on(['PATCH'], /^\/transactions\/\d+\/audit$/),
    get(/^\/transactions\/daily-report$/),
  ],
};

const DENY: Record<string, Rule[]> = {
  ADMIN: [
    // Access Block
    any(/^\/access(\/.*)?$/),
    // Utilities → Message / Flash Message manage (an ADMIN still reads its own /messages/mine)
    any(/^\/messages(\/(?!mine$)[^/]+)?$/),
    // Payroll menu
    any(/^\/payroll(\/.*)?$/),
    // Master → Shift (add / edit / timings / order / trans permission); the shift list stays
    on(['POST'], /^\/shifts$/),
    any(/^\/shifts\/(\d+|reorder|permissions)(\/.*)?$/),
    // Master → Staff Salary/Assets
    any(/^\/staff\/\d+\/(salary|status-flag)$/),
    any(/^\/staff\/assets(\/\d+)?$/),
    // Voucher Audit, Duplicate Voucher
    on(['PATCH'], /^\/vouchers\/\d+\/audit$/),
    get(/^\/vouchers\/duplicates$/),
    // Result → Transaction ASC; Reports → Settling / Profit-Loss / Trial Balance / Cash;
    // Track Reports → Before-After Declare, P/L Before-After Declare, Productivity Shift, After Timing
    get(/^\/transactions\/(entries\/asc|settling-report(?:\/day)?|shift-profit-loss|trial-balance|cash-agent-report|before-after-declare|pl-before-after-declare|productivity-shift|after-timing)$/),
  ],
};

const matches = (rules: Rule[], method: string, path: string) =>
  rules.some((r) => (r.methods === '*' || r.methods.includes(method)) && r.path.test(path));

// The request path below the API prefix, e.g. "/transactions/12/entries"
function apiPath(req: Request): string {
  let path = (req.originalUrl || req.url).split('?')[0];
  if (path.startsWith(env.API_PREFIX)) path = path.slice(env.API_PREFIX.length);
  path = path.replace(/\/+$/, '');
  return path || '/';
}

export function assertRoleMayCall(req: Request) {
  const role = String(req.user?.roleName || '').toUpperCase().replace(/_/g, ' ').trim();
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') return;
  const path = apiPath(req);

  const allow = ALLOW[role];
  if (allow && !matches(allow, method, path)) {
    throw new ForbiddenError('Access denied for your role');
  }
  const deny = DENY[role];
  if (deny && matches(deny, method, path)) {
    throw new ForbiddenError('Access denied for your role');
  }
}
