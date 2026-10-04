// 播种：用户、现金箱面额基线、当日营业日。幂等，可重复执行。
import { PrismaClient } from '@prisma/client';

export const DENOMINATIONS: { denomCents: number; label: string }[] = [
  { denomCents: 10000, label: '100元' },
  { denomCents: 5000, label: '50元' },
  { denomCents: 2000, label: '20元' },
  { denomCents: 1000, label: '10元' },
  { denomCents: 500, label: '5元' },
  { denomCents: 100, label: '1元' },
  { denomCents: 50, label: '5角' },
  { denomCents: 10, label: '1角' },
];

export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const BOX_BASELINE: Record<string, Record<number, number>> = {
  BOX001: { 10000: 50, 5000: 40, 2000: 100, 1000: 200, 500: 100, 100: 200, 50: 100, 10: 200 },
  BOX002: { 10000: 30, 5000: 20, 2000: 60, 1000: 100, 500: 60, 100: 100, 50: 60, 10: 100 },
};

export async function seedDatabase(prisma: PrismaClient) {
  const teller1 = await prisma.user.upsert({
    where: { username: 'teller1' },
    update: {},
    create: { username: 'teller1', name: '张敏', role: 'TELLER' },
  });
  const teller2 = await prisma.user.upsert({
    where: { username: 'teller2' },
    update: {},
    create: { username: 'teller2', name: '李强', role: 'TELLER' },
  });
  await prisma.user.upsert({
    where: { username: 'supervisor' },
    update: {},
    create: { username: 'supervisor', name: '王芳', role: 'SUPERVISOR' },
  });
  await prisma.user.upsert({
    where: { username: 'finance' },
    update: {},
    create: { username: 'finance', name: '赵磊', role: 'FINANCE' },
  });

  for (const [code, tellerId, name] of [
    ['BOX001', teller1.id, '一号现金箱'],
    ['BOX002', teller2.id, '二号现金箱'],
  ] as const) {
    const box = await prisma.cashBox.upsert({
      where: { code },
      update: {},
      create: { code, name, tellerId },
    });
    for (const { denomCents } of DENOMINATIONS) {
      await prisma.cashBoxDenom.upsert({
        where: { cashBoxId_denomCents: { cashBoxId: box.id, denomCents } },
        update: {},
        create: { cashBoxId: box.id, denomCents, qty: BOX_BASELINE[code][denomCents] ?? 0 },
      });
    }
  }

  // 保证存在一个「今天」的营业日
  const today = todayStr();
  await prisma.businessDay.upsert({
    where: { date: today },
    update: {},
    create: { date: today, status: 'OPEN' },
  });

  console.log('[seed] 完成：4 个用户 / 2 个现金箱 / 营业日 ' + today);
}

// 独立运行：npm run seed
if (require.main === module) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
