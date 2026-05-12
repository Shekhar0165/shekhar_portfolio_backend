import { Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';

interface GroqCallOptions {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
}

@Injectable()
export class GroqLlmService {
    private readonly logger = new Logger(GroqLlmService.name);
    private client: Groq | null = null;
    private dailyTokensUsed = 0;
    private lastResetDate = '';

    private getClient(): Groq {
        if (!this.client) {
            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey) throw new Error('GROQ_API_KEY is not configured');
            this.client = new Groq({ apiKey });
        }
        return this.client;
    }

    private resetDailyCounterIfNeeded(): void {
        const today = new Date().toISOString().slice(0, 10);
        if (today !== this.lastResetDate) {
            this.dailyTokensUsed = 0;
            this.lastResetDate = today;
        }
    }

    get tokensUsedToday(): number {
        this.resetDailyCounterIfNeeded();
        return this.dailyTokensUsed;
    }

    get isWithinFreeLimit(): boolean {
        return this.tokensUsedToday < 90_000;
    }

    async callGroqJson<T>(prompt: string, options: GroqCallOptions = {}): Promise<T> {
        const text = await this.callGroqText(prompt, options);
        if (!text) throw new Error('Groq response was empty');

        try {
            return JSON.parse(text) as T;
        } catch {
            const cleaned = text
                .replace(/^```json\s*/i, '')
                .replace(/```$/i, '')
                .trim();
            return JSON.parse(cleaned) as T;
        }
    }

    async callGroqText(prompt: string, options: GroqCallOptions = {}): Promise<string> {
        this.resetDailyCounterIfNeeded();

        const maxRetries = Math.max(0, Number(process.env.GROQ_MAX_RETRIES || 3));
        const baseDelayMs = Math.max(500, Number(process.env.GROQ_RETRY_BASE_MS || 2000));
        const primaryModel = process.env.GROQ_MODEL || 'meta-llama/llama-4-maverick-17b-128e-instruct';
        const fallbackModel = process.env.GROQ_FALLBACK_MODEL || 'meta-llama/llama-3.3-70b-versatile';

        const models = [primaryModel, fallbackModel];
        let lastError = '';

        for (const model of models) {
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const messages: Groq.Chat.ChatCompletionMessageParam[] = [];

                    if (options.systemPrompt) {
                        messages.push({ role: 'system', content: options.systemPrompt });
                    }
                    messages.push({ role: 'user', content: prompt });

                    const response = await this.getClient().chat.completions.create({
                        model,
                        messages,
                        temperature: options.temperature ?? 0.7,
                        max_tokens: options.maxTokens ?? 8192,
                        response_format: { type: 'json_object' },
                    });

                    const usage = response.usage;
                    if (usage) {
                        this.dailyTokensUsed += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
                    }

                    const text = response.choices?.[0]?.message?.content || '';
                    if (!text) throw new Error('Groq returned empty content');

                    this.logger.debug(
                        `Groq [${model}] tokens: ${usage?.total_tokens || 0}, daily total: ${this.dailyTokensUsed}`,
                    );
                    return text;
                } catch (error: any) {
                    const status = error?.status || error?.statusCode || 0;
                    lastError = `Groq [${model}] attempt ${attempt + 1} failed (status ${status}): ${error?.message || error}`;
                    this.logger.warn(lastError);

                    const retryable = status === 429 || status === 503 || status === 500;
                    if (!retryable || attempt >= maxRetries) break;

                    const delayMs = Math.min(15000, baseDelayMs * 2 ** attempt + Math.random() * 500);
                    this.logger.warn(`Retrying in ${Math.round(delayMs)}ms...`);
                    await this.sleep(delayMs);
                }
            }
            this.logger.warn(`All retries exhausted for model ${model}, trying fallback...`);
        }

        throw new Error(lastError || 'Groq call failed after all retries and model fallbacks');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
