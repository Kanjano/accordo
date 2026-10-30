import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
@Public()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('departments')
  departments() {
    return this.catalog.departments();
  }

  @Get('categories/:id/attributes')
  attributes(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.attributes(id);
  }

  @Get('brands')
  brands(@Query('q') q = '') {
    return this.catalog.brands(q);
  }

  @Get('suggest-category')
  suggest(@Query('title') title = '') {
    return this.catalog.suggestCategory(title.slice(0, 120));
  }
}
