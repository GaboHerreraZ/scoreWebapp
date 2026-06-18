import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { OnboardingService } from './onboarding.service.js';
import { OnboardingDto } from './dto/onboarding.dto.js';

@ApiTags('Onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post()
  @ApiOperation({
    summary:
      'Alta del cliente: crea Profile + Company + facturación (atómico). El pago del pack es un paso posterior.',
  })
  @ApiResponse({
    status: 201,
    description: 'profileId, companyId y userCompanyId creados',
  })
  @ApiResponse({ status: 409, description: 'El NIT ya existe' })
  onboard(@Body() dto: OnboardingDto, @Req() req: Request) {
    const userId = (req as any).user.id as string;
    const email = (req as any).user.email as string;
    return this.onboardingService.onboard(userId, email, dto);
  }

  @Get(':profileId')
  @ApiOperation({
    summary:
      'Data de onboarding guardada (profile + company + billing) de un perfil, para reintentar el pago sin reingresar datos.',
  })
  @ApiResponse({
    status: 200,
    description: 'profileId, companyId, profile, company y billing',
  })
  @ApiResponse({ status: 404, description: 'Perfil o empresa no encontrados' })
  getOnboardingData(@Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.onboardingService.getOnboardingData(profileId);
  }
}
