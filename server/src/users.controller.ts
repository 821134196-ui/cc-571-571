import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list() {
    return this.prisma.user.findMany({ orderBy: { username: 'asc' } });
  }
}
