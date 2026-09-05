import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

// Select del listado: NUNCA incluye extractedData (los movimientos de un
// extracto pesan cientos de KB); el resumen chico vive en `summary`.
const DOCUMENT_LIST_SELECT = {
  id: true,
  documentType: { select: { id: true, code: true, label: true } },
  fileName: true,
  fileSizeBytes: true,
  extractionStatus: true,
  extractionError: true,
  summary: true,
  extractionFlags: true,
  validationResults: true,
  periodFrom: true,
  periodTo: true,
  accountLast4: true,
  createdAt: true,
} as const;

@Injectable()
export class StudyDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** El estudio con lo mínimo para validar un upload/listado de documentos. */
  async findStudyForDocuments(creditStudyId: string, companyId: string) {
    return this.prisma.creditStudy.findFirst({
      where: { id: creditStudyId, companyId },
      select: {
        id: true,
        companyId: true,
        customerId: true,
        statusId: true,
        viabilityScore: true,
        requestedTerm: true,
        requestedCreditLine: true,
        declaredEmploymentStartDate: true,
        status: { select: { id: true, code: true } },
        studyType: { select: { code: true } },
        employmentType: { select: { code: true } },
        customer: {
          select: {
            id: true,
            businessName: true,
            identificationNumber: true,
          },
        },
      },
    });
  }

  async create(data: Prisma.StudyDocumentUncheckedCreateInput) {
    return this.prisma.studyDocument.create({ data });
  }

  async update(id: string, data: Prisma.StudyDocumentUncheckedUpdateInput) {
    return this.prisma.studyDocument.update({
      where: { id },
      data,
      select: DOCUMENT_LIST_SELECT,
    });
  }

  /** Documentos del estudio para el listado/steps (sin extractedData). */
  async findByStudy(creditStudyId: string) {
    return this.prisma.studyDocument.findMany({
      where: { creditStudyId },
      orderBy: { createdAt: 'asc' },
      select: DOCUMENT_LIST_SELECT,
    });
  }

  /** Documentos con la extracción completa (solo para el perform). */
  async findByStudyWithExtraction(creditStudyId: string) {
    return this.prisma.studyDocument.findMany({
      where: { creditStudyId, extractionStatus: 'success' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        documentType: { select: { code: true } },
        fileName: true,
        extractedData: true,
        extractionFlags: true,
        validationResults: true,
        periodFrom: true,
        periodTo: true,
        accountLast4: true,
      },
    });
  }

  async findOne(documentId: string, creditStudyId: string, companyId: string) {
    return this.prisma.studyDocument.findFirst({
      where: { id: documentId, creditStudyId, companyId },
      select: {
        ...DOCUMENT_LIST_SELECT,
        storagePath: true,
        creditStudyId: true,
      },
    });
  }

  async delete(id: string) {
    return this.prisma.studyDocument.delete({ where: { id } });
  }

  /** Conteo de documentos EXITOSOS o pendientes por tipo (para cardinalidad). */
  async countByType(creditStudyId: string) {
    const rows = await this.prisma.studyDocument.groupBy({
      by: ['documentTypeId'],
      where: { creditStudyId, extractionStatus: { not: 'error' } },
      _count: { _all: true },
    });
    return rows;
  }

  async updateStudyStatus(creditStudyId: string, statusId: number) {
    return this.prisma.creditStudy.update({
      where: { id: creditStudyId },
      data: { statusId },
    });
  }
}
