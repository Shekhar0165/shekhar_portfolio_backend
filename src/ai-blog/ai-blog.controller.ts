import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GenerateAiBlogDto } from './dto/generate-ai-blog.dto';
import { AiBlogService } from './ai-blog.service';

@Controller('ai-blog')
@UseGuards(JwtAuthGuard)
export class AiBlogController {
    constructor(private readonly aiBlogService: AiBlogService) { }

    @Post('generate')
    async generate(@Body() dto: GenerateAiBlogDto) {
        return this.aiBlogService.generateAndPublish(dto);
    }

    @Get('runs')
    async listRuns(
        @Query('limit') limit?: string,
        @Query('status') status?: 'running' | 'published' | 'failed',
        @Query('triggerType') triggerType?: 'manual' | 'scheduled',
        @Query('category') category?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        const parsed = Number(limit || 20);
        return this.aiBlogService.listRuns({
            limit: Number.isFinite(parsed) ? parsed : 20,
            status,
            triggerType,
            category,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
        });
    }

    @Get('runs/:id')
    async getRun(@Param('id') id: string) {
        return this.aiBlogService.getRunById(id);
    }

    @Get('editorial-state')
    async getEditorialState() {
        return this.aiBlogService.getEditorialState();
    }
}
