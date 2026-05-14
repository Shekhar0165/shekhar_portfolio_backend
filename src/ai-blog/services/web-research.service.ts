import { Injectable, Logger } from '@nestjs/common';

export interface ResearchSource {
    title: string;
    url: string;
    snippet: string;
    excerpt: string;
}

export interface ResearchBrief {
    topic: string;
    queries: string[];
    sources: ResearchSource[];
    factualBullets: string[];
}

interface SerperOrganic {
    title: string;
    link: string;
    snippet?: string;
}
interface SerperResponse {
    organic?: SerperOrganic[];
}

const PAGE_FETCH_TIMEOUT_MS = 12_000;
const MAX_PAGES_TO_SCRAPE = 3;
const MAX_PAGE_CHARS = 4500;
const USER_AGENT =
    'Mozilla/5.0 (compatible; ShekharKashyap-AI-Blog/1.0; +https://blogs.shekharkashyap.com)';

@Injectable()
export class WebResearchService {
    private readonly logger = new Logger(WebResearchService.name);

    /**
     * Gathers fresh, factual material for a topic by:
     *  1) Searching Serper for the best queries
     *  2) Fetching the top N organic result pages
     *  3) Extracting clean main-content text from each page
     *  4) Returning a compact brief the writer LLM can use as grounding
     */
    async research(topic: string, extraQueries: string[] = []): Promise<ResearchBrief> {
        const queries = this.buildQueries(topic, extraQueries);
        const apiKey = process.env.SERPER_API_KEY;

        if (!apiKey) {
            this.logger.warn('SERPER_API_KEY not configured, skipping web research');
            return { topic, queries, sources: [], factualBullets: [] };
        }

        const organic = await this.runSearches(apiKey, queries);
        const candidates = this.pickCandidateLinks(organic);

        const sources: ResearchSource[] = [];
        for (const c of candidates.slice(0, MAX_PAGES_TO_SCRAPE)) {
            const excerpt = await this.fetchAndExtract(c.link);
            if (excerpt) {
                sources.push({
                    title: c.title || c.link,
                    url: c.link,
                    snippet: c.snippet || '',
                    excerpt,
                });
            }
        }

        const factualBullets = this.extractFactualBullets(sources);
        this.logger.log(
            `Web research for "${topic}": ${sources.length} pages scraped, ${factualBullets.length} factual bullets extracted`,
        );

        return { topic, queries, sources, factualBullets };
    }

    private buildQueries(topic: string, extra: string[]): string[] {
        const base = [topic.trim()];
        const variants = [
            `${topic} tutorial`,
            `${topic} best practices`,
            `${topic} guide ${new Date().getFullYear()}`,
        ];
        return Array.from(new Set([...base, ...extra.slice(0, 2), ...variants]))
            .filter(Boolean)
            .slice(0, 4);
    }

