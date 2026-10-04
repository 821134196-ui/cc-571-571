import { Body, Controller, Post } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * 本地模拟的外部接口：
 * - 点钞机：按种子返回各面额张数（结果确定、可重现）；
 *   与手工盘点是否一致完全由柜员实盘决定，系统不自动采信任一方。
 */
@Controller('mock')
export class MockController {
  @Post('cash-machine/count')
  cashMachineCount(@Body() body: { seed?: string; denoms: number[] }) {
    const seed = body.seed ?? 'CASH-MACHINE';
    const counts = (body.denoms ?? []).map((denomCents) => {
      const h = createHash('md5').update(`${seed}:${denomCents}`).digest();
      return { denomCents, qty: h.readUInt32BE(0) % 21 }; // 0~20 张，确定性伪随机
    });
    return { counts };
  }
}
