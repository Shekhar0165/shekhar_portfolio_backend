import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BlogDocument = Blog & Document;

@Schema({ timestamps: true })
export class Blog {
    @Prop({ required: true })
    title!: string;

    @Prop({ required: true, unique: true })
    slug!: string;

    @Prop({ required: true })
    content!: string; // Rich Text HTML

    @Prop({ required: true })
    excerpt!: string;

    @Prop()
    coverImage?: string;

    @Prop({ default: false })
    published!: boolean;

    @Prop({ type: [String], default: [] })
    seoKeywords!: string[];

    @Prop({ type: [String], default: [] })
    tags!: string[];

    @Prop({ default: 'Shekhar Kashyap' })
    author!: string;

    @Prop({ default: '' })
    readingTime!: string;

    @Prop({ default: '' })
    metaDescription!: string;
}

export const BlogSchema = SchemaFactory.createForClass(Blog);
