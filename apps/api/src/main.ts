import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ENV, type Env } from './config/env.js';

// Local development reads the monorepo root .env; deployed environments inject variables.
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
app.useLogger(app.get(Logger));
configureApp(app);
await app.listen(app.get<Env>(ENV).API_PORT);
