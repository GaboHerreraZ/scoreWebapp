import { Controller, Post, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ContactRequestsService } from './contact-requests.service.js';
import { CreateContactRequestDto } from './dto/create-contact-request.dto.js';
import { Public } from '../common/decorators/public.decorator.js';

/**
 * Endpoint PÚBLICO del formulario de contacto comercial. @Public() salta la
 * auth global; @Throttle limita los envíos por IP para evitar floods de spam.
 */
@ApiTags('Contact Sales')
@Controller('contact-sales')
export class ContactSalesController {
  constructor(private readonly service: ContactRequestsService) {}

  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600_000 } }) // 5 envíos por IP / 10 min
  @ApiOperation({
    summary: 'Enviar una solicitud de contacto comercial (público)',
  })
  @ApiResponse({ status: 201, description: '{ received: true, id }' })
  @ApiResponse({
    status: 429,
    description: 'Demasiadas solicitudes (rate limit)',
  })
  create(@Body() dto: CreateContactRequestDto, @Req() req: Request) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      undefined;
    const userAgent = req.headers['user-agent']?.slice(0, 500);
    return this.service.create(dto, { ipAddress, userAgent });
  }
}
