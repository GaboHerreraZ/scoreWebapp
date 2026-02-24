import { PartialType } from '@nestjs/swagger';
import { CreateParameterDto } from './create-parameter.dto.js';

export class UpdateParameterDto extends PartialType(CreateParameterDto) {}
