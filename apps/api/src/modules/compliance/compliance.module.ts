import { Module } from '@nestjs/common';
import { ConsentsController } from './consents.controller.js';

@Module({ controllers: [ConsentsController] })
export class ComplianceModule {}
