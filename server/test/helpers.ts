import './test-env';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { seedDatabase } from '../prisma/seed';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  agent: (username: string) => ReturnType<typeof makeAgent>;
  users: Record<string, { id: string; username: string; role: string; name: string }>;
}

function makeAgent(app: INestApplication, userId: string) {
  const server = app.getHttpServer();
  return {
    get: (url: string) => request(server).get(url).set('x-user-id', userId),
    post: (url: string) => request(server).post(url).set('x-user-id', userId),
    put: (url: string) => request(server).put(url).set('x-user-id', userId),
  };
}

/** 清空全部业务表并重新播种，保证每个 spec 文件相互隔离 */
export async function resetDatabase(prisma: PrismaService) {
  await prisma.ledgerEntry.deleteMany();
  await prisma.financeReceipt.deleteMany();
  await prisma.adjustment.deleteMany();
  await prisma.discrepancy.deleteMany();
  await prisma.denomCount.deleteMany();
  await prisma.closingSession.deleteMany();
  await prisma.businessDay.deleteMany();
  await prisma.cashBoxDenom.deleteMany();
  await prisma.cashBox.deleteMany();
  await prisma.user.deleteMany();
  await seedDatabase(prisma);
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const prisma = app.get(PrismaService);
  await resetDatabase(prisma);

  const users = await prisma.user.findMany();
  const byUsername: TestContext['users'] = Object.fromEntries(users.map((u) => [u.username, u]));

  return {
    app,
    prisma,
    users: byUsername,
    agent: (username: string) => makeAgent(app, byUsername[username].id),
  };
}

/** 面额数量 → 金额（分） */
export function totalCents(counts: { denomCents: number; qty: number }[]): number {
  return counts.reduce((a, c) => a + c.denomCents * c.qty, 0);
}

/** 把某一面额的数量改写成指定值，其余照搬 */
export function withQty(
  counts: { denomCents: number; expectedQty: number }[],
  denomCents: number,
  qty: number,
) {
  return counts.map((c) => ({
    denomCents: c.denomCents,
    qty: c.denomCents === denomCents ? qty : c.expectedQty,
  }));
}
