import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../common/auth/admin.guard.js';
import {
  PlatformRoles,
  PlatformRolesGuard,
} from '../common/auth/platform-roles.guard.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { FeatureFlagsService } from './feature-flags.service.js';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto.js';

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

@ApiTags('Admin Portal')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/feature-flags')
export class FeatureFlagsAdminController {
  constructor(
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly platformAdminRepository: PlatformAdminRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar feature flags con su último cambio' })
  list() {
    return this.featureFlagsService.listForAdmin();
  }

  @Patch(':code')
  @PlatformRoles('admin')
  @UseGuards(PlatformRolesGuard)
  @ApiOperation({ summary: 'Encender/apagar un feature flag (solo admin)' })
  async toggle(
    @Param('code') code: string,
    @Body() dto: UpdateFeatureFlagDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const admin = req.user?.id
      ? await this.platformAdminRepository.findByUserIdWithRole(req.user.id)
      : null;
    return this.featureFlagsService.setEnabled(
      code,
      dto.enabled,
      admin?.id ?? null,
    );
  }
}
