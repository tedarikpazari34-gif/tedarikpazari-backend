import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { CategoryService } from './category.service';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @ApiQuery({ name: 'lang', required: false })
  @Get()
  list(@Query('lang') lang?: string) {
    return this.categories.list(lang);
  }

  @ApiQuery({ name: 'lang', required: false })
  @Get(':id/attributes')
  attributes(
    @Param('id') id: string,
    @Query('lang') lang?: string,
  ) {
    return this.categories.attributes(id, lang);
  }

  @ApiQuery({ name: 'rootId', required: false })
  @ApiQuery({ name: 'lang', required: false })
  @Get('tree')
  tree(
    @Query('rootId') rootId?: string,
    @Query('lang') lang?: string,
  ) {
    return this.categories.tree(rootId, lang);
  }
}