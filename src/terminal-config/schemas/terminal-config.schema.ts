import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/* ── Sub-document types ── */

export class ExtraField {
    @Prop({ default: '' }) label!: string;
    @Prop({ default: '' }) value!: string;
    @Prop({ default: '' }) link!: string;  // optional — if set, value becomes clickable
}

export class PersonalInfo {
    @Prop({ default: '' }) name!: string;
    @Prop({ default: '' }) handle!: string;
    @Prop({ default: '' }) role!: string;
    @Prop({ default: '' }) company!: string;
    @Prop({ default: '' }) since!: string;
    @Prop({ default: '' }) status!: string;
    @Prop({ default: '' }) interests!: string;
    @Prop({ default: '' }) location!: string;
    @Prop({ default: '' }) tagline!: string;
    @Prop({ default: '' }) email!: string;
    @Prop({ default: '' }) linkedin!: string;
    @Prop({ default: '' }) github!: string;
    @Prop({ default: '' }) twitter!: string;
    @Prop({ default: '' }) pageTitle!: string;
    @Prop({ type: [ExtraField], default: [] }) extraFields!: ExtraField[];
}

export class ExperienceEntry {
    @Prop({ default: '' }) period!: string;
    @Prop({ default: '' }) role!: string;
    @Prop({ default: '' }) company!: string;
    @Prop({ type: [String], default: [] }) bullets!: string[];
}

export class SkillItem {
    @Prop({ default: '' }) name!: string;
    @Prop({ default: 0 }) level!: number;
}

export class SkillCategory {
    @Prop({ default: '' }) category!: string;
    @Prop({ type: [SkillItem], default: [] }) items!: SkillItem[];
}

export class EducationInfo {
    @Prop({ default: '' }) degree!: string;
    @Prop({ default: '' }) college!: string;
    @Prop({ default: '' }) year!: string;
    @Prop({ default: '' }) cgpa!: string;
    @Prop({ type: [String], default: [] }) courses!: string[];
}

export class BlogEntry {
    @Prop({ default: '' }) title!: string;
    @Prop({ default: '' }) url!: string;
}

/* ── Main Schema ── */

export type TerminalConfigDocument = TerminalConfig & Document;

@Schema({ timestamps: true })
export class TerminalConfig {
    @Prop({ type: PersonalInfo, default: () => ({}) })
    personal!: PersonalInfo;

    @Prop({ type: [ExperienceEntry], default: [] })
    experience!: ExperienceEntry[];

    @Prop({ type: [SkillCategory], default: [] })
    skills!: SkillCategory[];

    @Prop({ type: EducationInfo, default: () => ({}) })
    education!: EducationInfo;

    @Prop({ type: [BlogEntry], default: [] })
    blogs!: BlogEntry[];

    @Prop({ type: [String], default: [] })
    sudoLines!: string[];
}

export const TerminalConfigSchema = SchemaFactory.createForClass(TerminalConfig);
