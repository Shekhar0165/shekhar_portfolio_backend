import {
    Controller,
    Post,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
    constructor(private readonly uploadService: UploadService) { }

    /** Upload a blog / project image → returns S3 URL */
    @UseGuards(JwtAuthGuard)
    @Post('image')
    @UseInterceptors(FileInterceptor('file'))
    async uploadImage(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No file provided');
        if (!file.mimetype.startsWith('image/'))
            throw new BadRequestException('Only images are allowed');
        const result = await this.uploadService.uploadFile(file, 'images');
        return result;
    }

    /** Upload a resume PDF → returns S3 URL */
    @UseGuards(JwtAuthGuard)
    @Post('resume')
    @UseInterceptors(FileInterceptor('file'))
    async uploadResume(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No file provided');
        if (file.mimetype !== 'application/pdf')
            throw new BadRequestException('Only PDF files are allowed');
        const result = await this.uploadService.uploadFile(file, 'resumes');
        return result;
    }
}
