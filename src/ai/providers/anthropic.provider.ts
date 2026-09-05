import Anthropic from '@anthropic-ai/sdk';
import { AiProvider, AiCompletionResult } from './ai-provider.interface.js';

/** USD por millón de tokens. Se busca por PREFIJO: la API puede devolver el
 *  alias tal cual o un id con sufijo de fecha, y ambos deben tarificar. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5.0, output: 25.0 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

const pricingFor = (model: string) => {
  const key = Object.keys(MODEL_PRICING)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? MODEL_PRICING[key] : undefined;
};

export class AnthropicProvider implements AiProvider {
  readonly providerName = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  /** Streaming obligatorio: con max_tokens grandes el SDK rechaza llamadas
   *  no-streaming que podrían pasar de 10 min. finalMessage() acumula la
   *  respuesta completa (mismo shape que la llamada no-streaming). */
  private async streamMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
    startTime: number,
  ): Promise<AiCompletionResult> {
    const response = await this.client.messages
      .stream(params)
      .finalMessage();

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
      truncated: response.stop_reason === 'max_tokens',
    };
  }

  async generateCompletion(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    modelOverride?: string,
  ): Promise<AiCompletionResult> {
    return this.streamMessage(
      {
        model: modelOverride || this.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
      Date.now(),
    );
  }

  async extractFromPdf(
    pdfBuffer: Buffer,
    extractionPrompt: string,
    maxTokens: number,
    modelOverride?: string,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();
    const pdfBase64 = pdfBuffer.toString('base64');

    return this.streamMessage(
      {
        model: modelOverride || this.model,
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
      },
      startTime,
    );
  }

  estimateCostUsd(
    model: string,
    promptTokens: number | null,
    completionTokens: number | null,
  ): number | null {
    if (promptTokens == null || completionTokens == null) return null;

    const pricing = pricingFor(model);
    if (!pricing) return null;

    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  }
}
