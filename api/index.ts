import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { INestApplication } from '@nestjs/common';

let app: INestApplication;

async function bootstrap(): Promise<INestApplication> {
    if (!app) {
        app = await NestFactory.create(AppModule);
        app.enableCors();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
    }
    return app;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const app = await bootstrap();
    const instance = app.getHttpAdapter().getInstance();
    return instance(req, res);
}
