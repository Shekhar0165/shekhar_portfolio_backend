import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import { BlogService } from '../blog/blog.service.js';
import { CategoryService } from '../category/category.service.js';
import { UploadService } from '../upload/upload.service.js';
import { GenerateAiBlogDto } from './dto/generate-ai-blog.dto.js';
import { AiBlogRun, AiBlogRunDocument } from './schemas/ai-blog-run.schema.js';
import { AiEditorialState, AiEditorialStateDocument } from './schemas/ai-editorial-state.schema.js';
import { AiTopicHistory, AiTopicHistoryDocument } from './schemas/ai-topic-history.schema.js';
import { GroqLlmService } from './services/groq-llm.service.js';
import { TrendScoutService, TrendScoutResult } from './services/trend-scout.service.js';
import { KeywordResearchService, KeywordResearchResult } from './services/keyword-research.service.js';
import { WebResearchService, ResearchBrief } from './services/web-research.service.js';

interface Agent0Plan {
    categoryName: string;
    categorySlug: string;
    topic: string;
    intent: string;
    tags: string[];
    keywords: string[];
    trendData: TrendScoutResult | null;
    keywordResearch: KeywordResearchResult | null;
    research?: ResearchBrief | null;
}

interface GeneratedDraft {
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    seoKeywords: string[];
    tags: string[];
    readingTime: string;
    metaDescription: string;
    coverImagePrompt: string;
}

interface ValidationResult {
    pass: boolean;
    qualityScore: number;
    plagiarismScore: number;
    factScore: number;
    evidenceSnippets: string[];
    plagiarismProvider: string;
    usedExternalPlagiarism: boolean;
    issues: string[];
}

interface ExternalPlagiarismResult {
    score: number;
    issues: string[];
    provider: string;
}

interface SeoResult {
    seoScore: number;
    improvedTitle: string;
    improvedSlug: string;
    improvedExcerpt: string;
    improvedMetaDescription: string;
    improvedSeoKeywords: string[];
    improvedTags: string[];
    improvedContent: string;
}

interface ListRunsOptions {
    limit?: number;
    status?: 'running' | 'published' | 'failed';
    triggerType?: 'manual' | 'scheduled';
    category?: string;
    from?: Date;
    to?: Date;
}

@Injectable()
export class AiBlogService {
    private readonly logger = new Logger(AiBlogService.name);

    constructor(
        @InjectModel(AiBlogRun.name) private readonly runModel: Model<AiBlogRunDocument>,
        @InjectModel(AiEditorialState.name) private readonly editorialStateModel: Model<AiEditorialStateDocument>,
        @InjectModel(AiTopicHistory.name) private readonly topicHistoryModel: Model<AiTopicHistoryDocument>,
        private readonly blogService: BlogService,
        private readonly categoryService: CategoryService,
        private readonly uploadService: UploadService,
        private readonly groqLlm: GroqLlmService,
        private readonly trendScout: TrendScoutService,
        private readonly keywordResearch: KeywordResearchService,
        private readonly webResearch: WebResearchService,
    ) { }

    async generateAndPublish(dto: GenerateAiBlogDto, triggerType: 'manual' | 'scheduled' = 'manual'): Promise<AiBlogRun> {
        const run = await this.runModel.create({
            status: 'running',
            triggerType,
            currentStep: 'agent0-trend-discovery',
            llmProvider: 'groq',
            logs: ['Run created — using Groq + Google Trends pipeline'],
            startedAt: new Date(),
        });

        try {
            const plan = await this.agent0TopicPlanner(dto, run._id.toString());

            await this.updateRun(run._id.toString(), {
                currentStep: 'agent05-keyword-research',
            }, 'Starting keyword research');

            const kwResult = await this.agent05KeywordResearcher(plan, run._id.toString());
            plan.keywordResearch = kwResult;

            await this.updateRun(run._id.toString(), {
                currentStep: 'agent08-web-research',
            }, 'Starting web research (Serper + page scrape)');

            plan.research = await this.agent08WebResearcher(plan, run._id.toString());

            let draft = await this.agent1Writer(plan, dto.seedTopic);

            // Proactive expansion: if the writer underdelivered on length, expand
            // BEFORE the validator gets a chance to hard-fail. Loop up to 3 times,
            // bailing out early if the LLM stops adding meaningful new content.
            const targetWordCount = Number(process.env.AI_TARGET_WORD_COUNT || 1100);
            const maxExpansions = Math.max(0, Number(process.env.AI_MAX_EXPANSIONS || 3));
            let lastCount = this.countWords(draft.content);
            for (let i = 0; i < maxExpansions && lastCount < targetWordCount; i++) {
                await this.updateRun(run._id.toString(), {
                    currentStep: 'agent1-proactive-expand',
                }, `Draft is ${lastCount} words (target ${targetWordCount}); proactive expansion pass ${i + 1}`);

                try {
                    draft = await this.agent1Expander(draft, lastCount, plan);
                } catch (error: any) {
                    this.logger.warn(`Proactive expansion ${i + 1} failed: ${error?.message}; stopping expansion loop`);
                    break;
                }

                const newCount = this.countWords(draft.content);
                // If the LLM added fewer than 80 words, it's stuck — stop wasting tokens.
                if (newCount - lastCount < 80) {
                    this.logger.warn(`Expansion ${i + 1} added only ${newCount - lastCount} words; stopping loop`);
                    lastCount = newCount;
                    break;
                }
                lastCount = newCount;
            }

            const maxValidationRetries = Number(process.env.AI_AGENT2_MAX_RETRIES || 2);

            let finalValidation: ValidationResult = {
                pass: false,
                qualityScore: 0,
                plagiarismScore: 0,
                factScore: 0,
                evidenceSnippets: [],
                plagiarismProvider: 'heuristic',
                usedExternalPlagiarism: false,
                issues: ['Validation not started'],
            };

            for (let i = 0; i <= maxValidationRetries; i++) {
                await this.updateRun(run._id.toString(), {
                    currentStep: 'agent2-validation',
                    iterationCount: i + 1,
                }, `Agent 2 validation attempt ${i + 1}`);

                finalValidation = await this.agent2Validator(draft);
                if (finalValidation.pass) break;

                if (i < maxValidationRetries) {
                    const route = this.classifyValidationIssues(finalValidation.issues, draft);
                    if (route.action === 'expand') {
                        await this.updateRun(run._id.toString(), {
                            currentStep: 'agent1-expand',
                        }, `Agent 2 wants more depth (${route.wordCount} words); expanding in place`);
                        draft = await this.agent1Expander(draft, route.wordCount, plan);
                    } else {
                        await this.updateRun(run._id.toString(), {
                            currentStep: 'agent1-rewrite',
                        }, 'Agent 2 requested structural fixes, rewriting draft');
                        draft = await this.agent1Rewrite(draft, finalValidation.issues, plan);
                    }
                }
            }

            if (!finalValidation.pass) {
                await this.failRun(run._id.toString(), 'Validation failed after max retries');
                throw new Error(`Validation failed: ${finalValidation.issues.join('; ')}`);
            }

            await this.updateRun(run._id.toString(), {
                currentStep: 'agent3-seo-optimization',
                validationScore: finalValidation.qualityScore,
                plagiarismScore: finalValidation.plagiarismScore,
                factScore: finalValidation.factScore,
                plagiarismProvider: finalValidation.plagiarismProvider,
                usedExternalPlagiarism: finalValidation.usedExternalPlagiarism,
                evidenceSnippets: finalValidation.evidenceSnippets,
            }, 'Validation passed, moving to SEO optimization');

            const targetKeywords = kwResult?.longTailKeywords || plan.keywords;
            const seo = await this.agent3SeoOptimizer(draft, targetKeywords);

            await this.updateRun(run._id.toString(), {
                seoScore: seo.seoScore,
            }, `SEO optimization score: ${seo.seoScore}`);

            let coverImageUrl = '';
            try {
                coverImageUrl = await this.generateCoverImageAndUpload(
                    seo.improvedTitle || draft.title,
                    draft.coverImagePrompt,
                );
                await this.updateRun(run._id.toString(), {
                    currentStep: 'publishing',
                }, 'Cover image generated and uploaded, publishing blog');
            } catch (imgError: any) {
                this.logger.warn(`Cover image generation failed: ${imgError?.message}. Publishing without image.`);
                await this.updateRun(run._id.toString(), {
                    currentStep: 'publishing',
                }, 'Cover image failed, publishing blog without image');
            }

            const created = await this.blogService.create({
                title: seo.improvedTitle || draft.title,
                slug: this.ensureSlugUnique(seo.improvedTitle || draft.title, seo.improvedSlug || draft.slug),
                excerpt: seo.improvedExcerpt || draft.excerpt,
                content: seo.improvedContent || draft.content,
                coverImage: coverImageUrl || undefined,
                published: dto.autoPublish ?? true,
                seoKeywords: this.uniqueArray(seo.improvedSeoKeywords.length ? seo.improvedSeoKeywords : draft.seoKeywords),
                tags: this.uniqueArray(seo.improvedTags.length ? seo.improvedTags : draft.tags),
                author: 'Shekhar Kashyap',
                readingTime: draft.readingTime,
                metaDescription: seo.improvedMetaDescription || draft.metaDescription,
            });

            await this.updateRun(run._id.toString(), {
                status: 'published',
                currentStep: 'done',
                selectedCategory: plan.categoryName,
                selectedTopic: plan.topic,
                generatedTitle: created.title,
                blogId: (created as any)._id?.toString?.() || '',
                validationScore: finalValidation.qualityScore,
                plagiarismScore: finalValidation.plagiarismScore,
                factScore: finalValidation.factScore,
                plagiarismProvider: finalValidation.plagiarismProvider,
                usedExternalPlagiarism: finalValidation.usedExternalPlagiarism,
                evidenceSnippets: finalValidation.evidenceSnippets,
                trendingTopic: plan.trendData?.trendingTopic || '',
                trendingScore: plan.trendData?.trendingScore || '',
                topicSource: plan.trendData?.source || 'category-rotation',
                targetKeywords: kwResult?.longTailKeywords || [],
                searchIntent: kwResult?.searchIntent || '',
                contentGaps: kwResult?.contentGaps || [],
                llmProvider: 'groq',
                finishedAt: new Date(),
            }, 'Run completed and post published');

            await this.markCategoryCovered(plan.categorySlug);
            await this.saveTopicHistory(run._id.toString(), plan, created.title, (created as any)._id?.toString?.() || '');

            return this.getRunById(run._id.toString());
        } catch (error: any) {
            this.logger.error(`AI generation failed: ${error?.message || error}`);
            await this.failRun(run._id.toString(), error?.message || 'Unknown error');
            return this.getRunById(run._id.toString());
        }
    }

