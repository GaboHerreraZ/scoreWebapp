import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface AiCompletionResult {
  content: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string;
  durationMs: number;
}

// Pricing per 1M tokens for Claude Haiku 4.5
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(private configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>(
        'ANTHROPIC_API_KEY',
        'sk-ant-placeholder',
      ),
    });
    this.model = this.configService.get<string>(
      'ANTHROPIC_MODEL',
      'claude-haiku-4-5-20251001',
    );
    this.maxTokens = Number(
      this.configService.get('ANTHROPIC_MAX_TOKENS', '1024'),
    );
  }

  async generateCompletion(
    systemPrompt: string,
    userMessage: string,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const durationMs = Date.now() - startTime;
    const textContent = response.content.find((block) => block.type === 'text');

    return {
      content: textContent?.text ?? null,
      promptTokens: response.usage?.input_tokens ?? null,
      completionTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage
        ? response.usage.input_tokens + response.usage.output_tokens
        : null,
      model: response.model,
      durationMs,
    };
  }

  async extractFromPdf(
    pdfBuffer: Buffer,
    extractionPrompt: string,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();
    const pdfBase64 = pdfBuffer.toString('base64');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: extractionPrompt,
            },
          ],
        },
      ],
    });

    const durationMs = Date.now() - startTime;
    const textContent = response.content.find((block) => block.type === 'text');

    return {
      content: textContent?.text ?? null,
      promptTokens: response.usage?.input_tokens ?? null,
      completionTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage
        ? response.usage.input_tokens + response.usage.output_tokens
        : null,
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
