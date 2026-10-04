import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DiscrepanciesService } from './discrepancies.service';
import { CurrentUser, RolesAllowed } from '../auth/auth.guard';
import { Roles } from '../domain/constants';

class AmountDto {
  @IsInt()
  @Min(1)
  amountCents: number;

  @IsOptional()
  @IsString()
  note?: string;
}

class ClaimDto extends AmountDto {
  @IsString()
  @IsNotEmpty()
  claimant: string;
}

class FoundCashDto extends AmountDto {
  @IsString()
  @IsNotEmpty()
  note: string;
}

class NoteDto {
  @IsString()
  @IsNotEmpty()
  note: string;
}

class HandoverCountItem {
  @IsInt()
  denomCents: number;

  @IsInt()
  @Min(0)
  qty: number;
}

class HandoverDto {
  @IsString()
  @IsNotEmpty()
  cashBoxId: string;

  @IsString()
  @IsNotEmpty()
  toTellerId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HandoverCountItem)
  counts: HandoverCountItem[];

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('discrepancies')
export class DiscrepanciesController {
  constructor(private discrepancies: DiscrepanciesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.discrepancies.list(status);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.discrepancies.detail(id);
  }

  /** 长款认领（主管办理） */
  @Post(':id/claim')
  @RolesAllowed(Roles.SUPERVISOR)
  claim(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ClaimDto) {
    return this.discrepancies.claim(user, id, dto.amountCents, dto.claimant, dto.note);
  }

  /** 短款缴回（柜员办理） */
  @Post(':id/recover')
  @RolesAllowed(Roles.TELLER, Roles.SUPERVISOR)
  recover(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AmountDto) {
    return this.discrepancies.recover(user, id, dto.amountCents, dto.note);
  }

  /** 事后找到现金（可跨营业日，归属日不变） */
  @Post(':id/found-cash')
  @RolesAllowed(Roles.TELLER, Roles.SUPERVISOR)
  foundCash(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: FoundCashDto) {
    return this.discrepancies.foundCash(user, id, dto.amountCents, dto.note);
  }

  /** 短款责任说明（主管办理） */
  @Post(':id/responsibility')
  @RolesAllowed(Roles.SUPERVISOR)
  responsibility(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: NoteDto) {
    return this.discrepancies.fileResponsibility(user, id, dto.note);
  }

  /** 财务确认未处理事项（确认后方可关闭营业日） */
  @Post(':id/ack')
  @RolesAllowed(Roles.FINANCE)
  ack(@CurrentUser() user: User, @Param('id') id: string) {
    return this.discrepancies.ack(user, id);
  }
}

@Controller('handovers')
export class HandoversController {
  constructor(private discrepancies: DiscrepanciesService) {}

  /** 跨班交接（以调整记录留痕） */
  @Post()
  @RolesAllowed(Roles.TELLER)
  handover(@CurrentUser() user: User, @Body() dto: HandoverDto) {
    return this.discrepancies.handover(user, dto);
  }
}
