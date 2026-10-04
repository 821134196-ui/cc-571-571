import { Prisma } from '@prisma/client';

/**
 * 并发下唯一约束冲突（如单号撞号）时整体重试事务。
 * 业务性的冲突（状态机守卫、乐观锁）抛出的是 ConflictException，不会被吞掉。
 */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const isUniqueConflict =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
      if (!isUniqueConflict || i >= attempts - 1) throw e;
    }
  }
}
