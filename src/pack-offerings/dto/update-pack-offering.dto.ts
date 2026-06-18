import { PartialType } from '@nestjs/swagger';
import { CreatePackOfferingDto } from './create-pack-offering.dto.js';

export class UpdatePackOfferingDto extends PartialType(CreatePackOfferingDto) {}
