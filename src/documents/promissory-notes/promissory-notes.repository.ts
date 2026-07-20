import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class PromissoryNotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.PromissoryNoteUncheckedCreateInput) {
    return this.prisma.promissoryNote.create({
      data,
      include: {
        status: true,
        customer: { select: { id: true, businessName: true, email: true } },
      },
    });
  }

  async findById(id: number, companyId: string) {
    return this.prisma.promissoryNote.findFirst({
      where: { id, companyId },
      include: {
        status: true,
        customer: {
          select: {
            id: true,
            businessName: true,
            email: true,
            identificationNumber: true,
          },
        },
        creditStudy: {
          select: { id: true, studyDate: true },
        },
      },
    });
  }

  async findAll(params: {
    skip: number;
    take: number;
    where?: Prisma.PromissoryNoteWhereInput;
    orderBy?: Prisma.PromissoryNoteOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;

    const [data, total] = await Promise.all([
      this.prisma.promissoryNote.findMany({
        skip,
        take,
        where,
        orderBy,
        include: {
          status: true,
          customer: { select: { id: true, businessName: true } },
        },
      }),
      this.prisma.promissoryNote.count({ where }),
    ]);

    return { data, total };
  }

  async update(id: number, data: Prisma.PromissoryNoteUncheckedUpdateInput) {
    return this.prisma.promissoryNote.update({
      where: { id },
      data,
      include: { status: true },
    });
  }

  /** Localiza un pagaré por el token del documento del proveedor de firma. */
  findByDocToken(providerDocToken: string) {
    return this.prisma.promissoryNote.findUnique({
      where: { providerDocToken },
    });
  }

  /**
   * Siguiente consecutivo de pagaré para una empresa. La unicidad real la
   * garantiza el unique (companyId, noteNumber): ante una emisión concurrente
   * el create falla con P2002 y el service reintenta con el número recalculado.
   */
  async nextNoteNumber(companyId: string): Promise<number> {
    const agg = await this.prisma.promissoryNote.aggregate({
      where: { companyId },
      _max: { noteNumber: true },
    });
    return (agg._max.noteNumber ?? 0) + 1;
  }

  /** Elimina la fila (rollback cuando el proveedor de firma falla al emitir). */
  delete(id: number) {
    return this.prisma.promissoryNote.delete({ where: { id } });
  }

  /**
   * Marca el pagaré como firmado de forma atómica (claim por transición): solo
   * si aún NO estaba firmado. Devuelve true si esta llamada fue la que lo firmó
   * (evita reprocesar webhooks duplicados de doc_signed).
   */
  async markSigned(params: {
    id: number;
    signedStatusId: number;
    signedFileStoragePath: string | null;
    signedDocumentUrl: string | null;
    signedAt: Date;
  }): Promise<boolean> {
    const claimed = await this.prisma.promissoryNote.updateMany({
      where: { id: params.id, signedAt: null },
      data: {
        statusId: params.signedStatusId,
        signedAt: params.signedAt,
        signedFileStoragePath: params.signedFileStoragePath,
        signedDocumentUrl: params.signedDocumentUrl,
      },
    });
    return claimed.count > 0;
  }

  async countActiveByCreditStudy(creditStudyId: string): Promise<number> {
    const pendingStatus = await this.prisma.parameter.findUnique({
      where: {
        type_code: {
          type: 'promissory_note_status',
          code: 'pendingSignature',
        },
      },
    });
    const signedStatus = await this.prisma.parameter.findUnique({
      where: {
        type_code: { type: 'promissory_note_status', code: 'signed' },
      },
    });

    const activeStatusIds = [pendingStatus?.id, signedStatus?.id].filter(
      (v): v is number => typeof v === 'number',
    );

    return this.prisma.promissoryNote.count({
      where: {
        creditStudyId,
        statusId: { in: activeStatusIds },
      },
    });
  }
}
