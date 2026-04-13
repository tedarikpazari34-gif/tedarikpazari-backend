import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CategoryService } from './category.service';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  list() {
    return this.categories.list();
  }

  @Get('tree')
  tree(@Query('rootId') rootId?: string) {
    return this.categories.tree(rootId);
  }
}