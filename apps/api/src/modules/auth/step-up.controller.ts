import { type StepUpInput, type StepUpStatus, stepUpSchema } from '@accordo/shared';
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { type AuthenticatedRequest, CurrentAuth } from './auth.decorators.js';
import type { AuthSession } from './auth.factory.js';
import { DEVICE_COOKIE, readCookie } from './devices.service.js';
import { StepUpService } from './step-up.service.js';

@Controller('auth/step-up')
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @Get()
  status(
    @CurrentAuth() auth: AuthSession,
    @Req() req: AuthenticatedRequest,
  ): Promise<StepUpStatus> {
    return this.stepUp.status(auth.session, readCookie(req.headers.cookie, DEVICE_COOKIE));
  }

  @Post()
  @HttpCode(200)
  verify(
    @CurrentAuth() auth: AuthSession,
    @Req() req: AuthenticatedRequest,
    @Body({ schema: stepUpSchema }) body: StepUpInput,
  ): Promise<StepUpStatus> {
    return this.stepUp.verify(auth.session, readCookie(req.headers.cookie, DEVICE_COOKIE), body);
  }

  @Post('email-code')
  @HttpCode(204)
  async sendCode(@CurrentAuth() auth: AuthSession): Promise<void> {
    await this.stepUp.sendEmailCode(auth.session, auth.user);
  }
}
