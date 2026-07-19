import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service.js';
import { SupabaseJwtService } from './supabase-jwt.service.js';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard.js';

@Global()
@Module({
  providers: [SupabaseService, SupabaseJwtService, SupabaseAuthGuard],
  exports: [SupabaseService, SupabaseJwtService, SupabaseAuthGuard],
})
export class AuthModule {}
