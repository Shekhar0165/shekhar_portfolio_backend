import { Controller, Get, Post, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadService } from '../upload/upload.service';

@Controller('resume')
export class ResumeController {
    private downloadCount = 0;
    private resumeUrl: string | null = null;

    constructor(private readonly uploadService: UploadService) { }

    @Get()
    downloadResume(@Res() res: Response) {
        if (!this.resumeUrl) {
            return res.status(404).json({
                error: 'Resume not found. Upload one via the admin panel.',
            });
        }
        this.downloadCount++;
        console.log(`📄 Resume downloaded (total: ${this.downloadCount})`);
        return res.redirect(this.resumeUrl);
    }

    @Get('stats')
    getStats() {
        return {
            downloads: this.downloadCount,
            uploaded: !!this.resumeUrl,
            url: this.resumeUrl,
        };
    }

    @UseGuards(JwtAuthGuard)
    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadResume(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No file provided');
        if (file.mimetype !== 'application/pdf')
            throw new BadRequestException('Only PDF files are allowed');

        const result = await this.uploadService.uploadFile(file, 'resumes');
        this.resumeUrl = result.url;
        console.log(`📄 Resume uploaded to S3: ${result.url}`);

        return { success: true, message: 'Resume uploaded to S3', url: result.url };
    }
}
