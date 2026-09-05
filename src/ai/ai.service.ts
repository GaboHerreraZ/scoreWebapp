import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  AiCompletionResult,
} from './providers/ai-provider.interface.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { GeminiProvider } from './providers/gemini.provider.js';

export type { AiCompletionResult };

/**
 * Tipos de documento que se extraen. Cada uno tiene su propio perfil (modelo +
 * presupuesto de salida) porque la exigencia es distinta: un extracto bancario
 * es transcripción masiva —cientos de movimientos, poca aritmética— mientras
 * que un desprendible o unos EEFF son cortos pero sensibles al detalle.
 */
export const EXTRACTION_KINDS = [
  'financialStatements',
  'bankStatement',
  'payrollStub',
  'contractorInvoice',
] as const;

export type ExtractionKind = (typeof EXTRACTION_KINDS)[number];

interface ExtractionProfile {
  /** Modelo específico; si no se configura, el de extracción general. */
  model: string | undefined;
  maxTokens: number;
}

/** camelCase → SUFIJO_DE_ENV (bankStatement → BANK_STATEMENT). */
const envSuffix = (kind: ExtractionKind): string =>
  kind.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: AiProvider;
  private readonly maxTokens: number;
  private readonly maxTokensExtraction: number;
  private readonly extractionModel: string | undefined;
  private readonly extractionProfiles: Record<
    ExtractionKind,
    ExtractionProfile
  >;
  /** Clasificación consolidada de movimientos (una llamada con toda la ventana). */
  private readonly classificationModel: string | undefined;
  private readonly maxTokensClassification: number;
  /** Providers instanciados bajo demanda para el routing por modelo. */
  private readonly providersByName = new Map<string, AiProvider>();

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

    // Perfil por tipo de documento: AI_EXTRACTION_MODEL_<TIPO> y
    // AI_MAX_TOKENS_<TIPO> (p. ej. AI_EXTRACTION_MODEL_BANK_STATEMENT). Lo que
    // no se configure cae a los valores generales de extracción.
    this.extractionProfiles = EXTRACTION_KINDS.reduce(
      (profiles, kind) => {
        const suffix = envSuffix(kind);
        const maxTokens = Number(
          this.configService.get(
            `AI_MAX_TOKENS_${suffix}`,
            String(this.maxTokensExtraction),
          ),
        );
        profiles[kind] = {
          model:
            this.configService.get<string>(`AI_EXTRACTION_MODEL_${suffix}`) ??
            this.extractionModel,
          maxTokens: Number.isFinite(maxTokens)
            ? maxTokens
            : this.maxTokensExtraction,
        };
        return profiles;
      },
      {} as Record<ExtractionKind, ExtractionProfile>,
    );

    this.classificationModel = this.configService.get<string>(
      'AI_CLASSIFICATION_MODEL',
    );
    const maxTokensClassification = Number(
      this.configService.get(
        'AI_MAX_TOKENS_CLASSIFICATION',
        String(this.maxTokensExtraction),
      ),
    );
    this.maxTokensClassification = Number.isFinite(maxTokensClassification)
      ? maxTokensClassification
      : this.maxTokensExtraction;

    this.provider = this.createProvider(aiProvider);
    this.providersByName.set(this.provider.providerName, this.provider);
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

  /**
   * Provider que corresponde a un modelo. El proveedor global (AI_PROVIDER)
   * sigue siendo el default, pero un override tipo `claude-*` o `gemini-*`
   * enruta a su casa aunque el default sea el otro — así se puede migrar SOLO
   * la extracción de extractos a Claude sin mover el resto. Instancias creadas
   * bajo demanda y reutilizadas (el SDK mantiene el pool HTTP).
   */
  private providerFor(model: string | undefined): AiProvider {
    if (!model) return this.provider;
    const name = model.startsWith('claude')
      ? 'anthropic'
      : model.startsWith('gemini')
        ? 'gemini'
        : null;
    if (!name || name === this.provider.providerName) return this.provider;
    let provider = this.providersByName.get(name);
    if (!provider) {
      provider = this.createProvider(name);
      this.providersByName.set(name, provider);
    }
    return provider;
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

  /**
   * Clasificación consolidada de movimientos: recibe TODOS los meses en una
   * sola llamada para que un único criterio decida qué es ingreso, traslado
   * propio o gasto. Modelo y presupuesto propios (AI_CLASSIFICATION_MODEL /
   * AI_MAX_TOKENS_CLASSIFICATION); sin configurar caen a los de extracción.
   */
  async classifyMovements(
    systemPrompt: string,
    userMessage: string,
  ): Promise<AiCompletionResult> {
    const model = this.classificationModel ?? this.extractionModel;
    return this.providerFor(model).generateCompletion(
      systemPrompt,
      userMessage,
      this.maxTokensClassification,
      model,
    );
  }

  /**
   * Extracción de un PDF con el perfil del tipo de documento indicado (modelo y
   * presupuesto de salida). Sin `kind` usa la configuración general.
   */
  async extractFromPdf(
    pdfBuffer: Buffer,
    extractionPrompt: string,
    kind?: ExtractionKind,
  ): Promise<AiCompletionResult> {
    const profile = kind ? this.extractionProfiles[kind] : null;
    const model = profile?.model ?? this.extractionModel;
    return this.providerFor(model).extractFromPdf(
      pdfBuffer,
      extractionPrompt,
      profile?.maxTokens ?? this.maxTokensExtraction,
      model,
    );
  }

  estimateCostUsd(
    model: string,
    promptTokens: number | null,
    completionTokens: number | null,
  ): number | null {
    // El costo se estima con el provider dueño del modelo (tablas de precios
    // distintas); providerFor cae al default cuando el modelo no dice de quién es.
    return this.providerFor(model).estimateCostUsd(
      model,
      promptTokens,
      completionTokens,
    );
  }
}
