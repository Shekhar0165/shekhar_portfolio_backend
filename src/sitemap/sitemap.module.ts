import { Module } from '@nestjs/common';
import { SitemapController } from './sitemap.controller';
import { ProjectsModule } from '../projects/projects.module';
import { BlogModule } from '../blog/blog.module';

@Module({
  imports: [ProjectsModule, BlogModule],
  controllers: [SitemapController],
})
export class SitemapModule { }
