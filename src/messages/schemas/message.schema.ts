import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
    @Prop({ required: true })
    name!: string;

    @Prop({ required: true })
    email!: string;

    @Prop({ required: true })
    subject!: string;

    @Prop({ required: true })
    message!: string;

    @Prop({ default: false })
    read!: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
