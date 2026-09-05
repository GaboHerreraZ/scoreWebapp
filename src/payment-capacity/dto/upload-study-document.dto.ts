import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  STUDY_DOCUMENT_TYPES,
  type StudyDocumentTypeCode,
} from '../extraction/extraction.types.js';

/** Llega como multipart/form-data junto al PDF del documento. */
export class UploadStudyDocumentDto {
  @ApiProperty({
    enum: STUDY_DOCUMENT_TYPES,
    example: 'bankStatement',
    description:
      'Tipo de documento (Parameter study_document_type): extracto bancario, desprendible de nómina o factura de contratista.',
  })
  @IsIn(STUDY_DOCUMENT_TYPES)
  documentTypeCode: StudyDocumentTypeCode;
}
