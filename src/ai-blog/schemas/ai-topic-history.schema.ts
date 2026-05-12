import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AiTopicHistoryDocument = AiTopicHistory & Document;

@Schema({ timestamps: true })
export class AiTopicHistory {
    @Prop({ required: true })
    runId!: string;

    @Prop({ required: true })
    categorySlug!: string;

    @Prop({ required: true })
    categoryName!: string;

    @Prop({ required: true })
    topic!: string;

    @Prop({ required: true })
    title!: string;

    @Prop({ type: [String], default: [] })
    tags!: string[];

    @Prop({ type: [String], default: [] })
    keywords!: string[];

    @Prop({ default: '' })
    blogId!: string;
}

export const AiTopicHistorySchema = SchemaFactory.createForClass(AiTopicHistory);
