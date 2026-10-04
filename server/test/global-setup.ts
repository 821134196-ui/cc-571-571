// 每个测试进程启动前：重建独立的 e2e SQLite 库
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

export default async function globalSetup() {
  const dbPath = join(__dirname, '..', 'prisma', 'test-e2e.db');
  for (const suffix of ['', '-journal']) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
  execSync('npx prisma db push --schema=prisma/schema.prisma --skip-generate', {
    cwd: join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: 'file:./test-e2e.db' },
  });
}
