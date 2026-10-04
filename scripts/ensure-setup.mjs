// 一条命令启动前的自检：装依赖 → 生成 Prisma Client → 建库 → 播种
import { existsSync, copyFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const run = (cmd, cwd = root, env = {}) => {
  console.log(`\x1b[36m[setup]\x1b[0m ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
};

if (!existsSync(join(root, 'node_modules'))) {
  run('npm install');
}

const serverDir = join(root, 'server');
const envFile = join(serverDir, '.env');
if (!existsSync(envFile)) {
  copyFileSync(join(serverDir, '.env.example'), envFile);
  console.log('\x1b[36m[setup]\x1b[0m 已从 .env.example 生成 server/.env');
}

const dbFile = join(serverDir, 'prisma', 'dev.db');

run('npx prisma generate --schema=prisma/schema.prisma', serverDir);
if (!existsSync(dbFile)) {
  run('npx prisma db push --schema=prisma/schema.prisma --skip-generate', serverDir);
  run('npm run seed', serverDir);
} else {
  // 保证 schema 变更后本地库结构同步；播种脚本是幂等的
  run('npx prisma db push --schema=prisma/schema.prisma --skip-generate', serverDir);
  run('npm run seed', serverDir);
}

console.log('\x1b[32m[setup] 就绪：后端 http://localhost:3001/api ，前端 http://localhost:5173\x1b[0m');
