import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('categories')
export class CategoryController {
    constructor(private readonly categoryService: CategoryService) { }

    // Public — fetch all categories
    @Get()
    findAll() {
        return this.categoryService.findAll();
    }

    // Admin — create category
    @UseGuards(JwtAuthGuard)
    @Post()
    create(@Body() dto: CreateCategoryDto) {
        return this.categoryService.create(dto);
    }

    // Admin — delete category
    @UseGuards(JwtAuthGuard)
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.categoryService.remove(id);
    }
}
