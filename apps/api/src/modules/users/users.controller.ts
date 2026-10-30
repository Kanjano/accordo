import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':username')
  @Public()
  profile(@Param('username') username: string, @CurrentAuth() auth: AuthSession | null) {
    return this.users.publicProfile(username, auth?.user.id ?? null);
  }

  @Get(':username/listings')
  @Public()
  listings(
    @Param('username') username: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '24',
  ) {
    return this.users.publicListings(username, cursor, Number.parseInt(limit, 10) || 24);
  }

  @Put(':id/follow')
  @HttpCode(204)
  async follow(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.follow(auth.user.id, id, true);
  }

  @Delete(':id/follow')
  @HttpCode(204)
  async unfollow(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.follow(auth.user.id, id, false);
  }

  @Put(':id/block')
  @HttpCode(204)
  async block(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.block(auth.user.id, id, true);
  }

  @Delete(':id/block')
  @HttpCode(204)
  async unblock(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.block(auth.user.id, id, false);
  }
}
