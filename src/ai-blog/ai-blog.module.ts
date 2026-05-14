import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlogModule } from '../blog/blog.module.js';
import { CategoryModule } from '../category/category.module.js';
import { UploadModule } from '../upload/upload.module.js';
import { AiBlogController } from './ai-blog.controller.js';
import { AiBlogScheduler } from './ai-blog.scheduler.js';
import { AiBlogService } from './ai-blog.service.js';
import { GroqLlmService } from './services/groq-llm.service.js';
import { TrendScoutService } from './services/trend-scout.service.js';
import { KeywordResearchService } from './services/keyword-research.service.js';
import { WebResearchService } from './services/web-research.service.js';
import { AiBlogRun, AiBlogRunSchema } from './schemas/ai-blog-run.schema.js';
import { AiEditorialState, AiEditorialStateSchema } from './schemas/ai-editorial-state.schema.js';
import { AiTopicHistory, AiTopicHistorySchema } from './schemas/ai-topic-history.schema.js';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: AiBlogRun.name, schema: AiBlogRunSchema },
            { name: AiEditorialState.name, schema: AiEditorialStateSchema },
            { name: AiTopicHistory.name, schema: AiTopicHistorySchema },
        ]),
        BlogModule,
        CategoryModule,
        UploadModule,
    ],
    controllers: [AiBlogController],
    providers: [
        AiBlogService,
        AiBlogScheduler,
        GroqLlmService,
        TrendScoutService,
        KeywordResearchService,
        WebResearchService,
    ],
    exports: [AiBlogService],
})
export class AiBlogModule { }
