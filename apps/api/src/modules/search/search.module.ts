import { Module } from '@nestjs/common';
import { SavedSearchesService } from './saved-searches.service.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';
import { SeoController } from './seo.controller.js';

@Module({
  controllers: [SearchController, SeoController],
  providers: [SearchService, SavedSearchesService],
})
export class SearchModule {}
