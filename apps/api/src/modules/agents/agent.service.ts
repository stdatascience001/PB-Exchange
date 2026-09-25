import { db, agents, users } from '@pb/database';
import { eq, desc } from 'drizzle-orm';
import { AppError } from '../../common/errors.js';

export class AgentService {
  static async listAgents() {
    const list = await db.select({
      id: agents.id,
      userId: agents.userId,
      agentName: agents.agentName,
      mainAgentName: agents.mainAgentName,
      parentAgentName: agents.parentAgentName,
      parentAgentId: agents.parentAgentId,
      commissionRate: agents.commissionRate,
      hissaPercentage: agents.hissaPercentage,
      contactNumber: agents.contactNumber,
      updatedBy: agents.updatedBy,
      updatedAt: agents.updatedAt,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .orderBy(desc(agents.id));

    return list.map(a => ({
      ...a,
      group: a.agentName,
      agent: a.mainAgentName || 'VIKAS CASH',
      parentAgent: a.parentAgentName || '',
      updatedBy: a.updatedBy || 'A100',
      updatedAt: a.updatedAt ? a.updatedAt.toISOString() : a.createdAt.toISOString(),
      commissionRate: parseFloat(a.commissionRate),
      hissaPercentage: parseFloat(a.hissaPercentage),
      createdAt: a.createdAt.toISOString(),
    }));
  }

  static async createAgent(data: {
    userId?: number;
    agentName: string;
    mainAgentName?: string;
    parentAgentName?: string;
    parentAgentId?: number;
    commissionRate?: number;
    hissaPercentage?: number;
    contactNumber?: string;
    updatedBy?: string;
  }) {
    let finalUserId = data.userId;
    if (!finalUserId) {
      const [firstUser] = await db.select().from(users).limit(1);
      finalUserId = firstUser?.id || 1;
    }

    const [created] = await db.insert(agents).values({
      userId: finalUserId,
      agentName: data.agentName.trim().toUpperCase(),
      mainAgentName: data.mainAgentName ? data.mainAgentName.trim().toUpperCase() : 'VIKAS CASH',
      parentAgentName: data.parentAgentName ? data.parentAgentName.trim().toUpperCase() : '',
      parentAgentId: data.parentAgentId,
      commissionRate: (data.commissionRate ?? 0).toString(),
      hissaPercentage: (data.hissaPercentage ?? 0).toString(),
      contactNumber: data.contactNumber,
      updatedBy: data.updatedBy || 'A100',
      updatedAt: new Date(),
    }).returning();

    return created;
  }

  static async updateAgent(id: number, data: Partial<{
    agentName: string;
    mainAgentName: string;
    parentAgentName: string;
    commissionRate: number;
    hissaPercentage: number;
    contactNumber: string;
    updatedBy: string;
  }>) {
    const updateData: any = {
      updatedAt: new Date(),
    };
    if (data.agentName) updateData.agentName = data.agentName.trim().toUpperCase();
    if (data.mainAgentName !== undefined) updateData.mainAgentName = data.mainAgentName.trim().toUpperCase();
    if (data.parentAgentName !== undefined) updateData.parentAgentName = data.parentAgentName.trim().toUpperCase();
    if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate.toString();
    if (data.hissaPercentage !== undefined) updateData.hissaPercentage = data.hissaPercentage.toString();
    if (data.contactNumber !== undefined) updateData.contactNumber = data.contactNumber;
    if (data.updatedBy) updateData.updatedBy = data.updatedBy;

    const [updated] = await db.update(agents)
      .set(updateData)
      .where(eq(agents.id, id))
      .returning();

    if (!updated) throw new AppError('Agent not found', 404);
    return updated;
  }

  static async deleteAgent(id: number) {
    const [deleted] = await db.delete(agents)
      .where(eq(agents.id, id))
      .returning();

    if (!deleted) throw new AppError('Agent not found', 404);
    return deleted;
  }
}


