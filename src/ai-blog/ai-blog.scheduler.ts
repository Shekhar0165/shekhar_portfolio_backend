import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AiBlogService } from './ai-blog.service';

@Injectable()
export class AiBlogScheduler implements OnModuleInit {
    private readonly logger = new Logger(AiBlogScheduler.name);

    constructor(
        private readonly schedulerRegistry: SchedulerRegistry,
        private readonly aiBlogService: AiBlogService,
    ) { }

    onModuleInit() {
        const enabled = (process.env.AI_AUTO_DAILY_ENABLED || 'true').toLowerCase() === 'true';
        if (!enabled) {
            this.logger.log('AI daily scheduler disabled via AI_AUTO_DAILY_ENABLED=false');
            return;
        }

        const cronExpression = process.env.AI_DAILY_CRON || '0 9 * * *';
        const timezone = process.env.AI_DAILY_TIMEZONE || 'Asia/Kolkata';

        try {
            const job = new CronJob(cronExpression, () => this.handleDailyRun(), null, false, timezone);
            this.schedulerRegistry.addCronJob('ai-daily-blog', job);
            job.start();
            this.logger.log(`AI daily scheduler started with cron ${cronExpression} (${timezone})`);
        } catch (error: any) {
            this.logger.error(`Failed to initialize AI daily scheduler: ${error?.message || error}`);
        }
    }

    private async handleDailyRun() {
        try {
            await this.aiBlogService.startScheduledRun();
        } catch (error: any) {
            this.logger.error(`Scheduled AI run failed: ${error?.message || error}`);
        }
    }
}
