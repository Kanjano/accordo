import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { ComplianceController } from './compliance.controller.js';
import { ConsentsController } from './consents.controller.js';
import { DataExportService } from './data-export.service.js';
import { FieldCrypto } from './field-crypto.js';
import { TaxService } from './tax.service.js';

@Module({
  controllers: [ConsentsController, ComplianceController],
  providers: [
    {
      provide: FieldCrypto,
      inject: [ENV],
      useFactory: (env: Env) => new FieldCrypto(env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_ID),
    },
    TaxService,
    DataExportService,
  ],
})
export class ComplianceModule {}
