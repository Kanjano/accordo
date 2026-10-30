import {
  type AddressInput,
  addressInputSchema,
  addressUpdateSchema,
  notificationPreferencesUpdateSchema,
  type ProfileUpdate,
  profileUpdateSchema,
} from '@accordo/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  AllowUnverified,
  type AuthenticatedRequest,
  CurrentAuth,
  RequireStepUp,
} from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { UsersService } from './users.service.js';

@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @AllowUnverified()
  me(@CurrentAuth() auth: AuthSession) {
    return this.users.me(auth.user.id);
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: profileUpdateSchema }) body: ProfileUpdate,
  ) {
    return this.users.updateMe(auth.user.id, body);
  }

  @Delete()
  @RequireStepUp()
  @HttpCode(204)
  async deleteAccount(@CurrentAuth() auth: AuthSession, @Req() req: AuthenticatedRequest) {
    await this.users.deleteAccount(auth.user.id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('addresses')
  addresses(@CurrentAuth() auth: AuthSession) {
    return this.users.listAddresses(auth.user.id);
  }

  @Post('addresses')
  createAddress(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: addressInputSchema }) body: AddressInput,
  ) {
    return this.users.createAddress(auth.user.id, body);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: addressUpdateSchema }) body: Partial<AddressInput>,
  ) {
    return this.users.updateAddress(auth.user.id, id, body);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  async deleteAddress(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.deleteAddress(auth.user.id, id);
  }

  @Get('notification-preferences')
  @AllowUnverified()
  notificationPreferences(@CurrentAuth() auth: AuthSession) {
    return this.users.notificationPreferences(auth.user.id);
  }

  @Put('notification-preferences')
  updateNotificationPreferences(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: notificationPreferencesUpdateSchema }) body: z.infer<
      typeof notificationPreferencesUpdateSchema
    >,
  ) {
    return this.users.updateNotificationPreferences(auth.user.id, body.preferences);
  }
}
