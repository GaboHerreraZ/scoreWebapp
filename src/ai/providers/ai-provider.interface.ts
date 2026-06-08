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
    // Modelo opcional especifico para la extraccion de PDF. Si se omite, el
    // provider usa su modelo por defecto. Permite usar un modelo mas capaz
    // (ej. gemini-2.5-pro) solo en la extraccion sin afectar el analisis.
    model?: string,
  ): Promise<AiCompletionResult>;

  estimateCostUsd(
    model: string,
    promptTokens: number | null,
    completionTokens: number | null,
  ): number | null;
}
