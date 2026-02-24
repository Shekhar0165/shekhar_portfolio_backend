import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { BlogService } from './blog.service';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('blog')
export class BlogController {
    constructor(private readonly blogService: BlogService) { }

    @UseGuards(JwtAuthGuard)
    @Post()
    create(@Body() createBlogDto: CreateBlogDto) {
        return this.blogService.create(createBlogDto);
    }

    @Get()
    findAll(@Query('published') published?: string) {
        // If queried by public site, they will pass ?published=true
        const onlyPublished = published === 'true';
        return this.blogService.findAll(onlyPublished);
    }

    @Get(':slug')
    findOne(@Param('slug') slug: string) {
        return this.blogService.findOneBySlug(slug);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(':id')
    update(@Param('id') id: string, @Body() updateBlogDto: UpdateBlogDto) {
        return this.blogService.update(id, updateBlogDto);
    }

    @UseGuards(JwtAuthGuard)
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.blogService.remove(id);
    }
}
