import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly client: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    this.client = createClient(
      this.configService.get<string>('SUPABASE_URL')!,
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY')!,
    );
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Crea un usuario en Supabase Auth con email + password, dando el correo por
   * confirmado (email_confirm: true) para que pueda hacer login de inmediato.
   * Devuelve el id del usuario creado. Usa la service-role key (admin API).
   */
  async createUser(email: string, password: string): Promise<string> {
    const { data, error } = await this.client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      this.logger.error(
        `Supabase createUser failed: ${error?.message ?? 'unknown error'}`,
      );
      throw new InternalServerErrorException(
        `No se pudo crear el usuario en Supabase: ${error?.message ?? 'error desconocido'}`,
      );
    }
    return data.user.id;
  }

  /**
   * Elimina un usuario de Supabase Auth (usado para rollback si falla un paso
   * posterior). Best-effort: loguea pero no lanza, para no enmascarar el error
   * original que disparó el rollback.
   */
  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.client.auth.admin.deleteUser(userId);
    if (error) {
      this.logger.error(
        `Supabase deleteUser (rollback) failed for ${userId}: ${error.message}`,
      );
    }
  }

  /**
   * Uploads a file buffer to the given Supabase Storage bucket and returns the storage path.
   * Creates an `upsert` upload so re-uploads with the same path overwrite the existing file.
   */
  async uploadFile(
    bucket: string,
    path: string,
    file: Buffer,
    contentType: string,
  ): Promise<string> {
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, file, {
        contentType,
        upsert: true,
      });

    if (error) {
      this.logger.error(`Supabase Storage upload failed: ${error.message}`);
      throw new InternalServerErrorException(
        `Failed to upload file to storage: ${error.message}`,
      );
    }

    return path;
  }

  /**
   * Creates a short-lived signed URL for private files in Supabase Storage.
   */
  async createSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data) {
      this.logger.error(
        `Supabase Storage signed URL failed: ${error?.message ?? 'unknown error'}`,
      );
      throw new InternalServerErrorException(
        `Failed to create signed URL: ${error?.message ?? 'unknown error'}`,
      );
    }

    return data.signedUrl;
  }

  /**
   * Returns the permanent public URL for a file in a PUBLIC Supabase Storage
   * bucket (no signing, no expiry). Use only for buckets created as public.
   */
  getPublicUrl(bucket: string, path: string): string {
    const { data } = this.client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}
