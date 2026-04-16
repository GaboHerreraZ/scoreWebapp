import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  AiProvider,
  AiCompletionResult,
} from './ai-provider.interface.js';

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash-lite': { input: 0.025, output: 0.1 },
};

export class GeminiProvider implements AiProvider {
  readonly providerName = 'gemini';
  private readonly client: GoogleGenerativeAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async generateCompletion(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
  ): Promise<AiCompletionResult> {
    const startTime = Date.now();

    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: maxTokens,
        // @ts-expect-error -- thinkingConfig not yet in SDK types
        thinkingConfig: { thinkingBudget: 1024 },
      },
    });

    const result = await model.generateContent(userMessage);
    const response = result.response;
    const durationMs = Date.now() - startTime;

    const promptTokens =
      response.usageMetadata?.promptTokenCount ?? null;
    const completionTokens =
      response.usageMetadata?.candidatesTokenCount ?? null;

    return {
      content: response.text() ?? null,
      promptTokens,
      completionTokens,
      totalTokens:
        promptTokens != null && completionTokens != null
          ? promptTokens + completionTokens
          : null,
      model: this.model,
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

    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        maxOutputTokens: maxTokens,
        // @ts-expect-error -- thinkingConfig not yet in SDK types
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64,
        },
      },
      { text: extractionPrompt },
    ]);

    const response = result.response;
    const durationMs = Date.now() - startTime;

    const promptTokens =
      response.usageMetadata?.promptTokenCount ?? null;
    const completionTokens =
      response.usageMetadata?.candidatesTokenCount ?? null;

    return {
      content: response.text() ?? null,
      promptTokens,
      completionTokens,
      totalTokens:
        promptTokens != null && completionTokens != null
          ? promptTokens + completionTokens
          : null,
      model: this.model,
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
