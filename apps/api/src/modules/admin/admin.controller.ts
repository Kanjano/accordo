import {
  attributeSchema,
  brandSchema,
  categoryAttributesSchema,
  categorySchema,
  departmentSchema,
  settingUpdateSchema,
} from '@accordo/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import { CurrentAuth, RequireStepUp, Roles } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { AdminService } from './admin.service.js';

const STAFF = ['admin', 'moderator', 'support'];
type In<S extends z.ZodType> = z.infer<S>;

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  @Roles(...STAFF)
  dashboard() {
    return this.admin.dashboard();
  }

  // ───────────── Settings (admin only, step-up, SPEC §13.6) ─────────────

  @Get('settings')
  @Roles('admin')
  settings() {
    return this.admin.listSettings();
  }

  @Put('settings/:key')
  @Roles('admin')
  @RequireStepUp()
  updateSetting(
    @CurrentAuth() auth: AuthSession,
    @Param('key') key: string,
    @Body({ schema: settingUpdateSchema }) body: In<typeof settingUpdateSchema>,
  ) {
    return this.admin.updateSetting(auth.user.id, key, body.value);
  }

  // ───────────── Catalog ─────────────

  @Get('catalog')
  @Roles(...STAFF)
  catalog() {
    return this.admin.catalog();
  }

  @Get('catalog/brands')
  @Roles(...STAFF)
  brands(@Query('q') q?: string) {
    return this.admin.brands(q);
  }

  @Post('catalog/departments')
  @Roles('admin')
  createDepartment(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: departmentSchema }) body: In<typeof departmentSchema>,
  ) {
    return this.admin.saveDepartment(auth.user.id, null, body);
  }

  @Patch('catalog/departments/:id')
  @Roles('admin')
  updateDepartment(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: departmentSchema }) body: In<typeof departmentSchema>,
  ) {
    return this.admin.saveDepartment(auth.user.id, id, body);
  }

  @Post('catalog/categories')
  @Roles('admin')
  createCategory(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: categorySchema }) body: In<typeof categorySchema>,
  ) {
    return this.admin.saveCategory(auth.user.id, null, body);
  }

  @Patch('catalog/categories/:id')
  @Roles('admin')
  updateCategory(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: categorySchema }) body: In<typeof categorySchema>,
  ) {
    return this.admin.saveCategory(auth.user.id, id, body);
  }

  @Put('catalog/categories/:id/attributes')
  @Roles('admin')
  @HttpCode(204)
  async categoryAttributes(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: categoryAttributesSchema }) body: In<typeof categoryAttributesSchema>,
  ) {
    await this.admin.setCategoryAttributes(auth.user.id, id, body.attributes);
  }

  @Post('catalog/attributes')
  @Roles('admin')
  createAttribute(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: attributeSchema }) body: In<typeof attributeSchema>,
  ) {
    return this.admin.saveAttribute(auth.user.id, null, body);
  }

  @Patch('catalog/attributes/:id')
  @Roles('admin')
  updateAttribute(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: attributeSchema }) body: In<typeof attributeSchema>,
  ) {
    return this.admin.saveAttribute(auth.user.id, id, body);
  }

  @Post('catalog/brands')
  @Roles('admin', 'moderator')
  createBrand(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: brandSchema }) body: In<typeof brandSchema>,
  ) {
    return this.admin.saveBrand(auth.user.id, null, body);
  }

  @Patch('catalog/brands/:id')
  @Roles('admin', 'moderator')
  updateBrand(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: brandSchema }) body: In<typeof brandSchema>,
  ) {
    return this.admin.saveBrand(auth.user.id, id, body);
  }

  // ───────────── Audit and webhooks ─────────────

  @Get('audit')
  @Roles('admin')
  audit(@Query() q: { actorId?: string; entityType?: string; entityId?: string; before?: string }) {
    return this.admin.audit(q);
  }

  @Get('webhooks')
  @Roles('admin', 'support')
  webhooks(@Query('status') status?: string) {
    return this.admin.webhooks(status === 'processed' || status === 'pending' ? status : 'failed');
  }

  @Post('webhooks/:provider/:eventId/replay')
  @Roles('admin', 'support')
  @HttpCode(202)
  async replay(
    @CurrentAuth() auth: AuthSession,
    @Param('provider') provider: string,
    @Param('eventId') eventId: string,
  ) {
    await this.admin.replay(auth.user.id, provider, eventId);
  }
}
