import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProjectDocument = Project & Document;

@Schema({ timestamps: true })
export class Project {
    @Prop({ required: true })
    title!: string;

    @Prop({ required: true })
    description!: string;

    @Prop()
    shortDesc?: string;

    @Prop()
    stack?: string;

    @Prop()
    imageUrl?: string;

    @Prop()
    githubUrl?: string;

    @Prop()
    liveUrl?: string;

    @Prop({ type: [String], default: [] })
    technologies!: string[];

    @Prop({ type: [String], default: [] })
    highlights!: string[];

    @Prop({ default: false })
    featured!: boolean;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