    async startScheduledRun(): Promise<{ started: boolean; reason?: string; runId?: string }> {
        const hasRunning = await this.runModel.exists({ status: 'running' });
        if (hasRunning) {
            this.logger.warn('Skipping scheduled run because another AI run is still running');
            return { started: false, reason: 'Another run is already running' };
        }

        const run = await this.generateAndPublish({ autoPublish: true }, 'scheduled');
        return { started: true, runId: (run as any)._id?.toString?.() };
    }

    async listRuns(options: ListRunsOptions = {}): Promise<AiBlogRun[]> {
        const query: any = {};
        if (options.status) query.status = options.status;
        if (options.triggerType) query.triggerType = options.triggerType;
        if (options.category) query.selectedCategory = options.category;
        if (options.from || options.to) {
            query.createdAt = {};
            if (options.from) query.createdAt.$gte = options.from;
            if (options.to) query.createdAt.$lte = options.to;
        }

        const limit = Number.isFinite(options.limit) ? Number(options.limit) : 20;
        return this.runModel.find(query).sort({ createdAt: -1 }).limit(Math.max(1, limit)).exec();
    }

    async getRunById(id: string): Promise<AiBlogRun> {
        const run = await this.runModel.findById(id).exec();
        if (!run) throw new NotFoundException('Run not found');
        return run;
    }

    async getEditorialState() {
        const categories = await this.categoryService.findAll();
        const state = await this.getOrCreateEditorialState(categories);
        const covered = new Set(state.coveredCategorySlugs || []);
        const uncovered = categories.filter((c) => !covered.has(c.slug));

        return {
            cycleNumber: state.cycleNumber,
            coveredCategorySlugs: state.coveredCategorySlugs,
            lastCategorySlug: state.lastCategorySlug,
            lastRunAt: state.lastRunAt,
            uncoveredCategories: uncovered.map((c) => ({ name: c.name, slug: c.slug })),
        };
    }

    // ─── Agent 0: Topic Planner (Google Trends + Groq) ──────────────────

