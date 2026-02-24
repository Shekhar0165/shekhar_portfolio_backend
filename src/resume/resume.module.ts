import { Module } from '@nestjs/common';
import { ResumeController } from './resume.controller';
import { UploadModule } from '../upload/upload.module';

@Module({
    imports: [UploadModule],
    controllers: [ResumeController],
})
export class ResumeModule { }
