import { Injectable, Logger } from '@nestjs/common';
import { GroqLlmService } from './groq-llm.service.js';

export interface KeywordResearchResult {
    primaryKeyword: string;
    longTailKeywords: string[];
    searchIntent: string;
    contentGaps: string[];
    recommendedHeadings: string[];
    targetWordCount: number;
    peopleAlsoAsk: string[];
    competitorTitles: string[];
}

interface SerperOrganicResult {
    title: string;
    link: string;
    snippet: string;
    position: number;
}

interface SerperPAAResult {
    question: string;
    snippet?: string;
}

interface SerperResponse {
    organic?: SerperOrganicResult[];
    peopleAlsoAsk?: SerperPAAResult[];
    relatedSearches?: { query: string }[];
}

@Injectable()
export class KeywordResearchService {
    private readonly logger = new Logger(KeywordResearchService.name);

    constructor(private readonly groqLlm: GroqLlmService) {}

    async research(topic: string, relatedQueries: string[] = []): Promise<KeywordResearchResult> {
        const serpData = await this.fetchSerpData(topic);
        const relatedSerpData = relatedQueries.length > 0
            ? await this.fetchSerpData(relatedQueries[0])
            : null;

        return this.analyzeWithGroq(topic, serpData, relatedSerpData, relatedQueries);
    }

    private async fetchSerpData(query: string): Promise<SerperResponse | null> {
        const apiKey = process.env.SERPER_API_KEY;
        if (!apiKey) {
            this.logger.warn('SERPER_API_KEY not set, skipping SERP data fetch');
            return null;
        }

        const apiUrl = process.env.SERPER_API_URL || 'https://google.serper.dev/search';

        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': apiKey,
                },
                body: JSON.stringify({
                    q: query,
                    gl: 'in',
                    hl: 'en',
                    num: 10,
                }),
            });

            if (!res.ok) {
                this.logger.warn(`Serper API returned ${res.status} for "${query}"`);
                return null;
            }

            return (await res.json()) as SerperResponse;
        } catch (error: any) {
            this.logger.warn(`Serper fetch failed: ${error?.message}`);
            return null;
        }
    }

    private async analyzeWithGroq(
        topic: string,
        serpData: SerperResponse | null,
        relatedSerpData: SerperResponse | null,
        relatedQueries: string[],
    ): Promise<KeywordResearchResult> {
        const topResults = (serpData?.organic || []).slice(0, 10);
        const paaQuestions = (serpData?.peopleAlsoAsk || []).map((p) => p.question);
        const relatedSearches = (serpData?.relatedSearches || []).map((r) => r.query);
        const competitorTitles = topResults.map((r) => r.title);
        const competitorSnippets = topResults.map((r) => `${r.title}: ${r.snippet}`).join('\n');

        const prompt = [
            'You are an expert SEO keyword researcher for a tech blog.',
            `Topic: "${topic}"`,
            '',
            `Top 10 Google results:`,
            competitorSnippets || 'No SERP data available',
            '',
            `People Also Ask: ${paaQuestions.join(' | ') || 'none'}`,
            `Related Searches: ${relatedSearches.join(' | ') || 'none'}`,
            `Google Trends Related Queries: ${relatedQueries.join(' | ') || 'none'}`,
            '',
            'Analyze the SERP landscape and return strict JSON with these keys:',
            '- "primaryKeyword": string (the single best target keyword for this topic)',
            '- "longTailKeywords": string[] (5-8 long-tail keyword variations)',
            '- "searchIntent": string ("informational", "transactional", "navigational", or "commercial")',
            '- "contentGaps": string[] (3-5 topics/angles that top-ranking articles are MISSING)',
            '- "recommendedHeadings": string[] (6-10 H2/H3 headings to cover for comprehensive content)',
            '- "targetWordCount": number (optimal word count based on competing articles)',
            '- "peopleAlsoAsk": string[] (keep the PAA questions that are most relevant)',
        ].join('\n');

        try {
            const result = await this.groqLlm.callGroqJson<{
                primaryKeyword: string;
                longTailKeywords: string[];
                searchIntent: string;
                contentGaps: string[];
                recommendedHeadings: string[];
                targetWordCount: number;
                peopleAlsoAsk: string[];
            }>(prompt);

            return {
                primaryKeyword: result.primaryKeyword || topic,
                longTailKeywords: (result.longTailKeywords || []).slice(0, 8),
                searchIntent: result.searchIntent || 'informational',
                contentGaps: (result.contentGaps || []).slice(0, 5),
                recommendedHeadings: (result.recommendedHeadings || []).slice(0, 10),
                targetWordCount: result.targetWordCount || 2000,
                peopleAlsoAsk: (result.peopleAlsoAsk || paaQuestions).slice(0, 6),
                competitorTitles,
            };
        } catch (error: any) {
            this.logger.warn(`Groq keyword analysis failed: ${error?.message}, using defaults`);
            return {
                primaryKeyword: topic,
                longTailKeywords: relatedQueries.slice(0, 5),
                searchIntent: 'informational',
                contentGaps: [],
                recommendedHeadings: [],
                targetWordCount: 2000,
                peopleAlsoAsk: paaQuestions.slice(0, 6),
                competitorTitles,
            };
        }
    }
}
