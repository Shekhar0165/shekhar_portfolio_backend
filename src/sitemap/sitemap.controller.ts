import { Controller, Get, Header } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { BlogService } from '../blog/blog.service';

@Controller('sitemap.xml')
export class SitemapController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly blogService: BlogService,
  ) { }

  @Get()
  @Header('Content-Type', 'application/xml')
  async getSitemap(): Promise<string> {
    const portfolioUrl = process.env.FRONTEND_URL || 'https://shekharkashyap.com';
    const blogUrl = process.env.BLOG_URL || 'https://blogs.shekharkashyap.com';

    const projects = await this.projectsService.findAll();
    const blogPosts = await this.blogService.findAll(true);

    // Portfolio static pages
    const staticUrls = ['/'].map(
      (path) => `
      <url>
        <loc>${portfolioUrl}${path}</loc>
        <lastmod>${new Date().toISOString()}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>1.0</priority>
      </url>`,
    );

    // Portfolio project anchors
    const projectUrls = projects.map((project: any) => `
      <url>
        <loc>${portfolioUrl}/#projects</loc>
        <lastmod>${new Date(project.updatedAt || project.createdAt || Date.now()).toISOString()}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
      </url>`);

    // Blog pages on subdomain
    const blogStaticUrls = ['/', '/blog', '/about', '/contact', '/privacy-policy', '/terms', '/disclaimer'].map(
      (path) => `
      <url>
        <loc>${blogUrl}${path}</loc>
        <lastmod>${new Date().toISOString()}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.9</priority>
      </url>`,
    );

    const blogPostUrls = blogPosts.map((blog: any) => `
      <url>
        <loc>${blogUrl}/blog/${blog.slug}</loc>
        <lastmod>${new Date(blog.updatedAt || blog.createdAt || Date.now()).toISOString()}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.9</priority>
      </url>`);

    return `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${staticUrls.join('')}
      ${projectUrls.join('')}
      ${blogStaticUrls.join('')}
      ${blogPostUrls.join('')}
    </urlset>`;
  }
}
