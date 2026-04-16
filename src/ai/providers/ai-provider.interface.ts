export interface AiCompletionResult {
  content: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string;
  durationMs: number;
}

export interface AiProvider {
  readonly providerName: string;

  generateCompletion(
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
  ): Promise<AiCompletionResult>;

  extractFromPdf(
    pdfBuffer: Buffer,
    extractionPrompt: string,
    maxTokens: number,
  ): Promise<AiCompletionResult>;

  estimateCostUsd(
    model: string,
    promptTokens: number | null,
    completionTokens: number | null,
  ): number | null;
}
