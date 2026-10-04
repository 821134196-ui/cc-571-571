import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = [
    { username: 'teller1', name: '张敏（柜员）', role: 'TELLER' as const },
    { username: 'teller2', name: '李强（柜员）', role: 'TELLER' as const },
    { username: 'supervisor', name: '王芳（主管）', role: 'SUPERVISOR' as const },
    { username: 'finance', name: '赵磊（财务）', role: 'FINANCE' as const },
  ];
  for (const u of users) {
    await prisma.user.upsert({ where: { username: u.username }, update: {}, create: u });
  }
  const today = new Date().toISOString().slice(0, 10);
  const open = await prisma.businessDay.findFirst({ where: { status: 'OPEN' } });
  if (!open) {
    await prisma.businessDay.upsert({ where: { date: today }, update: {}, create: { date: today } });
  }
  console.log('种子数据就绪：4 个用户（teller1/teller2/supervisor/finance），营业日', today);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
