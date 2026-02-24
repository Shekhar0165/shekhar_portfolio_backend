import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as nodemailer from 'nodemailer';
import { Subscriber, SubscriberDocument } from './schemas/subscriber.schema';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';

@Injectable()
export class SubscriberService {
    private readonly logger = new Logger(SubscriberService.name);
    private transporter: nodemailer.Transporter;

    constructor(
        @InjectModel(Subscriber.name) private subscriberModel: Model<SubscriberDocument>,
    ) {
        // Configure email transporter (Gmail example — use env vars)
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;

        if (smtpUser && smtpPass) {
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: smtpUser, pass: smtpPass },
            });
            this.logger.log('Email transporter configured');
        } else {
            this.logger.warn('SMTP_USER / SMTP_PASS not set — email notifications disabled');
        }
    }

    async subscribe(dto: CreateSubscriberDto): Promise<Subscriber> {
        const existing = await this.subscriberModel.findOne({ email: dto.email }).exec();
        if (existing) {
            if (!existing.active) {
                existing.active = true;
                return existing.save();
            }
            throw new ConflictException('Email already subscribed');
        }
        return new this.subscriberModel(dto).save();
    }

    async unsubscribe(email: string): Promise<{ message: string }> {
        const sub = await this.subscriberModel.findOne({ email }).exec();
        if (!sub) throw new NotFoundException('Subscriber not found');
        sub.active = false;
        await sub.save();
        return { message: 'Successfully unsubscribed' };
    }

    async findAll(): Promise<Subscriber[]> {
        return this.subscriberModel.find().sort({ createdAt: -1 }).exec();
    }

    async getActiveCount(): Promise<number> {
        return this.subscriberModel.countDocuments({ active: true }).exec();
    }

    async notifySubscribers(post: { title: string; slug: string; excerpt: string; coverImage?: string }): Promise<void> {
        if (!this.transporter) {
            this.logger.warn('No mail transporter — skipping notifications');
            return;
        }

        const subscribers = await this.subscriberModel.find({ active: true }).exec();
        if (subscribers.length === 0) return;

        const blogUrl = process.env.BLOG_URL || 'https://shekharkashyap.com';
        const postUrl = `${blogUrl}/blog/${post.slug}`;
        const unsubUrl = `${blogUrl}/unsubscribe`;

        const html = `
        <div style="font-family:'Inter',system-ui,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
            ${post.coverImage ? `<img src="${post.coverImage}" alt="${post.title}" style="width:100%;height:250px;object-fit:cover" />` : ''}
            <div style="padding:32px">
                <p style="color:#6366f1;font-size:13px;font-weight:600;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px">New Post Published</p>
                <h1 style="font-size:24px;color:#0f172a;margin:0 0 16px;line-height:1.3">${post.title}</h1>
                <p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 24px">${post.excerpt}</p>
                <a href="${postUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Read Article →</a>
            </div>
            <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0">
                <p style="color:#94a3b8;font-size:12px;margin:0">You received this because you subscribed to ShekharKashyap.com. <a href="${unsubUrl}" style="color:#6366f1">Unsubscribe</a></p>
            </div>
        </div>`;

        const fromName = process.env.SMTP_FROM_NAME || 'Shekhar Kashyap';
        const fromEmail = process.env.SMTP_USER;

        // Send in batches to avoid rate limits
        const batchSize = 10;
        for (let i = 0; i < subscribers.length; i += batchSize) {
            const batch = subscribers.slice(i, i + batchSize);
            const promises = batch.map((sub) =>
                this.transporter
                    .sendMail({
                        from: `"${fromName}" <${fromEmail}>`,
                        to: sub.email,
                        subject: `📝 New Post: ${post.title}`,
                        html,
                    })
                    .catch((err) => this.logger.error(`Failed to email ${sub.email}: ${err.message}`)),
            );
            await Promise.all(promises);
        }

        this.logger.log(`Notified ${subscribers.length} subscriber(s) about: ${post.title}`);
    }
}
