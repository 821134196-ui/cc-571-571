// 必须在任何 src/ 模块加载前指定测试库（PrismaClient 在导入时读取）
process.env.DATABASE_URL = 'file:./test-e2e.db';
