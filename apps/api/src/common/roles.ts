// Roles whose data is scoped to what they themselves entered, rather than the whole book.
//
// Evidenced on the live reference for DATA ENTRY OPERATOR (pbmax1.com, shift HYDRABAD NIGHT,
// 23-09-2026): operator MANISH KATOCH's dashboard card read 100 / 72 and his Live
// Transactions list held exactly one slip — his own — while SUPER ADMIN KARAN999 saw
// 200 / 117 and both slips (MANISH KATOCH's 100 plus his own 100) for that same shift and
// date. The net figures line up with the usual per-party Commission x Hissa rule on each
// subset: DK ROHIT 20% -> 100 * 0.9 * 0.8 = 72, DK ROHIT 50% -> 100 * 0.9 * 0.5 = 45, and
// 72 + 45 = 117. So the operator is not shown a blanked-out total, he is shown his own.
//
// Deliberately only DATA ENTRY OPERATOR: MANAGER and TALLY OPERATOR share the reduced
// dashboard *panels*, but no reference screenshot shows what their card totals contain, so
// their existing behaviour is left exactly as it was.
const OWN_DATA_ONLY_ROLES = ['DATA ENTRY OPERATOR'];

export function isOwnDataOnlyRole(roleName?: string | null): boolean {
  return !!roleName && OWN_DATA_ONLY_ROLES.includes(roleName);
}

// The user id a query should be restricted to, or undefined when the role sees everything.
export function ownDataUserId(user?: { userId?: number; roleName?: string } | null): number | undefined {
  if (!user || !isOwnDataOnlyRole(user.roleName)) return undefined;
  return user.userId;
}
