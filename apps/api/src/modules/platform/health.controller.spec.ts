import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  let app: INestApplication;
  const readiness = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { readiness } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /health/live answers ok', () =>
    request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' }));

  it('GET /health/ready answers 503 when a dependency is down', async () => {
    readiness.mockResolvedValueOnce({ status: 'error', checks: { database: { status: 'down' } } });
    await request(app.getHttpServer()).get('/health/ready').expect(503);
  });

  it('GET /health/ready answers 200 when all dependencies are up', async () => {
    readiness.mockResolvedValueOnce({ status: 'ok', checks: { database: { status: 'up' } } });
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
});
