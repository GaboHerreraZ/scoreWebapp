import sharp from 'sharp';
import type { SupabaseService } from '../../auth/supabase.service.js';
import { PLATFORM_ADMIN_AVATAR_BUCKET } from '../constants/storage-buckets.js';

/** Lado del cuadrado al que se normaliza toda foto de perfil. */
const AVATAR_SIZE_PX = 256;

/**
 * En BD el avatar se guarda como path del bucket ({id}/avatar.webp); el front
 * lo pinta directo en un <img>, así que la API devuelve la URL pública.
 */
export function resolveAvatarUrl(
  supabase: SupabaseService,
  avatarUrl: string | null,
): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http')) return avatarUrl; // ya viene completa
  return supabase.getPublicUrl(PLATFORM_ADMIN_AVATAR_BUCKET, avatarUrl);
}

/**
 * Recorta la foto a un cuadrado de 256px y la comprime a webp: se muestra a
 * ~44px, así que subir el original (MBs) solo penaliza la carga del blog.
 */
export async function normalizeAvatar(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate() // aplica la orientación EXIF antes de recortar
    .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();
}
