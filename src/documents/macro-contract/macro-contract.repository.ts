import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';

@Injectable()
export class MacroContractRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCompanyId(companyId: string) {
    return this.prisma.contractSignature.findUnique({
      where: { companyId },
    });
  }

  findByDocToken(zapsignDocToken: string) {
    return this.prisma.contractSignature.findUnique({
      where: { zapsignDocToken },
      include: { company: true },
    });
  }

  create(data: Prisma.ContractSignatureUncheckedCreateInput) {
    return this.prisma.contractSignature.create({ data });
  }

  update(id: string, data: Prisma.ContractSignatureUncheckedUpdateInput) {
    return this.prisma.contractSignature.update({ where: { id }, data });
  }

  /**
   * Registra una visualización del cliente: setea firstViewedAt solo la primera
   * vez (updateMany con where firstViewedAt=null → no lo pisa en visualizaciones
   * posteriores), y actualiza lastViewedAt + viewCount. Si el payload trae
   * times_viewed (contador de Zapsign) lo usa como valor absoluto; si no,
   * incrementa en 1.
   */
  async registerView(id: string, viewedAt: Date, timesViewed?: number) {
    // 1. firstViewedAt solo si aún era null (primera visualización).
    await this.prisma.contractSignature.updateMany({
      where: { id, firstViewedAt: null },
      data: { firstViewedAt: viewedAt },
    });
    // 2. lastViewedAt + contador.
    await this.prisma.contractSignature.update({
      where: { id },
      data: {
        lastViewedAt: viewedAt,
        viewCount:
          timesViewed && timesViewed > 0 ? timesViewed : { increment: 1 },
      },
    });
  }

  findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findUnique({
      where: { type_code: { type, code } },
    });
  }

  /**
   * Activa la cuenta de la empresa (isActive=true) SOLO si el contrato del
   * documento aún no estaba firmado (claim atómico por transición de estado del
   * contrato). Devuelve true si esta llamada fue la que activó (evita doble
   * activación en webhooks concurrentes de doc_signed).
   */
  async markSignedAndActivate(params: {
    contractId: string;
    companyId: string;
    signedStatusId: number;
    signedFileStoragePath: string | null;
    signedDocumentUrl: string | null;
    signedAt: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Claim: pasar el contrato a 'signed' solo si NO estaba ya firmado.
      const claimed = await tx.contractSignature.updateMany({
        where: { id: params.contractId, signedAt: null },
        data: {
          statusId: params.signedStatusId,
          signedAt: params.signedAt,
          signedFileStoragePath: params.signedFileStoragePath,
          signedDocumentUrl: params.signedDocumentUrl,
        },
      });
      if (claimed.count === 0) return false; // ya estaba firmado (webhook duplicado)

      // Activar la cuenta de la empresa.
      await tx.company.update({
        where: { id: params.companyId },
        data: { isActive: true },
      });
      return true;
    });
  }
}
