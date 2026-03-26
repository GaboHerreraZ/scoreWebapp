import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface AiCompletionResult {
  content: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string;
  durationMs: number;
}

// Pricing per 1M tokens for gpt-4o-mini (as of 2025)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(private configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.get<string>(
        'OPENAI_API_KEY',
        'sk-placeholder',
      ),
    });
    this.model = this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    this.maxTokens = Number(this.configService.get('OPENAI_MAX_TOKENS', '1024'));
  }

  async generateCompletion(
    systemPrompt: string,
    userMessage: string,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    const durationMs = Date.now() - startTime;
    const usage = response.usage;

    return {
      content: response.choices[0]?.message?.content ?? null,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      model: response.model,
      durationMs,
    };
  }

  estimateCostUsd(
    model: string,
    promptTokens: number | null,
    completionTokens: number | null,
  ): number | null {
    if (promptTokens == null || completionTokens == null) return null;

    const pricing = MODEL_PRICING[model];
    if (!pricing) return null;

    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  }
}
