import { PartialType } from '@nestjs/swagger';
import { CreateConsultationPriceDto } from './create-consultation-price.dto.js';

export class UpdateConsultationPriceDto extends PartialType(
  CreateConsultationPriceDto,
) {}
