import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { infraProviders } from './infra.providers.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';
import { StorageBootstrapService } from './storage-bootstrap.service.js';

@Module({
  controllers: [HealthController],
  providers: [
    ...infraProviders,
    HealthService,
    StorageBootstrapService,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class PlatformModule {}
