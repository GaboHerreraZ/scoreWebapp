import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupportTicketsRepository } from './support-tickets.repository.js';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto.js';
import { FilterSupportTicketDto } from './dto/filter-support-ticket.dto.js';
import { UpdateSupportTicketDto } from './dto/update-support-ticket.dto.js';
import { PlatformAdminRepository } from '../common/auth/platform-admin.repository.js';
import { MailService } from '../mail/mail.service.js';
import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class SupportTicketsService {
  private readonly logger = new Logger(SupportTicketsService.name);

  constructor(
    private readonly repository: SupportTicketsRepository,
    private readonly platformAdminRepository: PlatformAdminRepository,
    private readonly mailService: MailService,
  ) {}

  /**
   * Crea un ticket de soporte de una empresa. Resuelve los Parameter (area/type/
   * priority + estado inicial 'open'), genera el reference atómico y dispara los
   * correos (confirmación al cliente + aviso a admins, best-effort). companyId
   * viene de la ruta; createdBy del token (Profile = id de Supabase).
   */
  async create(
    companyId: string,
    dto: CreateSupportTicketDto,
    userId: string,
  ) {
    const [area, type, priority, openStatus] = await Promise.all([
      this.repository.findParameterByTypeAndCode('support_area', dto.area),
      this.repository.findParameterByTypeAndCode('support_type', dto.type),
      this.repository.findParameterByTypeAndCode('support_priority', dto.priority),
      this.repository.findParameterByTypeAndCode('support_status', 'open'),
    ]);
    if (!area || !type || !priority || !openStatus) {
      throw new BadRequestException(
        'Faltan parámetros de soporte (area/type/priority/status)',
      );
    }

    // Defensa en código del CHECK de BD: ambos null o ambos presentes.
    const hasType = !!dto.relatedEntityType;
    const hasId = !!dto.relatedEntityId;
    if (hasType !== hasId) {
      throw new BadRequestException(
        'relatedEntityType y relatedEntityId deben venir ambos o ninguno',
      );
    }

    const year = new Date().getFullYear();
    const ticket = await this.repository.createWithReference(
      {
        companyId,
        areaId: area.id,
        typeId: type.id,
        priorityId: priority.id,
        statusId: openStatus.id,
        subject: dto.subject,
        description: dto.description,
        relatedEntityType: dto.relatedEntityType ?? null,
        relatedEntityId: dto.relatedEntityId ?? null,
        context: (dto.context as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        createdBy: userId,
      },
      year,
    );

    // Correos best-effort (no bloquean ni revierten la creación del ticket).
    void this.notify(ticket, area.label);

    // Lo que el front muestra en el toast.
    return {
      id: ticket.id,
      reference: ticket.reference,
      status: ticket.status.code,
      createdAt: ticket.createdAt,
    };
  }

  private async notify(
    ticket: Awaited<
      ReturnType<SupportTicketsRepository['createWithReference']>
    >,
    areaLabel: string,
  ) {
    // Confirmación al cliente (autor del ticket).
    try {
      const to = ticket.createdByUser?.email;
      if (to) {
        const name =
          [ticket.createdByUser?.name, ticket.createdByUser?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'cliente';
        await this.mailService.sendSupportTicketClientEmail({
          to,
          fullName: name,
          reference: ticket.reference,
          subject: ticket.subject,
          areaLabel,
        });
      }
    } catch (e) {
      this.logger.error(
        `Ticket ${ticket.reference}: fallo al confirmar al cliente: ${
          (e as Error).message
        }`,
      );
    }

    // Aviso a los admins activos del portal.
    try {
      const adminEmails =
        await this.platformAdminRepository.findActiveAdminEmails();
      await Promise.all(
        adminEmails.map((to) =>
          this.mailService.sendSupportTicketAdminEmail({
            to,
            reference: ticket.reference,
            companyName: ticket.company.name,
            areaLabel,
            subject: ticket.subject,
            description: ticket.description,
          }),
        ),
      );
    } catch (e) {
      this.logger.error(
        `Ticket ${ticket.reference}: fallo al avisar a los admins: ${
          (e as Error).message
        }`,
      );
    }
  }

  // ── Vista del cliente ─────────────────────────────────────────────────

  /** Tickets de una empresa (historial del cliente), paginado. */
  async findByCompany(companyId: string, filters: FilterSupportTicketDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 10;
    const where = await this.buildWhere(filters, { companyId });
    const { data, total } = await this.repository.findMany({
      skip: (page - 1) * limit,
      take: limit,
      where,
    });
    return this.paginate(data, total, page, limit);
  }

  // ── Panel admin ───────────────────────────────────────────────────────

  async findAll(filters: FilterSupportTicketDto) {
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

  async findOne(id: string) {
    const ticket = await this.repository.findById(id);
    if (!ticket) {
      throw new NotFoundException(`Ticket con id=${id} no encontrado`);
    }
    return ticket;
  }

  /**
   * Gestiona un ticket (admin): estado, asignación y/o notas. Los datos del
   * cliente son inmutables. assignedTo es el id de un PlatformAdmin.
   */
  async update(id: string, dto: UpdateSupportTicketDto) {
    await this.findOne(id);

    const data: Prisma.SupportTicketUncheckedUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.assignedTo !== undefined) data.assignedTo = dto.assignedTo;

    if (dto.status) {
      const status = await this.repository.findParameterByTypeAndCode(
        'support_status',
        dto.status,
      );
      if (!status) {
        throw new BadRequestException(`Estado inválido: ${dto.status}`);
      }
      data.statusId = status.id;
    }

    return this.repository.update(id, data);
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async buildWhere(
    filters: FilterSupportTicketDto,
    base: Prisma.SupportTicketWhereInput = {},
  ): Promise<Prisma.SupportTicketWhereInput> {
    const where: Prisma.SupportTicketWhereInput = { ...base };

    if (filters.status) {
      const p = await this.repository.findParameterByTypeAndCode(
        'support_status',
        filters.status,
      );
      where.statusId = p?.id ?? -1;
    }
    if (filters.area) {
      const p = await this.repository.findParameterByTypeAndCode(
        'support_area',
        filters.area,
      );
      where.areaId = p?.id ?? -1;
    }
    if (filters.type) {
      const p = await this.repository.findParameterByTypeAndCode(
        'support_type',
        filters.type,
      );
      where.typeId = p?.id ?? -1;
    }
    if (filters.priority) {
      const p = await this.repository.findParameterByTypeAndCode(
        'support_priority',
        filters.priority,
      );
      where.priorityId = p?.id ?? -1;
    }
    if (filters.search) {
      where.OR = [
        { reference: { contains: filters.search, mode: 'insensitive' } },
        { subject: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private paginate<T>(data: T[], total: number, page: number, limit: number) {
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
