import { type TaxProfileInput, taxProfileSchema } from '@accordo/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  type AuthenticatedRequest,
  CurrentAuth,
  RequireStepUp,
  Roles,
} from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { DataExportService } from './data-export.service.js';
import { TaxService } from './tax.service.js';

const year = (v: string | undefined) => {
  const y = Number(v);
  return Number.isInteger(y) && y >= 2024 && y <= 2100 ? y : new Date().getFullYear();
};

/** DAC7 tax data and GDPR data export (SPEC §14.4, §14.5). */
@Controller()
export class ComplianceController {
  constructor(
    private readonly tax: TaxService,
    private readonly dataExport: DataExportService,
  ) {}

  @Get('me/tax-profile')
  status(@CurrentAuth() auth: AuthSession) {
    return this.tax.status(auth.user.id);
  }

  @Put('me/tax-profile')
  @RequireStepUp()
  save(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: taxProfileSchema }) body: TaxProfileInput,
  ) {
    return this.tax.upsert(auth.user.id, body);
  }

  @Get('me/data-export')
  @RequireStepUp()
  async export(
    @CurrentAuth() auth: AuthSession,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.dataExport.export(auth.user.id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.setHeader('cache-control', 'no-store');
    res.setHeader(
      'content-disposition',
      `attachment; filename="accordo-dati-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return data;
  }

  // ───────────── Staff ─────────────

  @Get('admin/dac7')
  @Roles('admin', 'support')
  list(@Query('year') y?: string) {
    return this.tax.adminList(year(y));
  }

  @Post('admin/dac7/:userId/remind')
  @Roles('admin', 'support')
  @HttpCode(202)
  async remind(@CurrentAuth() auth: AuthSession, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.tax.remind(auth.user.id, userId);
  }

  @Get('admin/dac7/export')
  @Roles('admin')
  @RequireStepUp()
  async exportCsv(
    @CurrentAuth() auth: AuthSession,
    @Query('year') y: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.tax.exportCsv(auth.user.id, year(y));
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-disposition', `attachment; filename="dac7-${year(y)}.csv"`);
    return csv;
  }
}