    private async agent0TopicPlanner(dto: GenerateAiBlogDto, runId: string): Promise<Agent0Plan> {
        const categories = await this.categoryService.findAll();
        if (categories.length === 0) {
            throw new Error('No categories configured. Create at least one category first.');
        }

        const recentTitles = (await this.blogService.findAll(false)).slice(0, 30).map((p) => p.title);
        const categoryNames = categories.map((c) => c.name);

        let trendData: TrendScoutResult | null = null;

        if (!dto.seedTopic && !dto.forceCategory) {
            await this.updateRun(runId, {
                currentStep: 'agent0-trend-discovery',
            }, 'Discovering trending topics from Google Trends India');

            const trends = await this.trendScout.discoverTrendingTopics();
            trendData = await this.trendScout.pickBestTechTopic(trends, recentTitles, categoryNames);
        }

        let selectedCategory: { name: string; slug: string; order?: number };
        let topic: string;
        let intent: string;
        let tags: string[];
        let keywords: string[];

        if (trendData) {
            this.logger.log(`Trend-based topic selected: "${trendData.trendingTopic}"`);

            await this.updateRun(runId, {
                currentStep: 'agent0-topic-planning',
                trendingTopic: trendData.trendingTopic,
                trendingScore: trendData.trendingScore,
                topicSource: trendData.source,
            }, `Trending topic found: "${trendData.trendingTopic}" (${trendData.trendingScore}) from ${trendData.source}`);

            const prompt = [
                'You are Agent 0 (Topic Planner).',
                `A trending topic from Google Trends India: "${trendData.trendingTopic}"`,
                `Related queries: ${trendData.relatedQueries.join(', ') || 'none'}`,
                `Available blog categories: ${categoryNames.join(', ')}`,
                `Recent titles to avoid: ${recentTitles.join(' | ') || 'none'}`,
                'Return strict JSON with keys: topic, intent, tags, keywords, categoryName.',
                'Rules: frame the trending topic for a tech/dev audience, deep technical but useful for beginners, practical, no clickbait.',
                'categoryName must be one of the existing categories or a new one if none fit.',
            ].join('\n');

            const result = await this.groqLlm.callGroqJson<{
                topic: string; intent: string; tags: string[]; keywords: string[];
                categoryName: string;
            }>(prompt);

            const matchedCat = categories.find(
                (c) => c.name.toLowerCase() === (result.categoryName || '').toLowerCase(),
            );
            selectedCategory = matchedCat || await this.pickCategoryByRotation(categories);
            topic = result.topic || trendData.trendingTopic;
            intent = result.intent || 'Informational';
            tags = this.uniqueArray([selectedCategory.name, ...(result.tags || [])]).slice(0, 8);
            keywords = this.uniqueArray(result.keywords || []).slice(0, 12);
        } else {
            await this.updateRun(runId, {
                currentStep: 'agent0-topic-planning',
                topicSource: 'category-rotation',
            }, 'No relevant trends found, using category rotation');

            selectedCategory = dto.forceCategory
                ? await this.resolveOrCreateCategory(dto.forceCategory, categories)
                : await this.pickCategoryByRotation(categories);

            const prompt = [
                'You are Agent 0 (Topic Planner).',
                `Category: ${selectedCategory.name}`,
                `Recent titles to avoid: ${recentTitles.join(' | ') || 'none'}`,
                `Optional seed topic: ${dto.seedTopic || 'none'}`,
                'Return strict JSON with keys: topic, intent, tags, keywords.',
                'Rules: deep technical but useful for beginners, practical, no clickbait.',
            ].join('\n');

            const result = await this.groqLlm.callGroqJson<{
                topic: string; intent: string; tags: string[]; keywords: string[];
            }>(prompt);

            topic = result.topic || dto.seedTopic || `${selectedCategory.name} practical guide`;
            intent = result.intent || 'Informational';
            tags = this.uniqueArray([selectedCategory.name, ...(result.tags || [])]).slice(0, 8);
            keywords = this.uniqueArray(result.keywords || []).slice(0, 12);
        }

        const plan: Agent0Plan = {
            categoryName: selectedCategory.name,
            categorySlug: selectedCategory.slug,
            topic,
            intent,
            tags,
            keywords,
            trendData,
            keywordResearch: null,
        };

        await this.updateRun(runId, {
            selectedCategory: plan.categoryName,
            selectedTopic: plan.topic,
        }, `Agent 0 selected category "${plan.categoryName}" and topic "${plan.topic}"`);

        return plan;
    }

    // ─── Agent 0.5: Keyword Researcher ──────────────────────────────────

    private async agent05KeywordResearcher(plan: Agent0Plan, runId: string): Promise<KeywordResearchResult | null> {
        try {
            const relatedQueries = plan.trendData?.relatedQueries || [];
            const kwResult = await this.keywordResearch.research(plan.topic, relatedQueries);

            await this.updateRun(runId, {
                targetKeywords: [kwResult.primaryKeyword, ...kwResult.longTailKeywords].slice(0, 10),
                searchIntent: kwResult.searchIntent,
                contentGaps: kwResult.contentGaps,
            }, `Keyword research done: primary="${kwResult.primaryKeyword}", intent=${kwResult.searchIntent}, ${kwResult.longTailKeywords.length} long-tails`);

            return kwResult;
        } catch (error: any) {
            this.logger.warn(`Keyword research failed: ${error?.message}, continuing without it`);
            await this.updateRun(runId, {}, 'Keyword research failed, continuing with base keywords');
            return null;
        }
    }

    // ─── Agent 0.8: Web Researcher (Serper + page scrape) ───────────────

    private async agent08WebResearcher(plan: Agent0Plan, runId: string): Promise<ResearchBrief | null> {
        try {
            const kw = plan.keywordResearch;
            const extraQueries = [
                kw?.primaryKeyword,
                ...(kw?.longTailKeywords || []).slice(0, 2),
                ...(plan.trendData?.relatedQueries || []).slice(0, 2),
            ].filter((q): q is string => !!q);

            const brief = await this.webResearch.research(plan.topic, extraQueries);

            await this.updateRun(runId, {}, `Web research done: ${brief.sources.length} pages scraped, ${brief.factualBullets.length} facts extracted`);

            return brief;
        } catch (error: any) {
            this.logger.warn(`Web research failed: ${error?.message}, writer will work without it`);
            await this.updateRun(runId, {}, 'Web research failed, continuing without external grounding');
            return null;
        }
    }

    // ─── Agent 1: Writer (Groq) ─────────────────────────────────────────

    private async agent1Writer(plan: Agent0Plan, seedTopic?: string): Promise<GeneratedDraft> {
        const kw = plan.keywordResearch;
        const existingPosts = await this.blogService.findAll(true);
        const internalLinks = this.buildInternalLinksContext(existingPosts, plan.topic, plan.tags);

        const researchBlock = plan.research ? this.webResearch.formatForPrompt(plan.research, 3500) : '';

        const prompt = [
            'You are a senior backend engineer writing an in-depth technical tutorial.',
            '',
            `Topic: ${seedTopic || plan.topic}`,
            `Category: ${plan.categoryName}`,
            `Keywords: ${(plan.keywords || []).join(', ')}`,
            kw ? `Primary keyword: ${kw.primaryKeyword}` : '',
            kw ? `Long-tails: ${kw.longTailKeywords.join(', ')}` : '',
            kw ? `Content gaps to cover: ${kw.contentGaps.join('; ')}` : '',
            kw ? `Suggested headings: ${kw.recommendedHeadings.join('; ')}` : '',
            kw ? `FAQ questions: ${kw.peopleAlsoAsk.join('; ')}` : '',
            '',
            researchBlock,
            researchBlock ? '' : '',
            'HARD RULES (the article will be REJECTED if any of these fail):',
            '- TOTAL LENGTH: 1300–1700 words of body content. Do NOT stop early. Count carefully.',
            '- GROUND every factual claim in the research material above. Use real version numbers, real CLI flags, real config syntax. Do NOT invent APIs or statistics.',
            '- Include 4 code blocks MINIMUM, each 8–25 lines, using <pre><code class="language-xxx">...</code></pre>. Real, runnable code — not "// ... your code here" placeholders.',
            '- Use semantic HTML only: h2, h3, p, ul, ol, li, pre, code, strong, em, blockquote, table.',
            '- Required section structure with target word counts (sum ≈ 1500):',
            '    1. Introduction (h2): 150–200 words — hook + why this matters + what reader will learn',
            '    2. Core Concepts / How It Works (h2): 250–350 words with 1 code block',
            '    3. Step-by-Step Implementation (h2): 350–450 words with 2 code blocks and numbered <ol> steps',
            '    4. Real-World Example or Production Patterns (h2): 200–250 words with 1 code block',
            '    5. Best Practices & Gotchas (h2): 150–200 words as a <ul> of 5–7 concrete items',
            '    6. FAQ (h2 with h3 questions): 4–6 questions, each answered in 50–80 words',
            '    7. Conclusion (h2): 80–120 words — recap + next step',
            '- Voice: write like a senior engineer sharing production experience. No "as an AI", no fluff intros.',
            '- Use the primary keyword in the title, the first paragraph, and 2–3 H2 headings, naturally.',
            '- Title: includes the primary keyword + a qualifier like "Step-by-Step Guide" or "in 2026", under 60 chars.',
            '- Slug: clean, readable, hyphen-separated, no random numbers (e.g., "jenkins-ci-cd-tutorial").',
            internalLinks ? `- Link to 1–2 related posts in the body using <a href="...">...</a>: ${internalLinks}` : '',
            '',
            'Return JSON: {title, slug, excerpt (150 chars), content (HTML), seoKeywords (array), tags (array), readingTime, metaDescription (155 chars), coverImagePrompt (3-sentence vivid image description with colors/style/tech elements)}',
        ].filter(Boolean).join('\n');

        const draft = await this.groqLlm.callGroqJson<GeneratedDraft>(prompt, { maxTokens: 8000 });
        return this.normalizeDraft(draft, plan);
    }

