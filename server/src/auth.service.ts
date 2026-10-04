import { Injectable, UnauthorizedException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * 演示用简化鉴权：请求头 x-user-id 指定当前操作人。
 * 生产环境应替换为真实的统一认证。
 */
@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async userFromHeader(header: string | undefined): Promise<User> {
    if (!header) throw new UnauthorizedException('缺少 x-user-id 请求头');
    const user = await this.prisma.user.findUnique({ where: { id: header } });
    if (!user) throw new UnauthorizedException('用户不存在');
    return user;
  }
}
