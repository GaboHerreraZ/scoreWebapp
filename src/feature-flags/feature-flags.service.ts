import { Injectable, NotFoundException } from '@nestjs/common';
import { FeatureFlagsRepository } from './feature-flags.repository.js';
import {
  FEATURE_FLAG_CODES,
  type FeatureFlagCode,
} from './feature-flags.constants.js';

/** TTL del caché en memoria: apagar un flag tarda a lo sumo esto en propagar. */
const CACHE_TTL_MS = 60_000;

@Injectable()
export class FeatureFlagsService {
  private cache: Map<string, boolean> | null = null;
  private cacheLoadedAt = 0;

  constructor(private readonly repository: FeatureFlagsRepository) {}

  /** Flag sin fila → false: lo seguro es apagado. */
  async isEnabled(code: FeatureFlagCode): Promise<boolean> {
    const flags = await this.loadCache();
    return flags.get(code) ?? false;
  }

  /** Mapa {code: enabled} para el front (esconde UI; la autoridad es el API). */
  async getPublicFlags(): Promise<Record<string, boolean>> {
    const flags = await this.loadCache();
    return Object.fromEntries(
      FEATURE_FLAG_CODES.map((code) => [code, flags.get(code) ?? false]),
    );
  }

  listForAdmin() {
    return this.repository.findAllWithAdmin();
  }

  async setEnabled(code: string, enabled: boolean, adminId: string | null) {
    if (!(FEATURE_FLAG_CODES as readonly string[]).includes(code)) {
      throw new NotFoundException(`Feature flag '${code}' no existe.`);
    }
    const updated = await this.repository.setEnabled(code, enabled, adminId);
    this.invalidateCache();
    return updated;
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheLoadedAt = 0;
  }

  private async loadCache(): Promise<Map<string, boolean>> {
    if (this.cache && Date.now() - this.cacheLoadedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    const rows = await this.repository.findAll();
    this.cache = new Map(rows.map((r) => [r.code, r.enabled]));
    this.cacheLoadedAt = Date.now();
    return this.cache;
  }
}
