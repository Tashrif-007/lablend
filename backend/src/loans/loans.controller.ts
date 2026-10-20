import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MAX_DAYS, MAX_ITEMS } from '../domain/loan-rules';
import { LoansService } from './loans.service';

@Controller()
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  // The limits, from the domain module, so the UI never keeps its own copy.
  @Get('rules')
  rules() {
    return { maxItems: MAX_ITEMS, maxDays: MAX_DAYS };
  }

  @Get('equipment')
  equipment(@Query('query') query?: string) {
    return this.loans.listEquipment(query);
  }

  @Get('loans')
  list(@Query('studentId') studentId?: string) {
    return this.loans.listLoans(studentId);
  }

  // Rule refusals are 422 with { ok: false, code, reason, violations }.
  @Post('loans/check')
  @HttpCode(200)
  async check(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.loans.checkStock(body);
    if (!result.ok) res.status(422);
    return result;
  }

  @Post('loans')
  async create(@Body() body: Record<string, unknown> | undefined, @Res({ passthrough: true }) res: Response) {
    const { approved, ...request } = body ?? {};
    const result = await this.loans.createLoan(request, approved);
    if (!result.ok) res.status(422);
    return result;
  }
}
