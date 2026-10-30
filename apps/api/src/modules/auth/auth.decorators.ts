import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthSession } from './auth.factory.js';

export const IS_PUBLIC = 'auth:public';
export const ALLOW_UNVERIFIED = 'auth:allowUnverified';
export const ROLES = 'auth:roles';
export const STEP_UP = 'auth:stepUp';

/** P: no session required (the session is still read when present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Authenticated users whose email is not verified yet. */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED, true);
/** St: staff role; staff must have 2FA enabled. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);
/** (S): recent authentication required, otherwise 401 STEP_UP_REQUIRED. */
export const RequireStepUp = () => SetMetadata(STEP_UP, true);

export type AuthenticatedRequest = Request & { auth: AuthSession | null };

/** The current session ({ user, session }); null on public routes without login. */
export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth,
);