    private async agent1Rewrite(previous: GeneratedDraft, issues: string[], plan?: Agent0Plan): Promise<GeneratedDraft> {
        const existingPosts = await this.blogService.findAll(true);
        const internalLinks = this.buildInternalLinksContext(existingPosts, previous.title, previous.tags);
        const researchBlock = plan?.research ? this.webResearch.formatForPrompt(plan.research, 2500) : '';

        const prompt = [
            'Rewrite and EXPAND this technical article. Fix these issues:',
            issues.map(i => `- ${i}`).join('\n'),
            '',
            researchBlock,
            'RULES: expand to 1000+ words, add code blocks if missing, add FAQ section, use semantic HTML, write like an engineer. Ground claims in the research material above when available.',
            internalLinks ? `Link to related posts: ${internalLinks}` : '',
            '',
            'Return JSON: {title, slug, excerpt, content, seoKeywords, tags, readingTime, metaDescription, coverImagePrompt}',
            '',
            `Title: ${previous.title}`,
            `Content: ${previous.content.slice(0, 6000)}`,
        ].filter(Boolean).join('\n');

        const rewritten = await this.groqLlm.callGroqJson<GeneratedDraft>(prompt, { maxTokens: 8000 });
        return this.normalizeDraft(rewritten, {
            categoryName: previous.tags[0] || 'General',
            categorySlug: this.slugify(previous.tags[0] || 'general'),
            topic: previous.title,
            intent: 'Informational',
            tags: previous.tags,
            keywords: previous.seoKeywords,
            trendData: null,
            keywordResearch: null,
        });
    }

    /**
     * Focused expansion pass: keeps the existing article structure intact and
     * grows it to the target length by deepening explanations and adding code
     * examples in the *thinnest* sections. Far less wasteful than a full rewrite
     * when the only validation issue is word count.
     */
    private async agent1Expander(
        previous: GeneratedDraft,
        currentWordCount: number,
        plan?: Agent0Plan,
    ): Promise<GeneratedDraft> {
        const researchBlock = plan?.research ? this.webResearch.formatForPrompt(plan.research, 2500) : '';
        const deficit = Math.max(400, 1500 - currentWordCount);

        const prompt = [
            'You are expanding an existing technical article. KEEP the article structure, voice, title, slug, tags, excerpt, and metaDescription exactly as-is.',
            `The current content is ${currentWordCount} words. Expand it by AT LEAST ${deficit} more words.`,
            '',
            'Expansion rules:',
            '- Identify the thinnest H2 sections and deepen them with more explanation, examples, and real-world context.',
            '- Add at least 1–2 new code blocks (8–25 lines each) using <pre><code class="language-xxx">...</code></pre>. Real code, no placeholders.',
            '- Add 1–2 more FAQ <h3> questions if there are fewer than 5.',
            '- Convert thin paragraphs into <ul>/<ol> lists or tables where appropriate.',
            '- Preserve every existing sentence; only ADD, never delete content (unless a sentence is duplicated).',
            '- Do NOT change the H2 order. Do NOT add an "AI says" or "I am an AI" disclaimer.',
            '',
            researchBlock,
            researchBlock ? 'Use the research material above to ground new claims in real facts.' : '',
            '',
            'Return JSON: {title, slug, excerpt, content (HTML), seoKeywords, tags, readingTime, metaDescription, coverImagePrompt}',
            '',
            `Title: ${previous.title}`,
            `Slug: ${previous.slug}`,
            `Excerpt: ${previous.excerpt}`,
            `MetaDescription: ${previous.metaDescription}`,
            `Tags: ${previous.tags.join(', ')}`,
            `SeoKeywords: ${previous.seoKeywords.join(', ')}`,
            `Current HTML content (EXPAND THIS, don't replace it):`,
            previous.content.slice(0, 9000),
        ].filter(Boolean).join('\n');

        const expanded = await this.groqLlm.callGroqJson<GeneratedDraft>(prompt, { maxTokens: 8000 });

        // Defensive: keep canonical identifiers from the original draft so SEO isn't accidentally rewritten.
        const merged: GeneratedDraft = {
            ...expanded,
            title: previous.title,
            slug: previous.slug,
            excerpt: previous.excerpt,
            metaDescription: previous.metaDescription,
            tags: previous.tags,
            seoKeywords: previous.seoKeywords,
        };

        return this.normalizeDraft(merged, {
            categoryName: previous.tags[0] || 'General',
            categorySlug: this.slugify(previous.tags[0] || 'general'),
            topic: previous.title,
            intent: 'Informational',
            tags: previous.tags,
            keywords: previous.seoKeywords,
            trendData: null,
            keywordResearch: null,
            research: plan?.research,
        });
    }

