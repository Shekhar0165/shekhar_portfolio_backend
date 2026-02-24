import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema';
import { CreateMessageDto, UpdateMessageDto } from './dto/create-message.dto';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MessagesService {
    private transporter: nodemailer.Transporter | null = null;

    constructor(
        @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
        private configService: ConfigService,
    ) {
        // Setup email transporter if credentials are configured
        const gmailUser = this.configService.get<string>('GMAIL_USER');
        const gmailPass = this.configService.get<string>('GMAIL_APP_PASSWORD');

        if (gmailUser && gmailPass) {
            this.transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: gmailUser,
                    pass: gmailPass,
                },
            });
            console.log('📧 Email notifications enabled');
        } else {
            console.warn('📧 Email notifications disabled — set GMAIL_USER and GMAIL_APP_PASSWORD in .env');
        }
    }

    async create(createMessageDto: CreateMessageDto): Promise<Message> {
        const createdMessage = new this.messageModel(createMessageDto);
        const saved = await createdMessage.save();

        // Send email notification (fire and forget)
        this.sendNotificationEmail(createMessageDto).catch((err) =>
            console.error('Failed to send email notification:', err.message),
        );

        return saved;
    }

    async findAll(): Promise<Message[]> {
        return this.messageModel.find().sort({ createdAt: -1 }).exec();
    }

    async update(id: string, updateMessageDto: UpdateMessageDto): Promise<Message> {
        const updatedMessage = await this.messageModel
            .findByIdAndUpdate(id, updateMessageDto, { new: true })
            .exec();
        if (!updatedMessage) throw new NotFoundException('Message not found');
        return updatedMessage;
    }

    async remove(id: string): Promise<Message> {
        const deletedMessage = await this.messageModel.findByIdAndDelete(id).exec();
        if (!deletedMessage) throw new NotFoundException('Message not found');
        return deletedMessage;
    }

    private async sendNotificationEmail(dto: CreateMessageDto): Promise<void> {
        if (!this.transporter) return;

        const gmailUser = this.configService.get<string>('GMAIL_USER');

        await this.transporter.sendMail({
            from: `"ShekharKashyap.dev" <${gmailUser}>`,
            to: gmailUser,
            subject: `📬 New Portfolio Message: ${dto.subject}`,
            html: `
                <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a1a; border-radius: 12px; overflow: hidden; border: 1px solid #333;">
                    <div style="background: linear-gradient(135deg, #FFB300, #FF8800); padding: 20px 24px;">
                        <h1 style="margin: 0; color: #1a1a1a; font-size: 18px;">📬 New Message from ShekharKashyap.dev</h1>
                    </div>
                    <div style="padding: 24px; color: #e0e0e0;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #888; width: 80px;">From:</td>
                                <td style="padding: 8px 0; color: #FFB300; font-weight: bold;">${dto.name}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #888;">Email:</td>
                                <td style="padding: 8px 0;"><a href="mailto:${dto.email}" style="color: #06b6d4;">${dto.email}</a></td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #888;">Subject:</td>
                                <td style="padding: 8px 0; color: #e0e0e0;">${dto.subject}</td>
                            </tr>
                        </table>
                        <hr style="border: none; border-top: 1px solid #333; margin: 16px 0;" />
                        <div style="background: #111; padding: 16px; border-radius: 8px; color: #e0e0e0; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">
${dto.message}
                        </div>
                        <p style="margin-top: 20px; font-size: 12px; color: #666;">
                            Sent from <strong style="color: #FFB300;">ShekharKashyap.dev</strong> portfolio terminal
                        </p>
                    </div>
                </div>
            `,
        });

        console.log(`📧 Email notification sent for message from ${dto.name}`);
    }
}
