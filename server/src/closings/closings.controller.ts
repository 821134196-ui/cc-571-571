import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ClosingsService } from './closings.service';
import { CurrentUser, RolesAllowed } from '../auth/auth.guard';
import { Roles } from '../domain/constants';

class CountItem {
  @IsInt()
  denomCents: number;

  @IsInt()
  @Min(0)
  qty: number;
}

class CountsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CountItem)
  counts: CountItem[];
}

class RecountDto extends CountsDto {
  @IsOptional()
  @IsString()
  note?: string;
}

class ReviewDto {
  @IsOptional()
  @IsBoolean()
  confirmManual?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('closings')
export class ClosingsController {
  constructor(private closings: ClosingsService) {}

  /** 柜员开始/获取本人今日结柜单（幂等） */
  @Post('start')
  start(@CurrentUser() user: User) {
    return this.closings.start(user);
  }

  @Get()
  list(@Query('dayId') dayId?: string, @Query('status') status?: string) {
    return this.closings.list(dayId, status);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.closings.detail(id);
  }

  @Put(':id/counts')
  saveCounts(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CountsDto) {
    return this.closings.saveCounts(user, id, dto.counts);
  }

  /** 登记点钞机清点结果（数量来自模拟点钞机接口） */
  @Put(':id/machine-counts')
  saveMachineCounts(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CountsDto) {
    return this.closings.saveMachineCounts(user, id, dto.counts);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: User, @Param('id') id: string) {
    return this.closings.submit(user, id);
  }

  /** 重复结柜修正（以调整记录留痕，不另开新单） */
  @Post(':id/recount')
  recount(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: RecountDto) {
    return this.closings.recount(user, id, dto.counts, dto.note);
  }

  /** 主管复核（柜员不能复核本人） */
  @Post(':id/review')
  @RolesAllowed(Roles.SUPERVISOR)
  review(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.closings.review(user, id, dto);
  }
}