    private buildInternalLinksContext(posts: any[], currentTopic: string, currentTags: string[]): string {
        if (!posts || posts.length === 0) return '';

        const blogBaseUrl = process.env.BLOG_BASE_URL || 'https://blog.shekharkashyap.com';
        const topicWords = new Set(currentTopic.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const tagSet = new Set(currentTags.map(t => t.toLowerCase()));

        const scored = posts
            .filter(p => p.title && p.slug && p.published)
            .map(p => {
                const titleWords = new Set(p.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
                const tagOverlap = (p.tags || []).filter((t: string) => tagSet.has(t.toLowerCase())).length;
                const wordOverlap = [...topicWords].filter(w => titleWords.has(w)).length;
                return { title: p.title, slug: p.slug, tags: p.tags || [], score: tagOverlap * 2 + wordOverlap };
            })
            .filter(p => p.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        if (scored.length === 0) {
            const recent = posts.slice(0, 3).filter(p => p.title && p.slug && p.published);
            return recent.map(p => `- "${p.title}" → ${blogBaseUrl}/blog/${p.slug}`).join('\n');
        }

        return scored.map(p => `- "${p.title}" [tags: ${p.tags.join(', ')}] → ${blogBaseUrl}/blog/${p.slug}`).join('\n');
    }

    // ─── Agent 2: Validator (Groq) ──────────────────────────────────────

    private async agent2Validator(draft: GeneratedDraft): Promise<ValidationResult> {
        const factEvidence = await this.collectFactEvidence(draft);

        const existingPosts = await this.blogService.findAll(false);
        const similarity = this.maxSimilarityScore(draft.content, existingPosts.map((p) => p.content || ''));
        const heuristicPlagiarismScore = Number((Math.max(0, 100 - similarity * 100)).toFixed(2));
        const externalPlagiarism = await this.runExternalPlagiarismCheck(draft);
        const plagiarismScore = externalPlagiarism?.score ?? heuristicPlagiarismScore;
        const plagiarismProvider = externalPlagiarism?.provider || 'heuristic';
        const usedExternalPlagiarism = Boolean(externalPlagiarism);

        const { hardFail: structuralHardFail, softIssues: structuralIssues } = this.validateContentStructure(draft);

        const prompt = [
            'You are Agent 2 (Quality Validator).',
            'Evaluate technical correctness, factual accuracy, and beginner clarity.',
            'Return strict JSON: pass(boolean), qualityScore(number 0-100), factScore(number 0-100), issues(string[]).',
            'Give qualityScore 70+ if the article has real practical value with code examples.',
            `Title: ${draft.title}`,
            `Excerpt: ${draft.excerpt}`,
            `Content: ${draft.content.slice(0, 12000)}`,
            `Evidence: ${factEvidence.join(' || ') || 'none'}`,
        ].join('\n');

        const aiValidation = await this.groqLlm.callGroqJson<{
            pass: boolean; qualityScore: number; factScore: number; issues: string[];
        }>(prompt);

        const qualityScore = Math.min(100, Math.max(0, Number(aiValidation.qualityScore || 0)));
        const factScore = Math.min(100, Math.max(0, Number(aiValidation.factScore || 0)));
        const issues = Array.isArray(aiValidation.issues) ? aiValidation.issues.slice(0, 5) : [];

        const plagiarismPass = plagiarismScore >= Number(process.env.AI_PLAGIARISM_MIN_SCORE || 85);
        const qualityPass = qualityScore >= Number(process.env.AI_QUALITY_MIN_SCORE || 78);
        const factPass = factScore >= Number(process.env.AI_FACT_MIN_SCORE || 70);

        const allIssues = [
            ...(structuralHardFail ? structuralIssues : []),
            ...issues,
            ...(externalPlagiarism?.issues || []),
            ...(plagiarismPass ? [] : ['Potentially too similar to existing posts. Rewrite with a fresher angle.']),
            ...(qualityPass ? [] : ['Quality score below threshold. Improve technical depth and clarity.']),
            ...(factPass ? [] : ['Fact score below threshold. Verify commands, versions, and claims against sources.']),
        ];

        return {
            pass: Boolean(aiValidation.pass) && plagiarismPass && qualityPass && factPass && !structuralHardFail,
            qualityScore,
            plagiarismScore,
            factScore,
            evidenceSnippets: factEvidence.slice(0, 10),
            plagiarismProvider,
            usedExternalPlagiarism,
            issues: allIssues,
        };
    }

    /**
     * Decides whether validation failures can be fixed by an in-place expansion
     * (cheaper, keeps the article structure) or need a full rewrite (different
     * angle, fixes plagiarism / structural issues).
     */
    private classifyValidationIssues(
        issues: string[],
        draft: GeneratedDraft,
    ): { action: 'expand' | 'rewrite'; wordCount: number } {
        const wordCount = this.countWords(draft.content);

        const blob = issues.join(' || ').toLowerCase();
        const looksLikePlagiarism = /similar to existing|fresher angle|plagiarism/.test(blob);
        const looksLikeStructure = /no code blocks|missing.*code|h2 heading|structure|sections/.test(blob);
        const looksLikeFactual = /verify commands|invent|incorrect|inaccurate/.test(blob);

        // If the article has reasonable bones (>=400 words, at least one code block)
        // and nothing structural/plagiarism/fact is broken, expansion is the right move.
        const hasCode = (draft.content.match(/<pre>|<code>/gi) || []).length > 0;
        const isOnlyLength = wordCount >= 400 && hasCode &&
            !looksLikePlagiarism && !looksLikeStructure && !looksLikeFactual;

        return { action: isOnlyLength ? 'expand' : 'rewrite', wordCount };
    }

    private countWords(html: string): number {
        if (!html) return 0;
        const plainText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!plainText) return 0;
        return plainText.split(/\s+/).length;
    }

    private validateContentStructure(draft: GeneratedDraft): { hardFail: boolean; softIssues: string[] } {
        const issues: string[] = [];
        const wordCount = this.countWords(draft.content);
        let hardFail = false;

        if (wordCount < 400) {
            issues.push(`Content is only ~${wordCount} words — far too short. Expand to at least 800+ words with implementation details, code examples, and practical steps.`);
            hardFail = true;
        } else if (wordCount < 700) {
            issues.push(`Content is ~${wordCount} words. Add more code examples and expand explanations to reach 1000+ words.`);
            hardFail = true;
        }

        const codeBlockCount = (draft.content.match(/<pre>/gi) || []).length + (draft.content.match(/<code>/gi) || []).length;
        if (codeBlockCount === 0) {
            issues.push('No code blocks found. Add at least 2-3 real code examples.');
            hardFail = true;
        }

        const h2Count = (draft.content.match(/<h2/gi) || []).length;
        if (h2Count < 3) {
            issues.push(`Only ${h2Count} H2 heading(s). Add more sections for better structure.`);
        }

        return { hardFail, softIssues: issues };
    }

    private async runExternalPlagiarismCheck(draft: GeneratedDraft): Promise<ExternalPlagiarismResult | null> {
        const apiUrl = process.env.AI_PLAGIARISM_API_URL;
        if (!apiUrl) return null;

        const apiKey = process.env.AI_PLAGIARISM_API_KEY || '';
        const apiKeyHeader = process.env.AI_PLAGIARISM_API_KEY_HEADER || 'x-api-key';

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers[apiKeyHeader] = apiKey;

        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    title: draft.title,
                    excerpt: draft.excerpt,
                    content: draft.content,
                }),
            });

            if (!res.ok) {
                this.logger.warn(`External plagiarism API failed with status ${res.status}`);
                return null;
            }

            const data: any = await res.json();
            const rawScore = Number(
                data?.score ?? data?.uniquenessScore ?? data?.plagiarismFreeScore ?? data?.result?.score ?? 0,
            );
            const normalized = Math.min(100, Math.max(0, rawScore));
            const provider = data?.provider || 'external';
            const issues = Array.isArray(data?.issues)
                ? data.issues.slice(0, 6)
                : normalized < Number(process.env.AI_PLAGIARISM_MIN_SCORE || 85)
                    ? ['External plagiarism provider reported low uniqueness score.']
                    : [];

            return { score: normalized, issues, provider };
        } catch (error) {
            this.logger.warn(`External plagiarism API error: ${(error as Error).message}`);
            return null;
        }
    }

    private async collectFactEvidence(draft: GeneratedDraft): Promise<string[]> {
        const serperApiKey = process.env.SERPER_API_KEY;
        if (!serperApiKey) return [];

        const queryPrompt = [
            'You are a fact-check query planner for a technical blog.',
            'Generate up to 4 concise web search queries to verify factual claims and commands.',
            'Return strict JSON with key queries: string[].',
            `Title: ${draft.title}`,
            `Excerpt: ${draft.excerpt}`,
            `Content snippet: ${draft.content.slice(0, 2500)}`,
        ].join('\n');

        const queryResult = await this.groqLlm.callGroqJson<{ queries: string[] }>(queryPrompt);
        const queries = (queryResult.queries || []).filter(Boolean).slice(0, 4);
        if (queries.length === 0) return [];

        const evidence: string[] = [];
        for (const q of queries) {
            const lines = await this.searchSerper(q);
            evidence.push(...lines.slice(0, 3));
            if (evidence.length >= 10) break;
        }

        return evidence.slice(0, 10);
    }

    private async searchSerper(query: string): Promise<string[]> {
        const apiKey = process.env.SERPER_API_KEY;
        if (!apiKey) return [];

        const apiUrl = process.env.SERPER_API_URL || 'https://google.serper.dev/search';
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': apiKey,
                },
                body: JSON.stringify({ q: query, num: 5 }),
            });

            if (!res.ok) {
                this.logger.warn(`Serper search failed with status ${res.status}`);
                return [];
            }

            const data: any = await res.json();
            const organic = Array.isArray(data?.organic) ? data.organic.slice(0, 5) : [];
            return organic
                .map((item: any) => {
                    const title = item?.title || 'Untitled';
                    const snippet = item?.snippet || '';
                    const link = item?.link || '';
                    return `${title} :: ${snippet} :: ${link}`.trim();
                })
                .filter(Boolean);
        } catch (error) {
            this.logger.warn(`Serper search error: ${(error as Error).message}`);
            return [];
        }
    }

    // ─── Agent 3: SEO Optimizer (Groq) ──────────────────────────────────

    private async agent3SeoOptimizer(draft: GeneratedDraft, targetKeywords: string[]): Promise<SeoResult> {
        const primaryKw = targetKeywords[0] || '';

        const prompt = [
            'SEO-optimize this blog article. Do NOT shorten or remove content — only improve.',
            `Primary keyword: "${primaryKw}"`,
            `All keywords: ${targetKeywords.join(', ')}`,
            '',
            'Tasks:',
            '1. Title: include primary keyword + (2026), under 60 chars, high CTR',
            '2. Replace keyword stuffing with natural semantic variations',
            '3. Meta description: 155 chars, includes keyword, has CTA',
            '4. Slug: clean, keyword-rich, no numbers (e.g., "docker-compose-tutorial")',
            '5. Ensure keyword in first paragraph and one H2',
            '6. Preserve all content length — do not truncate',
            '',
            'Return JSON: {seoScore (0-100), improvedTitle, improvedSlug, improvedExcerpt, improvedMetaDescription, improvedSeoKeywords (array), improvedTags (array), improvedContent (full HTML)}',
            '',
            `Title: ${draft.title}`,
            `Slug: ${draft.slug}`,
            `Excerpt: ${draft.excerpt}`,
            `Content: ${draft.content.slice(0, 12000)}`,
        ].join('\n');

        const result = await this.groqLlm.callGroqJson<SeoResult & { improvedSlug?: string }>(prompt, { maxTokens: 8000 });

        const improvedContent = result.improvedContent || draft.content;
        const contentWordCount = improvedContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).length;
        const originalWordCount = draft.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(/\s+/).length;
        const finalContent = contentWordCount < originalWordCount * 0.8 ? draft.content : improvedContent;

        return {
            seoScore: Math.min(100, Math.max(0, Number(result.seoScore || 0))),
            improvedTitle: result.improvedTitle || draft.title,
            improvedSlug: this.slugify(result.improvedSlug || draft.slug),
            improvedExcerpt: (result.improvedExcerpt || draft.excerpt).slice(0, 160),
            improvedMetaDescription: (result.improvedMetaDescription || draft.metaDescription).slice(0, 160),
            improvedSeoKeywords: this.uniqueArray(result.improvedSeoKeywords || draft.seoKeywords),
            improvedTags: this.uniqueArray(result.improvedTags || draft.tags),
            improvedContent: finalContent,
        };
    }

    // ─── Image Generation (Gemini — kept as-is) ─────────────────────────

    private async generateCoverImageAndUpload(title: string, coverImagePrompt: string): Promise<string> {
        const imageBuffer = await this.generateGeminiImage(coverImagePrompt || title);
        const fallbackSvgBuffer = this.generateFallbackSvgCover(title);
        const buffer = imageBuffer || fallbackSvgBuffer;

        const file = {
            fieldname: 'file',
            originalname: imageBuffer ? `${this.slugify(title)}.png` : `${this.slugify(title)}.svg`,
            encoding: '7bit',
            mimetype: imageBuffer ? 'image/png' : 'image/svg+xml',
            size: buffer.length,
            buffer,
            stream: null as any,
            destination: '',
            filename: '',
            path: '',
        } as Express.Multer.File;

        const uploaded = await this.uploadService.uploadFile(file, 'images/blog-ai');
        return uploaded.url;
    }

    private async generateGeminiImage(prompt: string): Promise<Buffer | null> {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            this.logger.warn('GEMINI_API_KEY not set, skipping image generation');
            return null;
        }

        const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-preview-image-generation';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const detailedPrompt = [
            `Generate a professional, visually stunning 16:9 blog cover image for this topic: "${prompt}".`,
            'Style requirements:',
            '- Modern, clean design with vibrant gradients and depth',
            '- Include relevant visual metaphors (e.g., code snippets, server racks, cloud icons, circuit patterns, terminal windows)',
            '- Use a professional color palette with deep blues, cyans, purples, or dark tones',
            '- Add subtle tech-themed decorative elements (geometric shapes, connecting lines, data flow visualizations)',
            '- Do NOT include any text, titles, watermarks, or logos on the image',
            '- Make it look like a premium tech blog header, similar to Medium or Dev.to featured images',
            '- The image should clearly communicate the technical topic at a glance',
        ].join('\n');

        try {
            const data: any = await this.callGeminiWithRetry(
                url,
                {
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: detailedPrompt }],
                        },
                    ],
                    generationConfig: {
                        responseModalities: ['TEXT', 'IMAGE'],
                    },
                },
                'image generation',
            );

            const parts = data?.candidates?.[0]?.content?.parts || [];
            const imagePart = parts.find((p: any) => p.inlineData?.data);
            if (!imagePart?.inlineData?.data) {
                this.logger.warn('Gemini returned response but no image data found in parts');
                return null;
            }

            this.logger.log('Gemini image generated successfully');
            return Buffer.from(imagePart.inlineData.data, 'base64');
        } catch (error) {
            this.logger.warn(`Gemini image generation error: ${(error as Error).message}`);
            return null;
        }
    }

    private generateFallbackSvgCover(title: string): Buffer {
        const safeTitle = this.escapeXml(title);
        const words = safeTitle.split(' ');
        const line1 = words.slice(0, Math.ceil(words.length / 2)).join(' ').slice(0, 45);
        const line2 = words.slice(Math.ceil(words.length / 2)).join(' ').slice(0, 45);

        const colors = [
            { bg1: '#0f0c29', bg2: '#302b63', bg3: '#24243e', accent: '#818cf8', accent2: '#06b6d4' },
            { bg1: '#0c1220', bg2: '#1a1a4e', bg3: '#162447', accent: '#e879f9', accent2: '#818cf8' },
            { bg1: '#0a192f', bg2: '#112240', bg3: '#1d3461', accent: '#64ffda', accent2: '#8892b0' },
            { bg1: '#13111c', bg2: '#1f1b33', bg3: '#2d2844', accent: '#f59e0b', accent2: '#8b5cf6' },
        ];
        const palette = colors[Math.floor(Math.random() * colors.length)];

        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg1}" />
      <stop offset="50%" stop-color="${palette.bg2}" />
      <stop offset="100%" stop-color="${palette.bg3}" />
    </linearGradient>
    <radialGradient id="glow1" cx="75%" cy="25%"><stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.15"/><stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="25%" cy="80%"><stop offset="0%" stop-color="${palette.accent2}" stop-opacity="0.12"/><stop offset="100%" stop-color="${palette.accent2}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)" />
  <rect width="1600" height="900" fill="url(#glow1)" />
  <rect width="1600" height="900" fill="url(#glow2)" />
  <line x1="0" y1="180" x2="1600" y2="180" stroke="${palette.accent}" stroke-opacity="0.05" stroke-width="1"/>
  <line x1="0" y1="360" x2="1600" y2="360" stroke="${palette.accent}" stroke-opacity="0.05" stroke-width="1"/>
  <line x1="0" y1="540" x2="1600" y2="540" stroke="${palette.accent}" stroke-opacity="0.05" stroke-width="1"/>
  <line x1="0" y1="720" x2="1600" y2="720" stroke="${palette.accent}" stroke-opacity="0.05" stroke-width="1"/>
  <line x1="400" y1="0" x2="400" y2="900" stroke="${palette.accent}" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="800" y1="0" x2="800" y2="900" stroke="${palette.accent}" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="1200" y1="0" x2="1200" y2="900" stroke="${palette.accent}" stroke-opacity="0.04" stroke-width="1"/>
  <circle cx="1350" cy="200" r="180" fill="${palette.accent}" fill-opacity="0.06" />
  <circle cx="1380" cy="230" r="120" fill="${palette.accent}" fill-opacity="0.04" />
  <circle cx="200" cy="700" r="200" fill="${palette.accent2}" fill-opacity="0.06" />
  <circle cx="230" cy="680" r="130" fill="${palette.accent2}" fill-opacity="0.04" />
  <rect x="1100" y="100" width="300" height="180" rx="12" fill="white" fill-opacity="0.03" stroke="${palette.accent}" stroke-opacity="0.1" stroke-width="1"/>
  <text x="1120" y="135" fill="${palette.accent}" fill-opacity="0.3" font-family="monospace" font-size="14">$ npm run build</text>
  <text x="1120" y="160" fill="${palette.accent2}" fill-opacity="0.2" font-family="monospace" font-size="13">✓ Compiled successfully</text>
  <text x="1120" y="185" fill="white" fill-opacity="0.15" font-family="monospace" font-size="13">  modules transformed</text>
  <text x="1120" y="210" fill="${palette.accent}" fill-opacity="0.2" font-family="monospace" font-size="14">$ _</text>
  <rect x="100" y="110" width="220" height="140" rx="10" fill="white" fill-opacity="0.02" stroke="${palette.accent2}" stroke-opacity="0.08" stroke-width="1"/>
  <circle cx="120" cy="130" r="5" fill="#ef4444" fill-opacity="0.4"/><circle cx="138" cy="130" r="5" fill="#f59e0b" fill-opacity="0.4"/><circle cx="156" cy="130" r="5" fill="#22c55e" fill-opacity="0.4"/>
  <text x="110" y="165" fill="white" fill-opacity="0.12" font-family="monospace" font-size="11">&lt;div className=&quot;app&quot;&gt;</text>
  <text x="110" y="182" fill="${palette.accent}" fill-opacity="0.15" font-family="monospace" font-size="11">  &lt;Header /&gt;</text>
  <text x="110" y="199" fill="${palette.accent2}" fill-opacity="0.12" font-family="monospace" font-size="11">  &lt;Content /&gt;</text>
  <text x="110" y="216" fill="white" fill-opacity="0.1" font-family="monospace" font-size="11">&lt;/div&gt;</text>
  <rect x="100" y="360" width="56" height="4" rx="2" fill="${palette.accent}" fill-opacity="0.8"/>
  <text x="100" y="420" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="58" font-weight="800" letter-spacing="-2">${line1}</text>
  ${line2 ? `<text x="100" y="490" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="58" font-weight="800" letter-spacing="-2">${line2}</text>` : ''}
  <text x="100" y="${line2 ? '545' : '475'}" fill="${palette.accent}" fill-opacity="0.6" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="600" letter-spacing="4" text-transform="uppercase">SHEKHARKASHYAP.COM</text>
  <rect x="0" y="870" width="1600" height="30" fill="${palette.accent}" fill-opacity="0.08"/>
  <rect x="0" y="870" width="600" height="30" fill="${palette.accent}" fill-opacity="0.15"/>
