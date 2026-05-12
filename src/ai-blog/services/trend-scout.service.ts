import { Injectable, Logger } from '@nestjs/common';
import { GroqLlmService } from './groq-llm.service.js';

interface TrendItem {
    query: string;
    formattedTraffic?: string;
    relatedQueries?: string[];
}

export interface TrendScoutResult {
    trendingTopic: string;
    trendingScore: string;
    relatedQueries: string[];
    source: 'google-trends' | 'category-rotation';
}

@Injectable()
export class TrendScoutService {
    private readonly logger = new Logger(TrendScoutService.name);

    constructor(private readonly groqLlm: GroqLlmService) {}

    async discoverTrendingTopics(): Promise<TrendItem[]> {
        const geo = process.env.TRENDS_GEO || 'IN';
        const hl = process.env.TRENDS_LANGUAGE || 'en';

        try {
            const { dailyTrends } = await import('trendsearch');

            const result = await dailyTrends({ geo, hl });
            const trends: TrendItem[] = (result.data?.trends || []).map((t: any) => ({
                query: t.title?.query || '',
                formattedTraffic: t.formattedTraffic || '',
                relatedQueries: t.relatedQueries || [],
            }));

            this.logger.log(`Fetched ${trends.length} daily trends for geo=${geo}`);
            return trends;
        } catch (error: any) {
            this.logger.warn(`Failed to fetch daily trends: ${error?.message || error}`);
            return this.fallbackTrendingNow();
        }
    }

    private async fallbackTrendingNow(): Promise<TrendItem[]> {
        const geo = process.env.TRENDS_GEO || 'IN';
        const language = process.env.TRENDS_LANGUAGE || 'en';

        try {
            const { trendingNow } = await import('trendsearch');

            const result = await trendingNow({ geo, language, hours: 24 });
            const items: TrendItem[] = (result.data?.items || []).slice(0, 20).map((item: any) => ({
                query: item.title || item.query || '',
                formattedTraffic: '',
                relatedQueries: [],
            }));

            this.logger.log(`Fallback: fetched ${items.length} trending-now items`);
            return items;
        } catch (error: any) {
            this.logger.warn(`Trending-now fallback also failed: ${error?.message || error}`);
            return [];
        }
    }

    async pickBestTechTopic(
        trends: TrendItem[],
        existingTitles: string[],
        categories: string[],
    ): Promise<TrendScoutResult | null> {
        if (trends.length === 0) return null;

        const trendList = trends
            .slice(0, 25)
            .map((t, i) => `${i + 1}. "${t.query}" (traffic: ${t.formattedTraffic || 'unknown'})`)
            .join('\n');

        const prompt = [
            'You are a tech blog topic selector. From the Google Trends list below, pick the BEST topic that is relevant to software engineering, web development, DevOps, cloud computing, AI/ML, programming, cybersecurity, or tech industry news.',
            '',
            'Google Trends (India):',
            trendList,
            '',
            `Existing blog categories: ${categories.join(', ') || 'none'}`,
            `Recent blog titles to AVOID duplicating: ${existingTitles.slice(0, 15).join(' | ') || 'none'}`,
            '',
            'Return strict JSON with keys:',
            '- "selectedIndex": number (1-based index from the list, or 0 if NONE are tech-relevant)',
            '- "techAngle": string (how to frame this trend for a tech/dev audience)',
            '- "suggestedCategory": string (best matching category name from the list, or suggest a new one)',
            '- "relevanceScore": number (0-100, how relevant this is to a tech blog)',
        ].join('\n');

        try {
            const result = await this.groqLlm.callGroqJson<{
                selectedIndex: number;
                techAngle: string;
                suggestedCategory: string;
                relevanceScore: number;
            }>(prompt);

            if (!result.selectedIndex || result.selectedIndex === 0 || result.relevanceScore < 30) {
                this.logger.log('No tech-relevant trends found, will fall back to category rotation');
                return null;
            }

            const selected = trends[result.selectedIndex - 1];
            if (!selected) return null;

            return {
                trendingTopic: selected.query,
                trendingScore: selected.formattedTraffic || 'N/A',
                relatedQueries: selected.relatedQueries || [],
                source: 'google-trends',
            };
        } catch (error: any) {
            this.logger.warn(`Groq trend classification failed: ${error?.message}`);
            return null;
        }
    }
}
