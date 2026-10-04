import { Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { PrismaService } from '../prisma.service';
import { Public } from './auth.guard';

class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;
}

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user) throw new UnauthorizedException('用户不存在');
    return user;
  }
}

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  async list() {
    return this.prisma.user.findMany({
      select: { id: true, username: true, name: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
