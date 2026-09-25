import { db, duplicateReviews, transactions } from '@pb/database';
import { eq, desc } from 'drizzle-orm';
import { NotFoundError } from '../../common/errors.js';
import { UserSession } from '@pb/types';

export class DuplicateService {
  static async listReviews() {
    return await db.select()
      .from(duplicateReviews)
      .orderBy(desc(duplicateReviews.createdAt));
  }

  static async resolveReview(id: number, status: 'CONFIRMED' | 'DISMISSED', user: UserSession) {
    const [review] = await db.select().from(duplicateReviews).where(eq(duplicateReviews.id, id));
    if (!review) throw new NotFoundError('Review item not found');

    const [updated] = await db.update(duplicateReviews)
      .set({
        status,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
      })
      .where(eq(duplicateReviews.id, id))
      .returning();

    if (status === 'CONFIRMED') {
      await db.update(transactions)
        .set({ status: 'VOIDED' })
        .where(eq(transactions.id, review.duplicateTransactionId));
    } else {
      await db.update(transactions)
        .set({ status: 'ACTIVE' })
        .where(eq(transactions.id, review.duplicateTransactionId));
    }

    return updated;
  }
}
