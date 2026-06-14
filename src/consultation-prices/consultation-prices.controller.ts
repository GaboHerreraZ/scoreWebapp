import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ConsultationPricesService } from './consultation-prices.service.js';
import { UpdateConsultationPriceDto } from './dto/update-consultation-price.dto.js';
import { FilterConsultationPriceDto } from './dto/filter-consultation-price.dto.js';
import { AdminOnly } from '../common/decorators/admin-only.decorator.js';

@ApiTags('Consultation Prices')
@ApiBearerAuth()
@AdminOnly()
@Controller('consultation-prices')
export class ConsultationPricesController {
  constructor(private readonly service: ConsultationPricesService) {}

  @Get()
  @ApiOperation({ summary: 'List consultation prices (paginated)' })
  @ApiResponse({ status: 200, description: 'List of consultation prices' })
  findAll(@Query() filters: FilterConsultationPriceDto) {
    return this.service.findAll(filters);
  }

  @Get('active')
  @ApiOperation({ summary: 'Get the currently active consultation price' })
  @ApiResponse({
    status: 200,
    description: 'Active consultation price (or null)',
  })
  findActive() {
    return this.service.getActivePrice();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a consultation price by ID' })
  @ApiResponse({ status: 200, description: 'Consultation price found' })
  @ApiResponse({ status: 404, description: 'Consultation price not found' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a consultation price' })
  @ApiResponse({ status: 200, description: 'Consultation price updated' })
  @ApiResponse({ status: 404, description: 'Consultation price not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConsultationPriceDto,
    @Req() req: Request,
  ) {
    const userId = (req as any).user.id as string;
    return this.service.update(id, dto, userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a consultation price' })
  @ApiResponse({ status: 204, description: 'Consultation price deleted' })
  @ApiResponse({ status: 404, description: 'Consultation price not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete: used by existing subscriptions',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
