#!/usr/bin/env bash
# 一条命令本地启动：安装依赖 → 初始化 SQLite → 同时启动后端(3000)与前端(5173)
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ] || [ ! -d server/node_modules ] || [ ! -d web/node_modules ]; then
  echo "==> 安装依赖…"
  npm install --no-audit --no-fund
  npm --prefix server install --no-audit --no-fund
  npm --prefix web install --no-audit --no-fund
fi

echo "==> 初始化数据库并写入种子数据…"
npm --prefix server run prisma:setup

echo "==> 启动服务：后端 http://localhost:3000/api ，前端 http://localhost:5173"
npm run dev
