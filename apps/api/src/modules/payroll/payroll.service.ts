import { db, staff, transactions, staffLeaves, staffAttendance, salaryRegister } from '@pb/database';
import { eq, and, ne, inArray, sql, desc } from 'drizzle-orm';
import { AppError, NotFoundError } from '../../common/errors.js';

function daysBetweenInclusive(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function monthRange(month: string): { fromDate: string; toDate: string; tDays: number } {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  return { fromDate, toDate, tDays: to.getUTCDate() };
}

export class PayrollService {
  // Derived report — no persistence. "Attendance" = distinct days with >=1 transaction,
  // "Count" = sum of transactions.totalAmount, both reusing the exact aggregate style
  // already validated in TransactionService.getProductivityReport. Paid/UnPaid come from
  // real staff_leaves rows; Absent is whatever's left over.
  static async getStaffAttendanceReport(filters: { fromDate: string; toDate: string }) {
    const days = daysBetweenInclusive(filters.fromDate, filters.toDate);

    const staffRows = await db.select().from(staff).where(eq(staff.isActive, true));

    const txRows = await db.select({
      userId: transactions.createdBy,
      distinctDays: sql<number>`COUNT(DISTINCT ${transactions.createdAt}::date)::int`,
      tCount: sql<string>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
    })
      .from(transactions)
      .where(and(
        ne(transactions.status, 'VOIDED'),
        sql`${transactions.createdAt}::date >= ${filters.fromDate}::date`,
        sql`${transactions.createdAt}::date <= ${filters.toDate}::date`,
      ))
      .groupBy(transactions.createdBy);
    const txByUser = new Map(txRows.map(r => [r.userId, { distinctDays: r.distinctDays, tCount: parseFloat(r.tCount) }]));

    const leaveRows = await db.select().from(staffLeaves).where(and(
      sql`${staffLeaves.leaveFrom} <= ${filters.toDate}`,
      sql`${staffLeaves.leaveTo} >= ${filters.fromDate}`,
    ));

    return staffRows.map(s => {
      const tx = txByUser.get(s.userId) || { distinctDays: 0, tCount: 0 };
      const myLeaves = leaveRows.filter(l => l.staffId === s.id);

      // Count leave days clamped to the requested range, per type. Overlapping leave rows
      // of the same type aren't expected in normal use, so a simple sum is used rather than
      // building a day-set.
      const countLeaveDays = (type: string) => myLeaves
        .filter(l => l.lType === type)
        .reduce((sum, l) => {
          const from = l.leaveFrom > filters.fromDate ? l.leaveFrom : filters.fromDate;
          const to = l.leaveTo < filters.toDate ? l.leaveTo : filters.toDate;
          return sum + Math.max(0, daysBetweenInclusive(from, to));
        }, 0);

      const paid = countLeaveDays('PAID');
      const unpaid = countLeaveDays('UNPAID');
      const absent = Math.max(0, days - tx.distinctDays - paid - unpaid);

      const username = (s.username && s.username !== 'NONE') ? s.username : s.fullName;
      return {
        staffId: s.id,
        name: `${s.fullName} | ${username}`,
        mobile: s.mobile || '-',
        address: s.address || '-',
        days,
        attendance: tx.distinctDays,
        paid,
        unpaid,
        absent,
        count: tx.tCount,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  static async getPayrollAttendance(filters: { month: string }) {
    const rows = await db.select({
      id: staffAttendance.id,
      staffId: staffAttendance.staffId,
      name: staff.fullName,
      username: staff.username,
      mobile: staff.mobile,
      month: staffAttendance.month,
      tDays: staffAttendance.tDays,
      present: staffAttendance.present,
      payLeave: staffAttendance.payLeave,
      tCount: staffAttendance.tCount,
    })
      .from(staffAttendance)
      .innerJoin(staff, eq(staffAttendance.staffId, staff.id))
      .where(eq(staffAttendance.month, filters.month))
      .orderBy(staff.fullName);

    return rows.map(r => ({ ...r, tCount: parseFloat(r.tCount) }));
  }

  // Populates/refreshes one staff_attendance row per active staff for the month, using the
  // exact same derivation as getStaffAttendanceReport scoped to that month's calendar range.
  static async createAttendance(filters: { month: string }, updatedBy: string) {
    const { fromDate, toDate, tDays } = monthRange(filters.month);
    const report = await this.getStaffAttendanceReport({ fromDate, toDate });

    for (const r of report) {
      const [existing] = await db.select().from(staffAttendance)
        .where(and(eq(staffAttendance.staffId, r.staffId), eq(staffAttendance.month, filters.month)));

      const values = {
        tDays,
        present: r.attendance,
        payLeave: r.paid,
        tCount: r.count.toFixed(2),
        updatedBy,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(staffAttendance).set(values).where(eq(staffAttendance.id, existing.id));
      } else {
        await db.insert(staffAttendance).values({ staffId: r.staffId, month: filters.month, ...values });
      }
    }

    return this.getPayrollAttendance({ month: filters.month });
  }

  static async updateAttendanceRow(id: number, data: { present?: number; payLeave?: number }, updatedBy: string) {
    const [existing] = await db.select().from(staffAttendance).where(eq(staffAttendance.id, id));
    if (!existing) throw new NotFoundError('Attendance row not found');

    const [updated] = await db.update(staffAttendance).set({
      ...(data.present !== undefined ? { present: data.present } : {}),
      ...(data.payLeave !== undefined ? { payLeave: data.payLeave } : {}),
      updatedBy,
      updatedAt: new Date(),
    }).where(eq(staffAttendance.id, id)).returning();

    return updated;
  }

  // Salary = perDaySalary * (present + payLeave); absent days go unpaid, paid-leave days
  // are paid same as present. Standard payroll formula — flagged here since the live
  // reference screenshot had no rows to independently validate it against.
  static async createSalary(filters: { month: string; staffIds?: number[] }, updatedBy: string) {
    const conditions = [eq(staffAttendance.month, filters.month)];
    if (filters.staffIds && filters.staffIds.length > 0) conditions.push(inArray(staffAttendance.staffId, filters.staffIds));

    const attendanceRows = await db.select().from(staffAttendance).where(and(...conditions));
    if (attendanceRows.length === 0) throw new AppError('No attendance rows found for this month. Run Create Attendance first.', 400);

    const staffIds = attendanceRows.map(a => a.staffId);
    const staffRows = await db.select().from(staff).where(inArray(staff.id, staffIds));
    const staffById = new Map(staffRows.map(s => [s.id, s]));

    const results = [];
    for (const a of attendanceRows) {
      const s = staffById.get(a.staffId);
      if (!s) continue;
      const monthlySalary = parseFloat(s.monthlySalary || '0');
      const perDay = a.tDays > 0 ? monthlySalary / a.tDays : 0;
      const netSalary = perDay * (a.present + a.payLeave);

      const [existing] = await db.select().from(salaryRegister)
        .where(and(eq(salaryRegister.staffId, a.staffId), eq(salaryRegister.month, filters.month)));

      const values = {
        monthlySalary: monthlySalary.toFixed(2),
        presentDays: a.present,
        payLeaveDays: a.payLeave,
        tDays: a.tDays,
        netSalary: netSalary.toFixed(2),
        updatedBy,
      };

      if (existing) {
        const [updated] = await db.update(salaryRegister).set(values).where(eq(salaryRegister.id, existing.id)).returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(salaryRegister).values({ staffId: a.staffId, month: filters.month, ...values }).returning();
        results.push(created);
      }
    }
    return results;
  }

  static async getSalaryRegister(filters: { fromMonth: string; toMonth: string; search?: string }) {
    const rows = await db.select({
      id: salaryRegister.id,
      staffId: salaryRegister.staffId,
      name: staff.fullName,
      month: salaryRegister.month,
      tDays: salaryRegister.tDays,
      presentDays: salaryRegister.presentDays,
      payLeaveDays: salaryRegister.payLeaveDays,
      netSalary: salaryRegister.netSalary,
      status: salaryRegister.status,
      paidAt: salaryRegister.paidAt,
    })
      .from(salaryRegister)
      .innerJoin(staff, eq(salaryRegister.staffId, staff.id))
      .where(and(
        sql`${salaryRegister.month} >= ${filters.fromMonth}`,
        sql`${salaryRegister.month} <= ${filters.toMonth}`,
      ))
      .orderBy(desc(salaryRegister.month), staff.fullName);

    let result = rows.map(r => ({
      ...r,
      netSalary: parseFloat(r.netSalary),
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    }));

    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim().toLowerCase();
      result = result.filter(r => r.name.toLowerCase().includes(term));
    }
    return result;
  }

  static async processSalaryPayment(ids: number[], updatedBy: string) {
    if (ids.length === 0) throw new AppError('No salary rows selected', 400);
    return await db.update(salaryRegister).set({
      status: 'PAID',
      paidAt: new Date(),
      updatedBy,
    }).where(inArray(salaryRegister.id, ids)).returning();
  }

  static async listLeaves(filters: { fromDate: string; toDate: string; search?: string }) {
    const rows = await db.select({
      id: staffLeaves.id,
      staffId: staffLeaves.staffId,
      name: staff.fullName,
      leaveFrom: staffLeaves.leaveFrom,
      leaveTo: staffLeaves.leaveTo,
      lType: staffLeaves.lType,
      remark: staffLeaves.remark,
      updatedBy: staffLeaves.updatedBy,
      updatedAt: staffLeaves.updatedAt,
    })
      .from(staffLeaves)
      .innerJoin(staff, eq(staffLeaves.staffId, staff.id))
      .where(and(
        sql`${staffLeaves.leaveFrom} <= ${filters.toDate}`,
        sql`${staffLeaves.leaveTo} >= ${filters.fromDate}`,
      ))
      .orderBy(desc(staffLeaves.updatedAt));

    let result = rows.map(r => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim().toLowerCase();
      result = result.filter(r => r.name.toLowerCase().includes(term));
    }
    return result;
  }

  static async createLeave(data: { staffId: number; leaveFrom: string; leaveTo: string; lType: string; remark?: string }, updatedBy: string) {
    const [created] = await db.insert(staffLeaves).values({
      staffId: data.staffId,
      leaveFrom: data.leaveFrom,
      leaveTo: data.leaveTo,
      lType: data.lType,
      remark: data.remark || '',
      updatedBy,
    }).returning();
    return created;
  }

  static async updateLeave(id: number, data: Partial<{ staffId: number; leaveFrom: string; leaveTo: string; lType: string; remark: string }>, updatedBy: string) {
    const [existing] = await db.select().from(staffLeaves).where(eq(staffLeaves.id, id));
    if (!existing) throw new NotFoundError('Leave record not found');

    const [updated] = await db.update(staffLeaves).set({
      ...data,
      updatedBy,
      updatedAt: new Date(),
    }).where(eq(staffLeaves.id, id)).returning();
    return updated;
  }

  static async deleteLeave(id: number) {
    const [deleted] = await db.delete(staffLeaves).where(eq(staffLeaves.id, id)).returning();
    if (!deleted) throw new NotFoundError('Leave record not found');
    return deleted;
  }
}
