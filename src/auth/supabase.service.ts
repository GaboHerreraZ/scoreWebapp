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
}
