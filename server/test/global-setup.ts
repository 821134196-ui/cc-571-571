import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import * as path from 'path';

// 每个测试运行前重建独立的 SQLite 测试库
export default function setup() {
  const serverDir = path.join(__dirname, '..');
  const dbFile = path.join(serverDir, 'prisma', 'test.db');
  if (existsSync(dbFile)) unlinkSync(dbFile);
  execSync('npx prisma db push --skip-generate', {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: 'file:./test.db?connection_limit=1' },
    stdio: 'inherit',
  });
}
