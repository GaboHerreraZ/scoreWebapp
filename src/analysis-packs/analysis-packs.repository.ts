import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class AnalysisPacksRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultInclude = {
    status: true,
    packOffering: true,
    consultationPrice: true,
  } as const;

  /** Parameter por type+code (estados de la bolsa). */
  async findParameterByTypeAndCode(type: string, code: string) {
    return this.prisma.parameter.findFirst({ where: { type, code } });
  }

  async create(data: Prisma.AnalysisPackUncheckedCreateInput) {
    return this.prisma.analysisPack.create({
      data,
      include: this.defaultInclude,
    });
  }

  async findById(id: string) {
    return this.prisma.analysisPack.findUnique({
      where: { id },
      include: this.defaultInclude,
    });
  }

  /** Bolsas de una empresa (historial), más recientes primero. */
  async findByCompany(companyId: string) {
    return this.prisma.analysisPack.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: this.defaultInclude,
    });
  }

  /**
   * Saldo disponible de una empresa: suma de (purchased − consumed) sobre las
   * bolsas activas y vigentes (endDate >= hoy). Devuelve el total y el detalle
   * de cada bolsa con saldo para que el front muestre vencimientos.
   */
  async findActivePacksWithBalance(companyId: string, activeStatusId: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.analysisPack.findMany({
      where: {
        companyId,
        statusId: activeStatusId,
        endDate: { gte: today },
      },
      orderBy: { endDate: 'asc' },
      include: this.defaultInclude,
    });
  }

  /** ¿Ya procesamos esta transacción ePayco? (idempotencia del webhook). */
  async existsByTransactionId(transactionId: string): Promise<boolean> {
    const found = await this.prisma.analysisPack.findFirst({
      where: { epaycoTransactionId: transactionId },
      select: { id: true },
    });
    return !!found;
  }

  /**
   * Activa la bolsa tras confirmación de pago exitosa. Sólo pasa de
   * pending_payment → active (claim atómico con updateMany); si otra
   * confirmación concurrente ya la activó, count=0 y no se duplica.
   */
  async activateAfterConfirmation(params: {
    packId: string;
    pendingStatusId: number;
    activeStatusId: number;
    epaycoRef?: string;
    epaycoTransactionId?: string;
  }): Promise<boolean> {
    const result = await this.prisma.analysisPack.updateMany({
      where: { id: params.packId, statusId: params.pendingStatusId },
      data: {
        statusId: params.activeStatusId,
        epaycoRef: params.epaycoRef,
        epaycoTransactionId: params.epaycoTransactionId,
        paymentToken: null,
      },
    });
    return result.count > 0;
  }

  /** Marca la bolsa como cancelada (pago rechazado/fallido del checkout). */
  async markCancelled(
    packId: string,
    pendingStatusId: number,
    cancelledStatusId: number,
    epaycoRef?: string,
    epaycoTransactionId?: string,
  ): Promise<boolean> {
    const result = await this.prisma.analysisPack.updateMany({
      where: { id: packId, statusId: pendingStatusId },
      data: {
        statusId: cancelledStatusId,
        epaycoRef,
        epaycoTransactionId,
      },
    });
    return result.count > 0;
  }
}
