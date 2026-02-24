import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuid } from 'uuid';

@Injectable()
export class UploadService {
    private readonly logger = new Logger(UploadService.name);
    private readonly s3: S3Client;
    private readonly bucket: string;
    private readonly region: string;

    constructor() {
        this.region = process.env.AWS_REGION || 'ap-south-1';
        this.bucket = process.env.AWS_S3_BUCKET || 'my-portfolio-bucket';

        this.s3 = new S3Client({
            region: this.region,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
        });
    }

    /**
     * Upload a file to S3 and return its public URL.
     */
    async uploadFile(
        file: Express.Multer.File,
        folder: string,
    ): Promise<{ url: string; key: string }> {
        const ext = file.originalname.split('.').pop() || 'bin';
        const key = `${folder}/${uuid()}.${ext}`;

        await this.s3.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
            }),
        );

        const url = `https://s3.${this.region}.amazonaws.com/${this.bucket}/${key}`;
        this.logger.log(`Uploaded: ${key} (${(file.size / 1024).toFixed(1)} KB)`);
        return { url, key };
    }

    /**
     * Delete an old file from S3 given its full URL.
     * Silently ignores errors (file may already be deleted).
     */
    async deleteByUrl(url: string): Promise<void> {
        if (!url || !url.includes(this.bucket)) return;
        try {
            const key = url.split(`${this.bucket}/`)[1];
            if (!key) return;

            await this.s3.send(
                new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                }),
            );
            this.logger.log(`Deleted old S3 object: ${key}`);
        } catch (err) {
            this.logger.warn(`Failed to delete S3 object: ${url}`);
        }
    }
}
