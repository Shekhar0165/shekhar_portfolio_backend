import { Injectable, Logger } from '@nestjs/common';
import { GroqLlmService } from './groq-llm.service.js';

interface TrendItem {
    query: string;
    formattedTraffic?: string;
    relatedQueries?: string[];
    sourceName?: string;
    sourceUrl?: string;
}

export type TrendSource = 'hacker-news' | 'dev-to' | 'reddit' | 'category-rotation';

export interface TrendScoutResult {
    trendingTopic: string;
    trendingScore: string;
    relatedQueries: string[];
    source: TrendSource;
}

@Injectable()
export class TrendScoutService {
    private readonly logger = new Logger(TrendScoutService.name);
    private readonly fetchTimeoutMs = 10_000;

    constructor(private readonly groqLlm: GroqLlmService) { }

    /**
     * Aggregates trending tech topics from three free, tech-focused sources:
     *  - Hacker News (Algolia front-page search)
     *  - Dev.to top articles (past 7 days)
     *  - Reddit r/programming, r/webdev, r/devops hot
     * Returns a deduplicated, ranked list ready for LLM selection.
     */
    async discoverTrendingTopics(): Promise<TrendItem[]> {
        const [hn, devto, reddit] = await Promise.allSettled([
            this.fetchHackerNews(),
            this.fetchDevTo(),
            this.fetchReddit(),
        ]);

        const merged: TrendItem[] = [];
        if (hn.status === 'fulfilled') merged.push(...hn.value);
        else this.logger.warn(`Hacker News fetch failed: ${hn.reason}`);

        if (devto.status === 'fulfilled') merged.push(...devto.value);
        else this.logger.warn(`Dev.to fetch failed: ${devto.reason}`);

        if (reddit.status === 'fulfilled') merged.push(...reddit.value);
        else this.logger.warn(`Reddit fetch failed: ${reddit.reason}`);

        const deduped = this.dedupeByTitle(merged);
        this.logger.log(
            `Tech-trend pool: ${deduped.length} items (HN: ${hn.status === 'fulfilled' ? hn.value.length : 0}, Dev.to: ${devto.status === 'fulfilled' ? devto.value.length : 0}, Reddit: ${reddit.status === 'fulfilled' ? reddit.value.length : 0})`,
        );

        return deduped;
    }

    private async fetchHackerNews(): Promise<TrendItem[]> {
        const url = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30';
        const data = await this.fetchJson<any>(url);
        const hits = Array.isArray(data?.hits) ? data.hits : [];

        return hits
            .filter((h: any) => h?.title && (h.points || 0) >= 20)
            .map((h: any) => ({
                query: h.title,
                formattedTraffic: `${h.points || 0}pts · ${h.num_comments || 0}c`,
                relatedQueries: [],
                sourceName: 'Hacker News',
                sourceUrl: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
            }))
            .slice(0, 20);
    }

    private async fetchDevTo(): Promise<TrendItem[]> {
        const url = 'https://dev.to/api/articles?top=7&per_page=20';
        const data = await this.fetchJson<any[]>(url);
        const items = Array.isArray(data) ? data : [];

        return items
            .filter((a) => a?.title)
            .map((a) => ({
                query: a.title,
                formattedTraffic: `${a.public_reactions_count || 0}❤ · ${a.comments_count || 0}c`,
                relatedQueries: (a.tag_list || a.tags || []).slice(0, 4),
                sourceName: 'Dev.to',
                sourceUrl: a.url || a.canonical_url || '',
            }))
            .slice(0, 20);
    }

