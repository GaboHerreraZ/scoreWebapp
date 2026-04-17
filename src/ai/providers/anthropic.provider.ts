import Anthropic from '@anthropic-ai/sdk';
import {
  AiProvider,
  AiCompletionResult,
} from './ai-provider.interface.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
};

export class AnthropicProvider implements AiProvider {
  readonly providerName = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateCompletion(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
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
    maxTokens: number,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();
    const pdfBase64 = pdfBuffer.toString('base64');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
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
