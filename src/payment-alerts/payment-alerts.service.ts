import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PaymentAlertsRepository } from './payment-alerts.repository.js';
import { FilterPaymentAlertDto } from './dto/filter-payment-alert.dto.js';
import { UpdatePaymentAlertDto } from './dto/update-payment-alert.dto.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class PaymentAlertsService {
  private readonly logger = new Logger(PaymentAlertsService.name);

  constructor(private readonly repository: PaymentAlertsRepository) {}

  /**
   * Crea una alerta de pago. type/severity son codes de Parameter; el estado
   * inicial siempre es 'open'. metadata guarda el contexto del incidente.
   * Devuelve la alerta creada, o null si faltan los parámetros (no debe romper
   * el flujo que la origina, p.ej. el webhook).
   */
  async createAlert(params: {
    companyId: string;
    analysisPackId?: string | null;
    typeCode: string;
    severityCode: string;
    title: string;
    message: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const [type, severity, openStatus] = await Promise.all([
      this.repository.findParameterByTypeAndCode(
        'payment_alert_type',
        params.typeCode,
      ),
      this.repository.findParameterByTypeAndCode(
        'payment_alert_severity',
        params.severityCode,
      ),
      this.repository.findParameterByTypeAndCode(
        'payment_alert_status',
        'open',
      ),
    ]);

    if (!type || !severity || !openStatus) {
      this.logger.error(
        `No se pudo crear la alerta: faltan parámetros (type=${params.typeCode}, ` +
          `severity=${params.severityCode}, status=open)`,
      );
      return null;
    }

    return this.repository.create({
      companyId: params.companyId,
      analysisPackId: params.analysisPackId ?? null,
      typeId: type.id,
      severityId: severity.id,
      statusId: openStatus.id,
      title: params.title,
      message: params.message,
      metadata: params.metadata,
    });
  }

  /** Construye el where común (filtro por estado/tipo) a partir de los codes. */
  private async buildWhere(
    filters: FilterPaymentAlertDto,
    base: Prisma.PaymentAlertWhereInput = {},
  ): Promise<Prisma.PaymentAlertWhereInput> {
    const where: Prisma.PaymentAlertWhereInput = { ...base };

    if (filters.status) {
      const status = await this.repository.findParameterByTypeAndCode(
        'payment_alert_status',
        filters.status,
      );
      // Code inexistente → no debe traer nada (en vez de ignorar el filtro).
      where.statusId = status?.id ?? -1;
    }
    if (filters.type) {
      const type = await this.repository.findParameterByTypeAndCode(
        'payment_alert_type',
        filters.type,
      );
      where.typeId = type?.id ?? -1;
    }
    return where;
  }

  private paginate<T>(data: T[], total: number, page: number, limit: number) {
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Listado para el panel admin: todas las empresas, paginado y filtrable. */
  async findAll(filters: FilterPaymentAlertDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const where = await this.buildWhere(filters);

    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
    });
    return this.paginate(data, total, page, limit);
  }

  /**
   * Gestiona una alerta: cambia su estado y/o agrega notas. Al pasar a
   * 'resolved' registra quién y cuándo la resolvió; al reabrirla se limpian.
   *
   * @param resolvedByUserId id del Profile/admin que gestiona (del token).
   */
  async updateStatus(
    id: string,
    dto: UpdatePaymentAlertDto,
    resolvedByUserId: string,
  ) {
    const alert = await this.repository.findById(id);
    if (!alert) {
      throw new NotFoundException(`Alerta con id=${id} no encontrada`);
    }

    const data: Prisma.PaymentAlertUncheckedUpdateInput = {};

    if (dto.notes !== undefined) {
      data.notes = dto.notes;
    }

    if (dto.status) {
      const status = await this.repository.findParameterByTypeAndCode(
        'payment_alert_status',
        dto.status,
      );
      if (!status) {
        throw new BadRequestException(`Estado inválido: ${dto.status}`);
      }
      data.statusId = status.id;
      if (dto.status === 'resolved') {
        data.resolvedBy = resolvedByUserId;
        data.resolvedAt = new Date();
      } else {
        // Reabrir o poner en gestión limpia la marca de resolución.
        data.resolvedBy = null;
        data.resolvedAt = null;
      }
    }

    return this.repository.update(id, data);
  }
}
