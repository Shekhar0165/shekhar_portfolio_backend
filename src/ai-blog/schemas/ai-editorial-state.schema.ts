import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AiEditorialStateDocument = AiEditorialState & Document;

@Schema({ timestamps: true })
export class AiEditorialState {
    @Prop({ required: true, unique: true, default: 'global' })
    key!: string;

    @Prop({ default: 1 })
    cycleNumber!: number;

    @Prop({ type: [String], default: [] })
    coveredCategorySlugs!: string[];

    @Prop({ default: '' })
    lastCategorySlug!: string;

    @Prop({ type: Date, default: null })
    lastRunAt!: Date | null;
}

export const AiEditorialStateSchema = SchemaFactory.createForClass(AiEditorialState);
