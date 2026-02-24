import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Blog, BlogDocument } from './schemas/blog.schema';
import { CreateBlogDto } from './dto/create-blog.dto';
import { UpdateBlogDto } from './dto/update-blog.dto';
import { SubscriberService } from '../subscriber/subscriber.service';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class BlogService {
    constructor(
        @InjectModel(Blog.name) private blogModel: Model<BlogDocument>,
        private readonly subscriberService: SubscriberService,
        private readonly uploadService: UploadService,
    ) { }

    async create(createBlogDto: CreateBlogDto): Promise<Blog> {
        const createdBlog = new this.blogModel(createBlogDto);
        const saved = await createdBlog.save();

        // Notify subscribers if the post is published
        if (saved.published) {
            this.subscriberService
                .notifySubscribers({
                    title: saved.title,
                    slug: saved.slug,
                    excerpt: saved.excerpt,
                    coverImage: saved.coverImage,
                })
                .catch((err) => console.error('Failed to notify subscribers:', err));
        }

        return saved;
    }

    async findAll(onlyPublished = false): Promise<Blog[]> {
        const query = onlyPublished ? { published: true } : {};
        return this.blogModel.find(query).sort({ createdAt: -1 }).exec();
    }

    async findOneBySlug(slug: string): Promise<Blog> {
        const blog = await this.blogModel.findOne({ slug }).exec();
        if (!blog) throw new NotFoundException('Blog post not found');
        return blog;
    }

    async update(id: string, updateBlogDto: UpdateBlogDto): Promise<Blog> {
        // If coverImage is changing, delete the old one from S3
        if (updateBlogDto.coverImage) {
            const existing = await this.blogModel.findById(id).exec();
            if (existing?.coverImage && existing.coverImage !== updateBlogDto.coverImage) {
                this.uploadService.deleteByUrl(existing.coverImage).catch(() => { });
            }
        }

        const updatedBlog = await this.blogModel
            .findByIdAndUpdate(id, updateBlogDto, { new: true })
            .exec();
        if (!updatedBlog) throw new NotFoundException('Blog post not found');
        return updatedBlog;
    }

    async remove(id: string): Promise<Blog> {
        const deletedBlog = await this.blogModel.findByIdAndDelete(id).exec();
        if (!deletedBlog) throw new NotFoundException('Blog post not found');
        // Delete cover image from S3
        if (deletedBlog.coverImage) {
            this.uploadService.deleteByUrl(deletedBlog.coverImage).catch(() => { });
        }
        return deletedBlog;
    }
}
