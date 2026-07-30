import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AiBlogRunDocument = AiBlogRun & Document;

export type AiBlogRunStatus = 'running' | 'published' | 'failed';

@Schema({ timestamps: true })
export class AiBlogRun {
    @Prop({ required: true, enum: ['running', 'published', 'failed'], default: 'running' })
    status!: AiBlogRunStatus;

    @Prop({ required: true, enum: ['manual', 'scheduled'], default: 'manual' })
    triggerType!: 'manual' | 'scheduled';

    @Prop({ default: 'queued' })
    currentStep!: string;

    @Prop({ default: [] })
    logs!: string[];

    @Prop({ default: '' })
    selectedCategory!: string;

    @Prop({ default: '' })
    selectedTopic!: string;

    @Prop({ default: '' })
    generatedTitle!: string;

    @Prop({ default: 0 })
    validationScore!: number;

    @Prop({ default: 0 })
    seoScore!: number;

    @Prop({ default: 0 })
    plagiarismScore!: number;

    @Prop({ default: 0 })
    factScore!: number;

    @Prop({ default: '' })
    plagiarismProvider!: string;

    @Prop({ default: false })
    usedExternalPlagiarism!: boolean;

    @Prop({ type: [String], default: [] })
    evidenceSnippets!: string[];

    @Prop({ default: 0 })
    iterationCount!: number;

    @Prop({ default: '' })
    blogId!: string;

    @Prop({ default: '' })
    trendingTopic!: string;

    @Prop({ default: '' })
    trendingScore!: string;

    @Prop({ default: 'category-rotation' })
    topicSource!: string;

    @Prop({ type: [String], default: [] })
    targetKeywords!: string[];

    @Prop({ default: '' })
    searchIntent!: string;

    @Prop({ type: [String], default: [] })
    contentGaps!: string[];

    @Prop({ default: '' })
    llmProvider!: string;

    @Prop({ default: '' })
    error!: string;

    /** True when image generation was attempted but failed (or skipped). Blog was published without a cover image. */
    @Prop({ default: false })
    imageGenerationSkipped!: boolean;

    /** The final cover image URL for this run. Empty string means no image was attached. */
    @Prop({ default: '' })
    coverImageUrl!: string;

    @Prop({ type: Date, default: null })
    startedAt!: Date | null;

    @Prop({ type: Date, default: null })
    finishedAt!: Date | null;
}

export const AiBlogRunSchema = SchemaFactory.createForClass(AiBlogRun);
