import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  AiCompletionResult,
} from './providers/ai-provider.interface.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { GeminiProvider } from './providers/gemini.provider.js';

export type { AiCompletionResult };

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: AiProvider;
  private readonly maxTokens: number;
  private readonly maxTokensExtraction: number;
  private readonly extractionModel: string | undefined;

  constructor(private configService: ConfigService) {
    const aiProvider = this.configService.get<string>(
      'AI_PROVIDER',
      'anthropic',
    );
    // Modelo opcional especifico para la extraccion de PDF. Permite usar un
    // modelo mas capaz (ej. gemini-2.5-pro) solo en la extraccion, que es
    // sensible a errores aritmeticos en las red flags, sin encarecer el
    // analisis narrativo. Si no se define, se usa el modelo por defecto.
    this.extractionModel = this.configService.get<string>(
      'AI_EXTRACTION_MODEL',
    );
    // Limite de salida para el analisis narrativo del estudio (respuesta corta).
    this.maxTokens = Number(this.configService.get('AI_MAX_TOKENS', '4096'));
    // Limite de salida para la extraccion de PDF: ademas de los datos
    // financieros devuelve red flags de fiabilidad, por lo que necesita mas
    // espacio de salida. Si no se configura, cae al valor general.
    this.maxTokensExtraction = Number(
      this.configService.get(
        'AI_MAX_TOKENS_EXTRACTION',
        String(this.maxTokens),
      ),
    );

    this.provider = this.createProvider(aiProvider);
    this.logger.log(`AI provider initialized: ${this.provider.providerName}`);
  }

  private createProvider(provider: string): AiProvider {
    switch (provider) {
      case 'gemini':
        return new GeminiProvider(
          this.configService.get<string>('GEMINI_API_KEY', ''),
          this.configService.get<string>('GEMINI_MODEL', 'gemini-2.5-flash'),
        );
      case 'anthropic':
      default:
        return new AnthropicProvider(
          this.configService.get<string>(
            'ANTHROPIC_API_KEY',
            'sk-ant-placeholder',
          ),
          this.configService.get<string>(
            'ANTHROPIC_MODEL',
            'claude-haiku-4-5-20251001',
          ),
        );
    }
  }

  async generateCompletion(
    systemPrompt: string,
    userMessage: string,
  ): Promise<AiCompletionResult> {
    return this.provider.generateCompletion(
      systemPrompt,
      userMessage,
      this.maxTokens,
    );
  }

  async extractFromPdf(
    pdfBuffer: Buffer,
    extractionPrompt: string,
  ): Promise<AiCompletionResult> {
    return this.provider.extractFromPdf(
      pdfBuffer,
      extractionPrompt,
      this.maxTokensExtraction,
      this.extractionModel,
    );
  }

  estimateCostUsd(
    model: string,
    promptTokens: number | null,
    completionTokens: number | null,
  ): number | null {
    return this.provider.estimateCostUsd(model, promptTokens, completionTokens);
  }
}
