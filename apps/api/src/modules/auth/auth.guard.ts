import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { ENV, type Env } from '../../config/env.js';
import {
  ALLOW_UNVERIFIED,
  type AuthenticatedRequest,
  IS_PUBLIC,
  ROLES,
  STEP_UP,
} from './auth.decorators.js';
import type { Auth } from './auth.factory.js';
import { AUTH } from './auth.tokens.js';
import { DEVICE_COOKIE, readCookie } from './devices.service.js';
import { StepUpService } from './step-up.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const STAFF_ROLES = new Set(['admin', 'moderator', 'support']);

/** Global guard: session, Origin check, verified email, roles + staff 2FA, read-only impersonation, step-up. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ENV) private readonly env: Env,
    private readonly reflector: Reflector,
    private readonly stepUp: StepUpService,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const unsafe = !SAFE_METHODS.has(req.method);

    // CSRF defence in depth (SameSite=Lax cookies + Origin allowlist on state-changing requests).
    const origin = req.headers.origin;
    if (unsafe && origin && origin !== this.env.WEB_URL && origin !== this.env.API_URL) {
      throw new ForbiddenException({ code: 'ORIGIN_NOT_ALLOWED' });
    }

    req.auth = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (this.meta<boolean>(IS_PUBLIC, ctx)) return true;
    if (!req.auth) throw new UnauthorizedException();

    const { user, session } = req.auth;
    if (user.banned)
      throw new ForbiddenException({ code: 'FORBIDDEN', detail: 'Account suspended' });
    if (session.impersonatedBy && unsafe)
      throw new ForbiddenException({ code: 'IMPERSONATION_READ_ONLY' });
    if (!user.emailVerified && !this.meta<boolean>(ALLOW_UNVERIFIED, ctx)) {
      throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED' });
    }

    const roles = this.meta<string[]>(ROLES, ctx);
    if (roles) {
      const role = user.role ?? 'user';
      if (!roles.includes(role)) throw new ForbiddenException();
      if (STAFF_ROLES.has(role) && !user.twoFactorEnabled)
        throw new ForbiddenException({ code: 'TWO_FACTOR_REQUIRED' });
    }

    if (this.meta<boolean>(STEP_UP, ctx)) {
      await this.stepUp.assert(session, readCookie(req.headers.cookie, DEVICE_COOKIE));
    }
    return true;
  }
}
