import { PartialType } from '@nestjs/swagger';
import { CreateCreditStudyDto } from './create-credit-study.dto.js';

export class UpdateCreditStudyDto extends PartialType(CreateCreditStudyDto) {}
