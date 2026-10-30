import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@accordo/db';
import { slugify } from '@accordo/domain';
import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { admin, captcha, twoFactor, username } from 'better-auth/plugins';
import type { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import type { Mailer } from '../notifications/email.provider.js';
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  type DevicesService,
  readCookie,
} from './devices.service.js';
import type { StepUpService } from './step-up.service.js';

export interface AuthDeps {
  env: Env;
  db: PrismaClient;
  redis: Redis;
  mailer: Mailer;
  devices: DevicesService;
  stepUp: StepUpService;
}

/** Better Auth endpoints that need a recent authentication (SPEC §3.1). */
const STEP_UP_PATHS = [
  '/change-email',
  '/change-password',
  '/two-factor/disable',
  '/passkey/delete-passkey',
];

const USERNAME_RE = /^[a-z0-9._]{3,30}$/;

/** Fire-and-forget email: Better Auth recommends not awaiting sends (timing attacks); Mailer logs failures. */
const background = (p: Promise<unknown>) => void p.catch(() => undefined);

function generatedUsername(name: string): string {
  const base = slugify(name, 20).replace(/-/g, '.') || 'utente';
  return `${base}.${randomBytes(2).toString('hex')}`;
}

export function createAuth({ env, db, redis, mailer, devices, stepUp }: AuthDeps) {
  const webUrl = env.WEB_URL.replace(/\/$/, '');
  const sharedCookies = env.COOKIE_DOMAIN !== 'localhost';

  return betterAuth({
    appName: 'Accordo',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [webUrl],
    database: prismaAdapter(db, { provider: 'postgresql' }),
    telemetry: { enabled: false },
    advanced: {
      // Ids come from Prisma's @default(uuid(7)) (ADR-0010).
      database: { generateId: false },
      useSecureCookies: env.NODE_ENV === 'production',
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
      ...(sharedCookies
        ? { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } }
        : {}),
    },
    session: {
      expiresIn: 30 * 24 * 3600,
      updateAge: 24 * 3600,
      freshAge: env.STEP_UP_MAX_AGE_MINUTES * 60,
    },
    user: {
      additionalFields: {
        termsAcceptedAt: { type: 'date', required: false, input: false },
        marketingConsentAt: { type: 'date', required: false, input: false },
      },
      changeEmail: { enabled: true },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        background(mailer.send(user.email, 'resetPassword', { name: user.name, url })),
      onPasswordReset: async ({ user }) =>
        background(
          mailer.send(user.email, 'passwordChanged', {
            name: user.name,
            url: `${webUrl}/password-dimenticata`,
          }),
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        background(mailer.send(user.email, 'verifyEmail', { name: user.name, url })),
    },
    socialProviders: env.GOOGLE_CLIENT_ID
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {},
    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED,
      window: 60,
      max: 100,
      // SPEC §13.2 (per IP).
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/username': { window: 60, max: 5 },
        '/sign-up/email': { window: 3600, max: 3 },
        '/request-password-reset': { window: 3600, max: 3 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
      customStorage: {
        // Atomic fixed window on Valkey: INCR, then EXPIRE on the first hit.
        consume: async (key, rule) => {
          const k = `ba-rl:${key}`;
          const count = await redis.incr(k);
          if (count === 1) await redis.expire(k, rule.window);
          if (count <= rule.max) return { allowed: true, retryAfter: null };
          const ttl = await redis.ttl(k);
          return { allowed: false, retryAfter: ttl > 0 ? ttl : rule.window };
        },
      },
    },
    plugins: [
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        usernameValidator: (u) => USERNAME_RE.test(u),
      }),
      twoFactor({ issuer: 'Accordo' }),
      passkey({ rpID: new URL(webUrl).hostname, rpName: 'Accordo', origin: webUrl }),
      // Without a secret key (local tests) the plugin protects no endpoint. An empty list would mean
      // "default endpoints" in Better Auth, hence the never-matching path.
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: env.TURNSTILE_SECRET_KEY || 'disabled',
        endpoints: env.TURNSTILE_SECRET_KEY
          ? ['/sign-up/email', '/request-password-reset']
          : ['/captcha-disabled'],
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const body = (ctx?.body ?? {}) as { acceptTerms?: unknown; marketingConsent?: unknown };
            if (ctx?.path === '/sign-up/email' && body.acceptTerms !== true) {
              throw new APIError('BAD_REQUEST', {
                code: 'TERMS_REQUIRED',
                message: 'Terms must be accepted',
              });
            }
            const now = new Date();
            const name = (user as { username?: string | null }).username;
            return {
              data: {
                ...user,
                // Social sign-ups get a generated username; they accept the terms in the sign-in screen notice.
                ...(name ? {} : { username: generatedUsername(user.name), displayUsername: null }),
                termsAcceptedAt: now,
                marketingConsentAt: body.marketingConsent === true ? now : null,
              },
            };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (STEP_UP_PATHS.includes(ctx.path)) {
          const current = await getSessionFromCtx(ctx);
          if (current) {
            const s = await stepUp.status(
              current.session,
              readCookie(ctx.headers?.get('cookie'), DEVICE_COOKIE),
            );
            if (!s.satisfied) {
              throw new APIError('UNAUTHORIZED', {
                code: 'STEP_UP_REQUIRED',
                message: 'STEP_UP_REQUIRED',
                requires: s.requires,
              });
            }
          }
        }
        // Changing the password always signs out the other devices (SPEC §13.3).
        if (ctx.path === '/change-password') {
          return { context: { body: { ...(ctx.body as object), revokeOtherSessions: true } } };
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const created = ctx.context.newSession;
        if (!created) return;
        const { user, session } = created;
        const device = await devices.recordLogin(
          user.id,
          readCookie(ctx.headers?.get('cookie'), DEVICE_COOKIE),
          {
            userAgent: session.userAgent,
            ip: session.ipAddress,
          },
        );
        if (device.cookie) {
          ctx.setCookie(DEVICE_COOKIE, device.cookie, {
            httpOnly: true,
            sameSite: 'lax',
            secure: env.NODE_ENV === 'production',
            path: '/',
            maxAge: DEVICE_COOKIE_MAX_AGE,
            ...(sharedCookies ? { domain: env.COOKIE_DOMAIN } : {}),
          });
        }
        if (device.alert) {
          const when = new Intl.DateTimeFormat('it-IT', {
            dateStyle: 'long',
            timeStyle: 'short',
            timeZone: 'Europe/Rome',
          }).format(new Date());
          background(
            mailer.send(user.email, 'newDeviceLogin', {
              name: user.name,
              when,
              device: session.userAgent?.slice(0, 120) || 'dispositivo sconosciuto',
              url: `${webUrl}/account/impostazioni/sicurezza?avviso=nuovo-accesso`,
            }),
          );
        }
        if (ctx.path === '/change-password') {
          background(
            mailer.send(user.email, 'passwordChanged', {
              name: user.name,
              url: `${webUrl}/password-dimenticata`,
            }),
          );
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
