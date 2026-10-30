import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './config/env.js';

// Local development reads the monorepo root .env; deployed environments inject variables.
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const app = await NestFactory.create(AppModule, { bufferLogs: true });
const env = app.get<Env>(ENV);
app.useLogger(app.get(Logger));
app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
app.enableCors({ origin: [env.WEB_URL], credentials: true });
app.enableShutdownHooks();
await app.listen(env.API_PORT);
