import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { ListingsController } from './listings.controller.js';
import { ListingsService } from './listings.service.js';
import { MediaService } from './media.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [ListingsController],
  providers: [ListingsService, MediaService],
  exports: [ListingsService],
})
export class ListingsModule {}
