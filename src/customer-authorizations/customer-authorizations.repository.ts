import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * Acceso a datos de CustomerAuthorization. La autorización se llavea por
 * IDENTIDAD (companyId + identificationNumber + typeId), la misma llave natural
 * que Customer, porque existe ANTES de que el Customer exista (el Customer nace
 * de la consulta al bureau, que requiere esta firma).
 */
@Injectable()
export class CustomerAuthorizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Autorización de un tipo (por code de type) para una identidad. */
  findByIdentity(params: {
    companyId: string;
    identificationNumber: string;
    typeId: number;
  }) {
    return this.prisma.customerAuthorization.findUnique({
      where: {
        companyId_identificationNumber_typeId: {
          companyId: params.companyId,
          identificationNumber: params.identificationNumber,
          typeId: params.typeId,
        },
      },
      include: { status: true, type: true, identificationType: true },
    });
  }

  findByDocToken(zapsignDocToken: string) {
    return this.prisma.customerAuthorization.findUnique({
      where: { zapsignDocToken },
      include: { company: true },
    });
  }

  create(data: Prisma.CustomerAuthorizationUncheckedCreateInput) {
    return this.prisma.customerAuthorization.create({ data });
  }

  update(id: string, data: Prisma.CustomerAuthorizationUncheckedUpdateInput) {
    return this.prisma.customerAuthorization.update({ where: { id }, data });
  }

  findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findUnique({
      where: { type_code: { type, code } },
    });
  }

  /**
   * Marca la autorización como firmada de forma atómica (claim por transición):
   * pasa a 'signed' solo si aún NO estaba firmada. Devuelve true si esta llamada
   * fue la que la firmó (evita reprocesar webhooks duplicados de doc_signed).
   */
  async markSigned(params: {
    authorizationId: string;
    signedStatusId: number;
    signedFileStoragePath: string | null;
    signedDocumentUrl: string | null;
    signedAt: Date;
  }): Promise<boolean> {
    const claimed = await this.prisma.customerAuthorization.updateMany({
      where: { id: params.authorizationId, signedAt: null },
      data: {
        statusId: params.signedStatusId,
        signedAt: params.signedAt,
        signedFileStoragePath: params.signedFileStoragePath,
        signedDocumentUrl: params.signedDocumentUrl,
      },
    });
    return claimed.count > 0;
  }

  /**
   * Enlaza (backfill) la autorización firmada con el Customer que nació de la
   * consulta. Best-effort: solo si aún no tenía customerId, sin pisar nada más.
   */
  async linkCustomer(params: {
    companyId: string;
    identificationNumber: string;
    customerId: string;
  }): Promise<void> {
    await this.prisma.customerAuthorization.updateMany({
      where: {
        companyId: params.companyId,
        identificationNumber: params.identificationNumber,
        customerId: null,
      },
      data: { customerId: params.customerId },
    });
  }
}
