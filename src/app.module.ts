import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProjectsModule } from './projects/projects.module';
import { BlogModule } from './blog/blog.module';
import { MessagesModule } from './messages/messages.module';
import { SitemapModule } from './sitemap/sitemap.module';
import { AuthModule } from './auth/auth.module';
import { ResumeModule } from './resume/resume.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { TerminalConfigModule } from './terminal-config/terminal-config.module';
import { SubscriberModule } from './subscriber/subscriber.module';
import { CategoryModule } from './category/category.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI') || 'mongodb://localhost:27017/portfolio',
      }),
      inject: [ConfigService],
    }),
    ProjectsModule,
    BlogModule,
    MessagesModule,
    SitemapModule,
    AuthModule,
    ResumeModule,
    PortfolioModule,
    TerminalConfigModule,
    SubscriberModule,
    CategoryModule,
    UploadModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

