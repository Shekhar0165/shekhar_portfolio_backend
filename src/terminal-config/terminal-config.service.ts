import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TerminalConfig, TerminalConfigDocument } from './schemas/terminal-config.schema';

@Injectable()
export class TerminalConfigService implements OnModuleInit {
    constructor(
        @InjectModel(TerminalConfig.name) private configModel: Model<TerminalConfigDocument>,
    ) { }

    /** Seed default config if none exists */
    async onModuleInit() {
        const count = await this.configModel.countDocuments().exec();
        if (count === 0) {
            await this.configModel.create(this.defaultConfig());
            console.log('🔧 Terminal config seeded with defaults');
        }
    }

    async get(): Promise<TerminalConfig> {
        const doc = await this.configModel.findOne().exec();
        return doc || this.defaultConfig();
    }

    async update(data: Partial<TerminalConfig>): Promise<TerminalConfig> {
        let doc = await this.configModel.findOne().exec();
        if (!doc) {
            doc = await this.configModel.create(data);
        } else {
            Object.assign(doc, data);
            await doc.save();
        }
        return doc;
    }

    private defaultConfig(): TerminalConfig {
        return {
            personal: {
                name: 'Shekhar Kashyap',
                handle: 'shekharkashyap',
                role: 'Backend Engineer',
                company: 'Slay',
                since: 'June 2025',
                status: '3rd Year B.Tech CS Student',
                interests: 'AWS, System Design, Scalable APIs',
                location: 'India 🇮🇳',
                tagline: '"Building things that scale."',
                email: 'shekhar@example.com',
                linkedin: 'linkedin.com/in/shekharkashyap',
                github: 'github.com/shekharkashyap',
                twitter: '@shekharkashyap',
                pageTitle: 'ShekharKashyap.dev | Backend Engineer',
                extraFields: [],
            },
            experience: [
                {
                    period: '2025-06 → Present',
                    role: 'Backend Engineer',
                    company: 'Slay',
                    bullets: [
                        'Building and maintaining scalable REST APIs',
                        'Working with AWS services: EC2, S3, Lambda, RDS',
                        'Designing microservice architecture',
                    ],
                },
            ],
            skills: [
                {
                    category: 'Backend',
                    items: [
                        { name: 'Node.js', level: 80 },
                        { name: 'NestJS', level: 70 },
                        { name: 'PostgreSQL', level: 60 },
                    ],
                },
                {
                    category: 'Cloud & DevOps',
                    items: [
                        { name: 'AWS', level: 70 },
                        { name: 'Docker', level: 50 },
                    ],
                },
            ],
            education: {
                degree: 'B.Tech — Computer Science & Engineering',
                college: 'Your College Name',
                year: '3rd Year (2023 – 2027)',
                cgpa: 'X.X',
                courses: [
                    'Data Structures & Algorithms',
                    'Operating Systems',
                    'Database Management Systems',
                    'Computer Networks',
                ],
            },
            blogs: [],
            sudoLines: [
                '📨 Great decision!',
                '',
                'Email  : shekhar@example.com',
                'LinkedIn : linkedin.com/in/shekharkashyap',
            ],
        } as TerminalConfig;
    }
}
