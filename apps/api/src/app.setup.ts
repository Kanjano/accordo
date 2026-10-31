import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import { ENV, type Env } from './config/env.js';
import type { Auth } from './modules/auth/auth.factory.js';
import { AUTH } from './modules/auth/auth.tokens.js';
import { ValidationException } from './modules/platform/problem-details.filter.js';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter.js';

/**
 * HTTP wiring shared by main.ts and integration tests.
 * Better Auth reads the raw body itself, so it is mounted before the JSON parser (ADR-0020).
 */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  const http = app.getHttpAdapter().getInstance() as express.Express;
  app.enableCors({ origin: [env.WEB_URL], credentials: true });
  http.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
  http.all('/api/auth/{*path}', toNodeHandler(app.get<Auth>(AUTH)));
  // Webhook signatures are computed on the raw body (SPEC §6.10).
  http.use('/api/v1/webhooks', express.raw({ type: '*/*', limit: '1mb' }));
  http.use(express.json({ limit: '1mb' }));
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) => new ValidationException(issues),
    }),
  );
  app.useWebSocketAdapter(new RedisIoAdapter(app, env));
  app.enableShutdownHooks();
}
