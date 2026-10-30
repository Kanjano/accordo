import {
  type SavedSearchCreate,
  savedSearchCreateSchema,
  savedSearchUpdateSchema,
  searchParamsSchema,
} from '@accordo/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { z } from 'zod';
import { type AuthenticatedRequest, CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthSession } from '../auth/auth.factory.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { SavedSearchesService } from './saved-searches.service.js';
import { SearchService } from './search.service.js';

@Controller()
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly saved: SavedSearchesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('search/listings')
  @Public()
  async listings(
    @Query() raw: Record<string, unknown>,
    @CurrentAuth() auth: AuthSession | null,
    @Req() req: AuthenticatedRequest,
  ) {
    // SPEC §13.2: anonymous search 60/min per IP.
    if (!auth) await this.rateLimit.consume(`search:${req.ip}`, 60, 60);
    const parsed = searchParamsSchema.safeParse(raw);
    if (!parsed.success)
      throw new BadRequestException({ code: 'INVALID_SEARCH', detail: parsed.error.message });
    return this.search.listings(parsed.data);
  }

  @Get('search/suggest')
  @Public()
  async suggest(
    @Query('q') q: unknown,
    @CurrentAuth() auth: AuthSession | null,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!auth) await this.rateLimit.consume(`suggest:${req.ip}`, 120, 60);
    return this.search.suggest(typeof q === 'string' ? q.slice(0, 60) : '');
  }

  @Get('me/saved-searches')
  list(@CurrentAuth() auth: AuthSession) {
    return this.saved.list(auth.user.id);
  }

  @Post('me/saved-searches')
  create(
    @CurrentAuth() auth: AuthSession,
    @Body({ schema: savedSearchCreateSchema }) body: SavedSearchCreate,
  ) {
    return this.saved.create(auth.user.id, body);
  }

  @Patch('me/saved-searches/:id')
  update(
    @CurrentAuth() auth: AuthSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: savedSearchUpdateSchema }) body: z.infer<typeof savedSearchUpdateSchema>,
  ) {
    return this.saved.update(auth.user.id, id, body);
  }

  @Delete('me/saved-searches/:id')
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AuthSession, @Param('id', ParseUUIDPipe) id: string) {
    await this.saved.remove(auth.user.id, id);
  }
}
