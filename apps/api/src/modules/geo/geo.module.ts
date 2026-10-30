import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller.js';

@Module({ controllers: [GeoController] })
export class GeoModule {}