</svg>`;
        return Buffer.from(svg, 'utf-8');
    }

    // ─── Gemini helpers (image generation only) ─────────────────────────

    private async callGeminiWithRetry(url: string, payload: any, operation: string): Promise<any> {
        const maxRetries = Math.max(0, Number(process.env.GEMINI_MAX_RETRIES || 3));
        const baseDelayMs = Math.max(200, Number(process.env.GEMINI_RETRY_BASE_MS || 1500));
        const maxDelayMs = Math.max(baseDelayMs, Number(process.env.GEMINI_RETRY_MAX_MS || 15000));

        let lastError = '';

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) return res.json();

            const errorDetails = await this.extractGeminiError(res);
            lastError = `Gemini ${operation} failed with status ${res.status}${errorDetails ? `: ${errorDetails}` : ''}`;

            const retryable = res.status === 429 || res.status === 503 || res.status === 500;
            if (!retryable || attempt >= maxRetries) throw new Error(lastError);

            const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
            const delayMs = exponential + Math.floor(Math.random() * 250);
            this.logger.warn(`${lastError}. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
            await this.sleep(delayMs);
        }

        throw new Error(lastError || `Gemini ${operation} failed after retries`);
    }

    private async extractGeminiError(res: Response): Promise<string> {
        try {
            const body = await res.json() as any;
            return body?.error?.message || body?.message || '';
        } catch {
            try { return (await res.text()).slice(0, 240); } catch { return ''; }
        }
    }

    // ─── Shared utilities ───────────────────────────────────────────────

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private normalizeDraft(draft: Partial<GeneratedDraft>, plan: Agent0Plan): GeneratedDraft {
        const title = (draft.title || plan.topic || 'Technical Guide').trim();
        const content = (draft.content || '<h2>Overview</h2><p>Content generation failed. Please retry.</p>').trim();
        const excerpt = (draft.excerpt || `A practical guide to ${title}`).trim();

        return {
            title,
            slug: this.slugify(draft.slug || title),
            excerpt,
            content,
            seoKeywords: this.uniqueArray([...this.toArray(draft.seoKeywords), ...this.toArray(plan.keywords)]).slice(0, 14),
            tags: this.uniqueArray([...this.toArray(draft.tags), ...this.toArray(plan.tags)]).slice(0, 10),
            readingTime: draft.readingTime || '8 min read',
            metaDescription: (draft.metaDescription || excerpt).slice(0, 160),
            coverImagePrompt: draft.coverImagePrompt || `A stunning modern technical illustration for the topic "${title}". Feature visual metaphors like code editors, servers, data flow diagrams, and circuit patterns. Use a deep blue-to-purple gradient background with glowing cyan accents. Isometric 3D style, no text or watermarks.`,
        };
    }

    private async pickCategoryByRotation(categories: Array<{ name: string; slug: string; order?: number }>) {
        const state = await this.getOrCreateEditorialState(categories);
        const covered = new Set(state.coveredCategorySlugs || []);

        let uncovered = categories.filter((c) => !covered.has(c.slug));
        if (uncovered.length === 0) {
            state.cycleNumber = (state.cycleNumber || 1) + 1;
            state.coveredCategorySlugs = [];
            await state.save();
            uncovered = categories;
        }

        uncovered.sort((a, b) => {
            const aOrder = a.order || 0;
            const bOrder = b.order || 0;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return a.name.localeCompare(b.name);
        });

        return uncovered[0];
    }

    private async resolveOrCreateCategory(forceCategory: string, categories: Array<{ name: string; slug: string; order?: number }>) {
        const existing = categories.find((c) => c.name.toLowerCase() === forceCategory.toLowerCase() || c.slug === this.slugify(forceCategory));
        if (existing) return existing;

        const allow = (process.env.AI_ALLOW_CATEGORY_CREATE || 'false').toLowerCase() === 'true';
        if (!allow) {
            throw new Error(`Category ${forceCategory} does not exist and AI_ALLOW_CATEGORY_CREATE=false`);
        }

        return this.categoryService.create({
            name: forceCategory.trim(),
            slug: this.slugify(forceCategory),
            order: Math.max(0, ...categories.map((c) => c.order || 0)) + 1,
        });
    }

    private async getOrCreateEditorialState(categories: Array<{ slug: string }>): Promise<AiEditorialStateDocument> {
        const existing = await this.editorialStateModel.findOne({ key: 'global' }).exec();
        if (!existing) {
            return this.editorialStateModel.create({
                key: 'global',
                cycleNumber: 1,
                coveredCategorySlugs: [],
                lastCategorySlug: '',
                lastRunAt: null,
            });
        }

        const validSlugs = new Set(categories.map((c) => c.slug));
        const filtered = (existing.coveredCategorySlugs || []).filter((slug) => validSlugs.has(slug));
        if (filtered.length !== (existing.coveredCategorySlugs || []).length) {
            existing.coveredCategorySlugs = filtered;
            await existing.save();
        }
        return existing;
    }

    private async markCategoryCovered(categorySlug: string): Promise<void> {
        const categories = await this.categoryService.findAll();
        const state = await this.getOrCreateEditorialState(categories);
        const current = new Set(state.coveredCategorySlugs || []);
        current.add(categorySlug);
        state.coveredCategorySlugs = [...current];
        state.lastCategorySlug = categorySlug;
        state.lastRunAt = new Date();
        await state.save();
    }

    private async saveTopicHistory(runId: string, plan: Agent0Plan, title: string, blogId: string): Promise<void> {
        await this.topicHistoryModel.create({
            runId,
            categorySlug: plan.categorySlug,
            categoryName: plan.categoryName,
            topic: plan.topic,
            title,
            tags: plan.tags,
            keywords: plan.keywords,
            blogId,
        });
    }

    private maxSimilarityScore(content: string, corpus: string[]): number {
        if (!content) return 0;
        const sourceSet = this.tokenSet(content);
        if (sourceSet.size === 0) return 0;

        let max = 0;
        for (const other of corpus) {
            const targetSet = this.tokenSet(other || '');
            if (targetSet.size === 0) continue;
            const intersection = [...sourceSet].filter((t) => targetSet.has(t)).length;
            const union = new Set([...sourceSet, ...targetSet]).size || 1;
            max = Math.max(max, intersection / union);
        }
        return max;
    }

    private tokenSet(input: string): Set<string> {
        const tokens = input
            .toLowerCase()
            .replace(/<[^>]*>/g, ' ')
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length > 3);
        return new Set(tokens);
    }

    private slugify(input: string): string {
        return input
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 90) || `ai-post-${Date.now()}`;
    }

    private ensureSlugUnique(title: string, rawSlug?: string): string {
        return this.slugify(rawSlug || title);
    }

    private toArray(val: unknown): string[] {
        if (Array.isArray(val)) return val;
        if (typeof val === 'string' && val.trim()) return val.split(',').map(s => s.trim());
        return [];
    }

    private uniqueArray(items: unknown): string[] {
        return [...new Set(this.toArray(items).map(s => String(s || '').trim()).filter(Boolean))];
    }

    private escapeXml(input: string): string {
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    private async updateRun(id: string, patch: Partial<AiBlogRun>, log?: string): Promise<void> {
        const update: any = { ...patch };
        if (log) {
            update.$push = { logs: `[${new Date().toISOString()}] ${log}` };
        }
        await this.runModel.findByIdAndUpdate(id, update).exec();
    }

    private async failRun(id: string, error: string): Promise<void> {
        await this.runModel
            .findByIdAndUpdate(id, {
                status: 'failed',
                currentStep: 'failed',
                error,
                finishedAt: new Date(),
                $push: { logs: `[${new Date().toISOString()}] Failed: ${error}` },
            })
            .exec();
    }
}
