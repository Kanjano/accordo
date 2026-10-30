import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { ComplianceModule } from './modules/compliance/compliance.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { ListingsModule } from './modules/listings/listings.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { InfraModule } from './modules/platform/infra.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          genReqId: (req, res) => {
            const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          customProps: (req) => ({ requestId: req.id }),
          // Never log credentials or personal data.
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'res.headers["set-cookie"]',
            'req.body.password',
          ],
          autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        },
      }),
    }),
    InfraModule,
    NotificationsModule,
    AuthModule,
    PlatformModule,
    UsersModule,
    GeoModule,
    CatalogModule,
    ListingsModule,
    ComplianceModule,
  ],
})
export class AppModule {}