    private async runSearches(apiKey: string, queries: string[]): Promise<SerperOrganic[]> {
        const all: SerperOrganic[] = [];
        for (const q of queries) {
            try {
                const res = await fetch(process.env.SERPER_API_URL || 'https://google.serper.dev/search', {
                    method: 'POST',
                    headers: {
                        'X-API-KEY': apiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ q, num: 10 }),
                });
                if (!res.ok) {
                    this.logger.warn(`Serper search "${q}" failed: HTTP ${res.status}`);
                    continue;
                }
                const data = (await res.json()) as SerperResponse;
                if (Array.isArray(data.organic)) all.push(...data.organic);
            } catch (error: any) {
                this.logger.warn(`Serper search "${q}" threw: ${error?.message}`);
            }
        }
        return all;
    }

    private pickCandidateLinks(organic: SerperOrganic[]): SerperOrganic[] {
        const seen = new Set<string>();
        const out: SerperOrganic[] = [];
        const blockedHosts = [
            'youtube.com', 'youtu.be', 'twitter.com', 'x.com',
            'facebook.com', 'linkedin.com', 'instagram.com', 'reddit.com',
            'pinterest.com', 'tiktok.com',
        ];

        for (const r of organic) {
            if (!r?.link || !r?.title) continue;
            let host = '';
            try { host = new URL(r.link).hostname.replace(/^www\./, ''); } catch { continue; }
            if (blockedHosts.some((b) => host.endsWith(b))) continue;
            if (seen.has(host)) continue;
            seen.add(host);
            out.push(r);
            if (out.length >= 8) break;
        }
        return out;
    }

    private async fetchAndExtract(url: string): Promise<string | null> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                signal: controller.signal,
                redirect: 'follow',
            });

            if (!res.ok) {
                this.logger.warn(`Page fetch ${url} returned HTTP ${res.status}`);
                return null;
            }

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
                return null;
            }

            const html = await res.text();
            return this.extractMainText(html);
        } catch (error: any) {
            this.logger.warn(`Page fetch ${url} failed: ${error?.message}`);
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Lightweight HTML → text. Removes scripts/styles/nav/header/footer/aside,
     * preserves headings and paragraphs as separate lines, collapses whitespace,
     * and caps the result so it fits comfortably inside an LLM prompt.
     */
    private extractMainText(html: string): string {
        if (!html) return '';

        let work = html
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<aside[\s\S]*?<\/aside>/gi, '')
            .replace(/<form[\s\S]*?<\/form>/gi, '');

        // Prefer an <article>/<main> block if available, else use the body.
        const articleMatch =
            work.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
            work.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        if (articleMatch) work = articleMatch[1];

        const text = work
            .replace(/<\/(h1|h2|h3|h4|p|li|br|div)>/gi, '\n')
            .replace(/<br\s*\/?\s*>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/[ \t]+/g, ' ')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return text.slice(0, MAX_PAGE_CHARS);
    }

    /**
     * Pulls the most "fact-shaped" sentences out of the scraped excerpts.
     * Used to give the writer concrete bullets it can cite.
     */
    private extractFactualBullets(sources: ResearchSource[]): string[] {
        const bullets: string[] = [];
        const seen = new Set<string>();

        for (const src of sources) {
            const sentences = src.excerpt.split(/(?<=[.!?])\s+/).slice(0, 40);
            for (const raw of sentences) {
                const s = raw.trim();
                if (s.length < 60 || s.length > 280) continue;
                // Keep sentences that look factual / technical.
                if (!/[A-Z]/.test(s)) continue;
                if (/^(click|sign up|subscribe|cookie)/i.test(s)) continue;
                const key = s.toLowerCase().slice(0, 80);
                if (seen.has(key)) continue;
                seen.add(key);
                bullets.push(s);
                if (bullets.length >= 12) break;
            }
            if (bullets.length >= 12) break;
        }

        return bullets;
    }

    /**
     * Renders the brief into a compact, prompt-ready block. Returns an empty
     * string if nothing usable was found, so prompts can include it safely.
     */
    formatForPrompt(brief: ResearchBrief, maxChars = 3500): string {
        if (!brief || brief.sources.length === 0) return '';

        const parts: string[] = [];
        parts.push('REAL-WORLD RESEARCH MATERIAL (use these facts; cite sources where appropriate):');
        parts.push('');

        brief.sources.forEach((src, i) => {
            parts.push(`[${i + 1}] ${src.title} — ${src.url}`);
            if (src.snippet) parts.push(`  Summary: ${src.snippet}`);
            const trimmed = src.excerpt.replace(/\s+/g, ' ').slice(0, 800);
            if (trimmed) parts.push(`  Excerpt: ${trimmed}`);
            parts.push('');
        });

        if (brief.factualBullets.length > 0) {
            parts.push('Key facts to consider weaving in:');
            for (const b of brief.factualBullets) parts.push(`- ${b}`);
        }

        const out = parts.join('\n');
        return out.length > maxChars ? out.slice(0, maxChars) + '\n... (truncated)' : out;
    }
}