    private async fetchReddit(): Promise<TrendItem[]> {
        const subs = ['programming', 'webdev', 'devops'];
        const all: TrendItem[] = [];

        for (const sub of subs) {
            try {
                const url = `https://www.reddit.com/r/${sub}/hot.json?limit=10`;
                const data = await this.fetchJson<any>(url, {
                    'User-Agent': 'ShekharKashyap-AI-Blog/1.0',
                });
                const children = data?.data?.children || [];
                for (const c of children) {
                    const p = c?.data;
                    if (!p?.title || p.stickied) continue;
                    all.push({
                        query: p.title,
                        formattedTraffic: `${p.ups || 0}↑ · ${p.num_comments || 0}c`,
                        relatedQueries: p.link_flair_text ? [p.link_flair_text] : [],
                        sourceName: `Reddit r/${sub}`,
                        sourceUrl: `https://www.reddit.com${p.permalink || ''}`,
                    });
                }
            } catch (error: any) {
                this.logger.warn(`Reddit r/${sub} fetch failed: ${error?.message}`);
            }
        }

        return all.slice(0, 20);
    }

    private dedupeByTitle(items: TrendItem[]): TrendItem[] {
        const seen = new Set<string>();
        const out: TrendItem[] = [];
        for (const it of items) {
            const key = this.normalizeKey(it.query);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(it);
        }
        return out;
    }

    private normalizeKey(text: string): string {
        return (text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .slice(0, 8)
            .join(' ');
    }

    private async fetchJson<T>(url: string, extraHeaders: Record<string, string> = {}): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
        try {
            const res = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    ...extraHeaders,
                },
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
            return (await res.json()) as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    async pickBestTechTopic(
        trends: TrendItem[],
        existingTitles: string[],
        categories: string[],
    ): Promise<TrendScoutResult | null> {
        if (trends.length === 0) return null;

        const trendList = trends
            .slice(0, 30)
            .map(
                (t, i) =>
                    `${i + 1}. [${t.sourceName || 'web'}] "${t.query}"${t.formattedTraffic ? ` (${t.formattedTraffic})` : ''}`,
            )
            .join('\n');

        const prompt = [
            'You are picking the best blog topic for a backend & DevOps engineering blog.',
            'Every item in the list below comes from a tech source (Hacker News, Dev.to, Reddit r/programming/webdev/devops), so all are tech-relevant.',
            'Pick the ONE that is:',
            '  1) actionable as a how-to / deep-dive tutorial (not just news or opinion),',
            '  2) evergreen-leaning (still useful in 6 months),',
            '  3) NOT a near-duplicate of any recent blog title,',
            '  4) interesting to backend/DevOps/full-stack developers.',
            '',
            'Trending tech items:',
            trendList,
            '',
            `Existing blog categories: ${categories.join(', ') || 'none'}`,
            `Recent blog titles to AVOID duplicating: ${existingTitles.slice(0, 15).join(' | ') || 'none'}`,
            '',
            'Return strict JSON:',
            '{',
            '  "selectedIndex": number (1-based, or 0 if NOTHING in the list is a good tutorial topic),',
            '  "techAngle": string (how to frame this as a practical tutorial),',
            '  "suggestedCategory": string (best matching category from the list, or a new one),',
            '  "relevanceScore": number (0-100)',
            '}',
        ].join('\n');

        try {
            const result = await this.groqLlm.callGroqJson<{
                selectedIndex: number;
                techAngle: string;
                suggestedCategory: string;
                relevanceScore: number;
            }>(prompt);

            if (!result.selectedIndex || result.selectedIndex === 0 || result.relevanceScore < 30) {
                this.logger.log('No strong tutorial candidate from tech trends, falling back to category rotation');
                return null;
            }

            const selected = trends[result.selectedIndex - 1];
            if (!selected) return null;

            return {
                trendingTopic: selected.query,
                trendingScore: selected.formattedTraffic || 'N/A',
                relatedQueries: selected.relatedQueries || [],
                source: this.mapSourceName(selected.sourceName),
            };
        } catch (error: any) {
            this.logger.warn(`Groq trend classification failed: ${error?.message}`);
            return null;
        }
    }

    private mapSourceName(name?: string): TrendSource {
        if (!name) return 'category-rotation';
        const n = name.toLowerCase();
        if (n.includes('hacker')) return 'hacker-news';
        if (n.includes('dev.to')) return 'dev-to';
        if (n.includes('reddit')) return 'reddit';
        return 'category-rotation';
    }
}
